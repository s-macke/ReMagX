// Sections of the Experiment tab (legacy GeneralFrames): ExperimentFrame, EScanFrame,
// ResolutionFrame, MeasurementParamsFrame, PolarizationFrame, MapFrame.

import { wavelengthFromEnergy } from '../../model/units'
import { useAppState, useDispatch } from '../../state/context'
import { useEditProject } from '../../state/useEditProject'
import { CheckboxField, Field, Group, Note, NumberField, RadioGroupField } from '../form'
import { BeamEditor } from '../BeamEditor'

export function EnergySection() {
  const { project, energyUnit } = useAppState()
  const dispatch = useDispatch()
  const edit = useEditProject()
  const energy = project.experiment.energy
  return (
    <>
      <RadioGroupField
        label="Input"
        value={energyUnit}
        columns={2}
        options={[
          { value: 'eV', label: 'Energy (eV)' },
          { value: 'angstrom', label: 'Lambda (Å)' },
        ]}
        onChange={(energyUnit) => dispatch({ type: 'setEnergyUnit', energyUnit })}
      />
      {energyUnit === 'eV' ? (
        <NumberField label="Energy" unit="eV" value={energy} min={1e-9} onChange={(v) => edit((p) => void (p.experiment.energy = v))} />
      ) : (
        <NumberField
          label="Wavelength"
          unit="Å"
          value={wavelengthFromEnergy(energy)}
          min={1e-9}
          onChange={(lambda) => edit((p) => void (p.experiment.energy = wavelengthFromEnergy(lambda)))}
        />
      )}
    </>
  )
}

export function XAxisSection() {
  const { project } = useAppState()
  const edit = useEditProject()
  const { qzScan, energyScan } = project.experiment
  return (
    <>
      <RadioGroupField
        label="x-Axis"
        value={qzScan.showAngle ? 'angle' : 'qz'}
        columns={2}
        options={[
          { value: 'qz', label: 'qz' },
          { value: 'angle', label: 'theta [°]', disabled: true, title: 'Angle axis follows later' },
        ]}
        onChange={(v) => edit((p) => void (p.experiment.qzScan.showAngle = v === 'angle'))}
      />
      <Group title="Const Energy Settings">
        <NumberField label="qz min" unit="1/Å" min={0} value={qzScan.qzMin} onChange={(v) => edit((p) => void (p.experiment.qzScan.qzMin = v))} />
        <NumberField label="qz max" unit="1/Å" min={0} value={qzScan.qzMax} onChange={(v) => edit((p) => void (p.experiment.qzScan.qzMax = v))} />
      </Group>
      <Group title="Energy Scan Settings">
        <NumberField label="E-min" unit="eV" min={0} value={energyScan.energyMin} onChange={(v) => edit((p) => void (p.experiment.energyScan.energyMin = v))} />
        <NumberField label="E-max" unit="eV" min={0} value={energyScan.energyMax} onChange={(v) => edit((p) => void (p.experiment.energyScan.energyMax = v))} />
        <RadioGroupField
          label="fixed"
          value={energyScan.fixed}
          columns={2}
          options={[
            { value: 'qz', label: 'const qz' },
            { value: 'angle', label: 'const angle' },
          ]}
          onChange={(fixed) => edit((p) => void (p.experiment.energyScan.fixed = fixed))}
        />
        {energyScan.fixed === 'qz' ? (
          <NumberField label="qz" unit="1/Å" min={0} value={energyScan.qz} onChange={(v) => edit((p) => void (p.experiment.energyScan.qz = v))} />
        ) : (
          <NumberField label="angle" unit="°" min={0} value={energyScan.angle} onChange={(v) => edit((p) => void (p.experiment.energyScan.angle = v))} />
        )}
      </Group>
      <NumberField label="number of points" min={2} integer value={qzScan.points} onChange={(v) => edit((p) => void (p.experiment.qzScan.points = v))} />
      <CheckboxField
        label="use dataset points for simulation"
        checked={qzScan.useDatasetPoints}
        onChange={(v) => edit((p) => void (p.experiment.qzScan.useDatasetPoints = v))}
      />
    </>
  )
}

