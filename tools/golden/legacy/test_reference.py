import cmath
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from build_reference import build, verify_dependencies


class DependencyGateTest(unittest.TestCase):
    def test_rejects_changes_additions_and_missing_headers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            header = root / 'approved.h'
            header.write_text('reviewed header')
            adapter = root / 'adapter.cpp'
            manifest = {'approved.h': hashlib.sha256(header.read_bytes()).hexdigest()}
            verify_dependencies([header, adapter], root, manifest, adapter)
            with self.assertRaises(ValueError):
                verify_dependencies([], root, manifest, adapter)
            with self.assertRaises(ValueError):
                verify_dependencies([header, root / 'unreviewed.h'], root, manifest, adapter)
            header.write_text('changed')
            with self.assertRaises(ValueError):
                verify_dependencies([header], root, manifest, adapter)
            with self.assertRaises(ValueError):
                verify_dependencies([root.parent / 'outside.h'], root, manifest, adapter)


@unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private legacy sources not requested')
class ReferenceAdapterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.directory.cleanup)
        cls.executable = build(os.environ['LEGACY_ROOT'], Path(cls.directory.name) / 'reference')

    def calculate(self, layers, angle=0.1, wave_number=1, polarization=(1, 0, 0, 0), analyzer=0):
        header = f'{len(layers)} 1 0 {analyzer}\n' + ' '.join(map(str, polarization)) + '\n'
        body = '\n'.join(' '.join(map(str, layer)) for layer in layers)
        result = subprocess.run([self.executable], input=header + body + f'\n{angle} {wave_number} 0\n', text=True, capture_output=True, check=True)
        return float(result.stdout)

    def assert_numerically_equal(self, actual, expected):
        self.assertLessEqual(abs(actual - expected), 1e-15 + 1e-10 * abs(expected))

    def test_two_media_fresnel_and_analyzer_mapping(self):
        substrate = [0, 0, 0.01, 0.002, 0, 0, 90, 90]
        ambient = [0, 0, 0, 0, 0, 0, 90, 90]
        angle = 0.2
        index = complex(1 - substrate[2], substrate[3])
        lower = cmath.sqrt(index * index - math.cos(angle)**2)
        upper = cmath.sqrt(1 - math.cos(angle)**2)
        sigma = abs((upper - lower) / (upper + lower))**2
        pi = abs((index*index*upper - lower) / (index*index*upper + lower))**2
        self.assert_numerically_equal(self.calculate([substrate, ambient], angle), sigma)
        self.assert_numerically_equal(self.calculate([substrate, ambient], angle, polarization=(0, 0, 1, 0)), pi)
        beam = (0.3, 0.4, 0.6, 0.8)
        self.assert_numerically_equal(self.calculate([substrate, ambient], angle, polarization=beam), 0.25*sigma + pi)
        self.assert_numerically_equal(self.calculate([substrate, ambient], angle, polarization=beam, analyzer=1), 0.25*sigma)
        self.assert_numerically_equal(self.calculate([substrate, ambient], angle, polarization=beam, analyzer=2), pi)

    def test_zero_contrast_and_same_material_partition(self):
        substrate = [0, 0, 0.01, 0.002, 0, 0, 90, 90]
        ambient = [0, 0, 0, 0, 0, 0, 90, 90]
        self.assertEqual(self.calculate([ambient, ambient]), 0)
        film = [50, *substrate[1:]]
        self.assert_numerically_equal(self.calculate([substrate, film, ambient]), self.calculate([substrate, ambient]))

    def test_single_logical_layer_depends_on_retained_unused_storage(self):
        result = subprocess.run([self.executable, '--diagnose-single-layer'],
                                capture_output=True, text=True, check=True, timeout=10)
        self.assertEqual(result.stderr, '')
        report = json.loads(result.stdout)
        self.assertEqual(report['logicalLayers'], 1)
        self.assertTrue(report['dependsOnUnusedStorage'])
        medium = [0, 0, .01, .001, 0, 0, 90, 90]
        vacuum = [0, 0, 0, 0, 0, 0, 90, 90]
        self.assert_numerically_equal(report['sameMediumStorage'], self.calculate([medium, medium], angle=.2))
        self.assert_numerically_equal(report['vacuumStorage'], self.calculate([medium, vacuum], angle=.2))
        self.assertGreater(abs(report['vacuumStorage'] - report['sameMediumStorage']), .03)

    def test_rejects_invalid_protocol(self):
        result = subprocess.run([self.executable], input='1 1 0 0\n', text=True, capture_output=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, '')
