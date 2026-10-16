"""Synthetic parser/gate tests; no private legacy files are required."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest

from inventory import decode_source, extract, parse_cpp, parse_dfm, snapshot_digest, validate


class ParserTests(unittest.TestCase):
    def test_nested_objects_lists_collections_and_binary_properties(self):
        text = """object Window: TForm
  Caption = 'It''s a form'
  Glyph.Data = {
    001122
    334455}
  object Options: TRadioGroup
    Items.Strings = (
      'First'
      'Second')
    OnClick = ChooseOption
    Columns = <
      item
        Caption = 'Not a component'
      end>
  end
  inherited Panel: TPanel [0]
    Hint =
      'A long ' +
      'hint'
    inline Input: TEdit
      Text = '0'
    end
  end
end
"""
        entries = parse_dfm(text.replace('\n', '\r\n'), 'client/Test.dfm')
        self.assertEqual([e['name'] for e in entries], ['Window', 'Options', 'Panel', 'Input'])
        self.assertEqual(entries[1]['events'], {'OnClick': 'ChooseOption'})
        self.assertIn("'Second'", entries[1]['properties']['Items.Strings'])
        self.assertNotIn('Glyph.Data', entries[0]['properties'])
        self.assertEqual(entries[3]['id'], 'client/Test.dfm::Window/Panel/Input')
        self.assertIn('hint', entries[2]['properties']['Hint'])

    def test_invalid_or_empty_dfm_fails(self):
        for text in ('', 'end', 'object Window: TForm', 'object Window: TForm\n  Items.Strings = (', 'object Window: TForm\n mystery syntax\nend'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                parse_dfm(text, 'test.dfm')

    def test_cpp_comments_strings_nested_calls_and_runtime_bindings(self):
        text = '''// Menu->Items->Add("not real");
/* ignored->OnClick = NoHandler;
 Menu->Items->Add("also ignored"); */
const char *example = "Items->Add(fake)";
Menu->Items->Add(
  NewItem("A ) and // and \\\"quote\\\"", 0, false, true, Handle, 0, ""));
List->Items->Add(names[index]);
Button->OnClick = Handle;
Button->OnClick = NULL;
'''
        entries = parse_cpp(text, 'client/Test.cpp')
        self.assertEqual([e['kind'] for e in entries], ['item', 'item', 'event', 'event'])
        self.assertIn('NewItem(', entries[0]['argument'])
        self.assertEqual(entries[0]['receiver'], 'Menu')
        self.assertEqual(entries[1]['argument'], 'names[index]')
        self.assertEqual(entries[2]['handler'], 'Handle')
        self.assertEqual(entries[3]['handler'], 'NULL')
        self.assertEqual(entries[0]['line'], 5)

    def test_duplicate_calls_have_distinct_stable_ids(self):
        text = 'Menu->Items->Add("Same");\nMenu->Items->Add("Same");'
        before = parse_cpp(text, 'test.cpp')
        after = parse_cpp('// added comment\n' + text, 'test.cpp')
        self.assertNotEqual(before[0]['id'], before[1]['id'])
        self.assertEqual([e['id'] for e in before], [e['id'] for e in after])

    def test_unclosed_cpp_call_fails(self):
        with self.assertRaises(ValueError):
            parse_cpp('Menu->Items->Add(NewItem("test");', 'test.cpp')

    def test_legacy_encoding(self):
        self.assertEqual(decode_source(b'\xef\xbb\xbfdegree \xc2\xb0'), 'degree °')
        self.assertEqual(decode_source(b'degree \xb0'), 'degree °')

    def test_source_scope_determinism_and_change_detection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'client').mkdir()
            (root / 'guidll').mkdir()
            path = root / 'client/Test.dfm'
            path.write_text('object Window: TForm\nend\n')
            (root / 'client/Unit1backup2.cpp').write_text('Old->Items->Add("backup");')
            (root / 'client/secret.all').write_text('private data')
            (root / 'client/Inline.h').write_text('button->OnClick = Toggle;')
            (root / 'client/__history').mkdir()
            (root / 'client/__history/Old.dfm').write_text('not a DFM')
            before = extract(root)
            self.assertEqual(len(before['sources']), 2)
            self.assertTrue(any(e['source'] == 'client/Inline.h' for e in before['entries']))
            self.assertEqual(before, extract(root))
            path.write_text('object Window: TForm\n  Caption = \'Changed\'\nend\n')
            self.assertNotEqual(before, extract(root))
            with self.assertRaises(ValueError):
                extract(root / 'missing')


class GateTests(unittest.TestCase):
    def setUp(self):
        self.snapshot = {'version': 1, 'sources': [{'path': 'client/Test.dfm', 'sha256': 'a' * 64}],
                         'entries': parse_dfm('object Window: TForm\nend', 'client/Test.dfm')}
        self.review = {'version': 1, 'inventoryDigest': snapshot_digest(self.snapshot), 'groups': [{'name': 'window', 'status': 'ported',
                        'reason': 'Modern layout', 'references': ['AGENTS.md'],
                        'entries': [self.snapshot['entries'][0]['id']]}]}

    def test_complete_review_passes(self):
        errors, counts = validate(self.snapshot, self.review)
        self.assertEqual(errors, [])
        self.assertEqual(counts['ported'], 1)

    def test_changed_metadata_requires_review_even_with_same_ids(self):
        self.snapshot['entries'][0]['events']['OnClick'] = 'NewHandler'
        self.assertIn('Inventory changed since review', '\n'.join(validate(self.snapshot, self.review)[0]))

    def test_new_entry_cannot_inherit_classification(self):
        self.snapshot['entries'] += parse_dfm('object Another: TForm\nend', 'client/Test.dfm')
        self.assertIn('expected one classification, found 0', '\n'.join(validate(self.snapshot, self.review)[0]))

    def test_duplicate_stale_invalid_and_empty_fail(self):
        mutations = [
            lambda r: r['groups'].append(deepcopy(r['groups'][0])),
            lambda r: r['groups'][0]['entries'].append('missing-id'),
            lambda r: r['groups'][0].update(status='unknown'),
            lambda r: r['groups'][0].update(reason=''),
            lambda r: r['groups'][0].update(references=['not-a-file']),
            lambda r: r['groups'][0].update(references=['../outside']),
            lambda r: r['groups'][0].update(entries=[]),
            lambda r: r['groups'][0].update(status='deferred'),
        ]
        for mutate in mutations:
            review = deepcopy(self.review)
            mutate(review)
            self.assertTrue(validate(self.snapshot, review)[0])
        self.snapshot['entries'] = []
        self.assertTrue(validate(self.snapshot, self.review)[0])

    def test_deferred_requires_phase_and_dropped_requires_reason(self):
        self.review['groups'][0].update(status='deferred', phase='engine')
        self.assertEqual(validate(self.snapshot, self.review)[0], [])
        self.review['groups'][0].update(status='dropped', reason='')
        self.assertTrue(validate(self.snapshot, self.review)[0])

    def test_committed_inventory_is_complete_without_private_tree(self):
        here = Path(__file__).parent
        self.assertEqual(validate(json.loads((here/'inventory.json').read_text()),
                                  json.loads((here/'review.json').read_text()))[0], [])


if __name__ == '__main__':
    unittest.main()