export function ResolutionSection() {
  const { project } = useAppState()
  const edit = useEditProject()
  const r = project.experiment.resolution
  return (
    <>
      <Group title="Angular resolution">
        <NumberField label="FWHM of Gaussian" unit="1/Å" min={0} value={r.angularFwhm} onChange={(v) => edit((p) => void (p.experiment.resolution.angularFwhm = v))} />
        <NumberField label="number of points" min={1} integer value={r.angularPoints} onChange={(v) => edit((p) => void (p.experiment.resolution.angularPoints = v))} />
        <CheckboxField label="fast convolution" checked={r.fastConvolution} onChange={(v) => edit((p) => void (p.experiment.resolution.fastConvolution = v))} />
      </Group>
      <Group title="Energy resolution (only energy scan)">
        <NumberField label="FWHM of Gaussian" unit="eV" min={0} value={r.energyFwhm} onChange={(v) => edit((p) => void (p.experiment.resolution.energyFwhm = v))} />
        <NumberField label="number of points" min={1} integer value={r.energyPoints} onChange={(v) => edit((p) => void (p.experiment.resolution.energyPoints = v))} />
        <CheckboxField
          label="fast convolution"
          checked={r.energyFastConvolution}
          onChange={(v) => edit((p) => void (p.experiment.resolution.energyFastConvolution = v))}
        />
      </Group>
    </>
  )
}

export function SimulationParametersSection() {
  const { project } = useAppState()
  const edit = useEditProject()
  const { calculation, sample } = project
  return (
    <>
      <NumberField label="epsilon" value={calculation.epsilon} onChange={(v) => edit((p) => void (p.calculation.epsilon = v))} />
      <Group title="Post modifications">
        <NumberField label="Averaging" min={0} integer value={calculation.averaging} onChange={(v) => edit((p) => void (p.calculation.averaging = v))} />
        <CheckboxField
          label="Multiply intensity by qz⁴"
          checked={calculation.postProcessing.multiplyByQz4}
          onChange={(v) => edit((p) => void (p.calculation.postProcessing.multiplyByQz4 = v))}
        />
        <CheckboxField
          label="divide intensity by cos²(2θ) if pi light"
          checked={calculation.postProcessing.divideByCos2ThetaSquared}
          onChange={(v) => edit((p) => void (p.calculation.postProcessing.divideByCos2ThetaSquared = v))}
        />
        <CheckboxField
          label="Fourier transformation"
          checked={calculation.postProcessing.fourierTransform}
          onChange={(v) => edit((p) => void (p.calculation.postProcessing.fourierTransform = v))}
        />
      </Group>
      <Group title="Multilayers">
        <CheckboxField label="Enable multilayer" checked={sample.multilayer.enabled} onChange={(v) => edit((p) => void (p.sample.multilayer.enabled = v))} />
        <Field label="Layer sequence">
          <input
            className="text-input"
            value={sample.multilayer.pattern}
            placeholder="0, 3*(1, 2), 4"
            disabled={!sample.multilayer.enabled}
            onChange={(e) => edit((p) => void (p.sample.multilayer.pattern = e.target.value), 'multilayer-pattern')}
          />
        </Field>
        <Note>Syntax example: 0, 3*(1, 2), 4</Note>
      </Group>
    </>
  )
}

export function PolarizationSection() {
  const { project } = useAppState()
  const edit = useEditProject()
  const polarization = project.experiment.polarization
  return (
    <>
      <BeamEditor title="Incoming Beam 1" beam={polarization.beam1} onChange={(beam) => edit((p) => void (p.experiment.polarization.beam1 = beam))} />
      <BeamEditor title="Incoming Beam 2" beam={polarization.beam2} onChange={(beam) => edit((p) => void (p.experiment.polarization.beam2 = beam))} />
      <RadioGroupField
        label="Polarization Analyzer"
        value={polarization.analyzer}
        columns={3}
        options={[
          { value: 'none', label: 'Pi + Sigma' },
          { value: 'sigma', label: 'Sigma' },
          { value: 'pi', label: 'Pi' },
        ]}
        onChange={(analyzer) => edit((p) => void (p.experiment.polarization.analyzer = analyzer))}
      />
    </>
  )
}

export function MapSection() {
  return <Note>2D maps (energy × qz) follow in a later release.</Note>
}
