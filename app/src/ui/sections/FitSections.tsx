// Sections of the Fit tab (legacy FitFrames): FitTypeFrame, FitFrame1, FitRangeLimitFrame,
// FitAlgorithmFrame, FitParametersFrame, FitStartStop.

import { useState } from 'react'
import { createFitParameter, fitParameterName, fitTargetInfo, layerName, readFitTarget, writeFitTarget } from '../../model/fitTargets'
import { fitTargetKinds, type FitTargetKind, type Project } from '../../model/project'
import { useAppState } from '../../state/context'
import { useEditProject } from '../../state/useEditProject'
import { useFitRunner } from '../../state/useFitRunner'
import { ButtonRow, CheckboxField, Field, Group, Note, NumberField, RadioGroupField } from '../form'
import { NumberCell } from '../NumberCell'
import { formatNumber } from '../numberFormat'

// The legacy list, including the algorithms that are shown but not available.
type FitAlgorithmChoice = Project['fit']['algorithm'] | 'levenberg-marquardt' | 'evolution'

export function FitAlgorithmSection() {
  const { project } = useAppState()
  const edit = useEditProject()
  return (
    <>
      <RadioGroupField<FitAlgorithmChoice>
        label="Algorithm"
        value={project.fit.algorithm}
        options={[
          { value: 'simplex', label: 'Simplex' },
          { value: 'levenberg-marquardt', label: 'Levenberg & Marquardt', disabled: true, title: 'Not available' },
          { value: 'simplex-annealing', label: 'Simplex with simulated annealing' },
          { value: 'evolution', label: 'Evolution', disabled: true, title: 'Follows in a later release' },
        ]}
        onChange={(choice) => {
          if (choice === 'simplex' || choice === 'simplex-annealing') edit((p) => void (p.fit.algorithm = choice))
        }}
      />
      <RadioGroupField
        label="Error function"
        value={project.fit.errorFunction}
        columns={2}
        options={[
          { value: 'log-chi2', label: 'log χ²' },
          { value: 'lin-chi2', label: 'lin χ²' },
        ]}
        onChange={(errorFunction) => edit((p) => void (p.fit.errorFunction = errorFunction))}
      />
      <NumberField label="Occam's razor parameter Q" value={project.fit.occamQ} onChange={(v) => edit((p) => void (p.fit.occamQ = v))} />
    </>
  )
}

export function AdditionalFitParametersSection() {
  const { project } = useAppState()
  const edit = useEditProject()
  const fit = project.fit
  return (
    <>
      <CheckboxField label="angular resolution" checked={fit.fitAngularResolution} onChange={(v) => edit((p) => void (p.fit.fitAngularResolution = v))} />
      <CheckboxField label="intensity scaling factor" checked={fit.fitIntensityScale} onChange={(v) => edit((p) => void (p.fit.fitIntensityScale = v))} />
      <CheckboxField label="qz measurement shift" checked={fit.fitQzShift} onChange={(v) => edit((p) => void (p.fit.fitQzShift = v))} />
      <CheckboxField label="energy measurement shift" checked={fit.fitEnergyShift} onChange={(v) => edit((p) => void (p.fit.fitEnergyShift = v))} />
      <Group title="Script parameter list">
        {project.scripts.parameters.length === 0 ? (
          <Note>No script parameters. Scripts read them as par[0], par[1], …</Note>
        ) : (
          <table className="small-table">
            <tbody>
              {project.scripts.parameters.map((value, i) => (
                <tr key={i}>
                  <th scope="row">par[{i}]</th>
                  <td>
                    <NumberCell label={`script parameter ${i}`} value={value} onCommit={(v) => edit((p) => void (p.scripts.parameters[i] = v))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <ButtonRow>
          <button type="button" onClick={() => edit((p) => void p.scripts.parameters.push(0))}>
            Add script parameter
          </button>
          <button type="button" disabled={project.scripts.parameters.length === 0} onClick={() => edit((p) => void p.scripts.parameters.pop())}>
            Delete script parameter
          </button>
        </ButtonRow>
      </Group>
    </>
  )
}

export function FitWindowSection() {
  const { project } = useAppState()
  const edit = useEditProject()
  const w = project.fit.window
  return (
    <>
      <Group title="qz (1/Å)">
        <NumberField label="from" value={w.qzMin} onChange={(v) => edit((p) => void (p.fit.window.qzMin = v))} />
        <NumberField label="to" value={w.qzMax} onChange={(v) => edit((p) => void (p.fit.window.qzMax = v))} />
      </Group>
      <Group title="energy (eV)">
        <NumberField label="from" value={w.energyMin} onChange={(v) => edit((p) => void (p.fit.window.energyMin = v))} />
        <NumberField label="to" value={w.energyMax} onChange={(v) => edit((p) => void (p.fit.window.energyMax = v))} />
      </Group>
    </>
  )
}

export function FitAlgorithmParametersSection() {
  const { project } = useAppState()
  const edit = useEditProject()
  const annealing = project.fit.annealing
  return (
    <Group title="Simplex with simulated annealing">
      <NumberField label="temperature" value={annealing.temperature} onChange={(v) => edit((p) => void (p.fit.annealing.temperature = v))} />
      <NumberField label="Δ temperature per iteration" value={annealing.temperatureStep} onChange={(v) => edit((p) => void (p.fit.annealing.temperatureStep = v))} />
      {project.fit.algorithm !== 'simplex-annealing' && <Note>Used by “Simplex with simulated annealing”.</Note>}
    </Group>
  )
}

function indexOptions(project: Project, target: FitTargetKind, elementIndex: number): { value: number; label: string }[] {
  switch (fitTargetInfo[target].index) {
    case 'layer':
      return project.sample.layers.map((_, i) => ({ value: i, label: layerName(project, i) })).reverse()
    case 'profileFunction':
      return project.sample.depthProfileFunctions.map((_, i) => ({ value: i, label: `M${i + 1}` }))
    case 'scriptParameter':
      return project.scripts.parameters.map((_, i) => ({ value: i, label: `par[${i}]` }))
    case 'elementSlab':
      return (project.sample.elementProfiles[elementIndex]?.slabs ?? []).map((_, i) => ({ value: i, label: `slab ${i}` }))
    default:
      return []
  }
}

function AddFitParameter() {
  const { project } = useAppState()
  const edit = useEditProject()
  const [target, setTarget] = useState<FitTargetKind>('thickness')
  const [index, setIndex] = useState(1)
  const [elementIndex, setElementIndex] = useState(0)
  const kind = fitTargetInfo[target].index
  const options = indexOptions(project, target, elementIndex)
  const usesElement = kind === 'element' || kind === 'elementSlab'
  const selectedIndex = options.some((o) => o.value === index) ? index : options[0]?.value
  const missing = (kind !== 'none' && kind !== 'element' && selectedIndex === undefined) || (usesElement && project.sample.elementProfiles.length === 0)

  const add = () => {
    const parameter = createFitParameter(
      project,
      target,
      kind === 'none' || kind === 'element' ? null : (selectedIndex ?? null),
      usesElement ? elementIndex : null,
    )
    edit((p) => void p.fit.parameters.push(parameter))
  }

  return (
    <Group title="Add parameter">
      <Field label="quantity">
        <select className="select" value={target} onChange={(e) => setTarget(e.target.value as FitTargetKind)}>
          {fitTargetKinds.map((t) => (
            <option key={t} value={t}>
              {fitTargetInfo[t].label}
            </option>
          ))}
        </select>
      </Field>
      {usesElement && (
        <Field label="element">
          <select className="select" value={elementIndex} onChange={(e) => setElementIndex(Number(e.target.value))}>
            {project.sample.elementProfiles.map((el, i) => (
              <option key={i} value={i}>
                {el.element || `element ${i}`}
              </option>
            ))}
          </select>
        </Field>
      )}
      {options.length > 0 && (
        <Field label="of">
          <select className="select" value={selectedIndex} onChange={(e) => setIndex(Number(e.target.value))}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      <ButtonRow>
        <button type="button" onClick={add} disabled={missing}>
          Add
        </button>
      </ButtonRow>
    </Group>
  )
}

export function FitParametersSection() {
  const { project } = useAppState()
  const edit = useEditProject()
  const parameters = project.fit.parameters
  return (
    <>
      {parameters.length === 0 ? (
        <Note>No fit parameters. Add the quantities to fit below.</Note>
      ) : (
        <table className="small-table fit-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">value</th>
              <th scope="col">lo. bound</th>
              <th scope="col">up. bound</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {parameters.map((parameter, i) => {
              const current = readFitTarget(project, parameter)
              return (
                <tr key={i}>
                  <th scope="row" title={current === undefined ? 'Target not found in this project' : `current: ${formatNumber(current)}`}>
                    {fitParameterName(project, parameter)}
                  </th>
                  <td>
                    <NumberCell label="start value" value={parameter.value} onCommit={(v) => edit((p) => void (p.fit.parameters[i].value = v))} />
                  </td>
                  <td>
                    <NumberCell label="lower bound" value={parameter.lowerBound} onCommit={(v) => edit((p) => void (p.fit.parameters[i].lowerBound = v))} />
                  </td>
                  <td>
                    <NumberCell label="upper bound" value={parameter.upperBound} onCommit={(v) => edit((p) => void (p.fit.parameters[i].upperBound = v))} />
                  </td>
                  <td>
                    <button type="button" className="icon-button" aria-label={`remove ${fitParameterName(project, parameter)}`} onClick={() => edit((p) => void p.fit.parameters.splice(i, 1))}>
                      ×
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {parameters.length > 0 && (
        <ButtonRow>
          <button
            type="button"
            title="Transfer all initial values to the layer table"
            onClick={() => edit((p) => p.fit.parameters.forEach((parameter) => writeFitTarget(p, parameter, parameter.value)))}
          >
            Values → table
          </button>
          <button
            type="button"
            title="Transfer all values from the layer table"
            onClick={() =>
              edit((p) =>
                p.fit.parameters.forEach((parameter) => {
                  const v = readFitTarget(p, parameter)
                  if (v !== undefined) parameter.value = v
                }),
              )
            }
          >
            Table → values
          </button>
        </ButtonRow>
      )}
      <AddFitParameter />
    </>
  )
}

export function FitStartStopSection() {
  const { project, fitStatus } = useAppState()
  const { start, stop, evaluate } = useFitRunner()
  const canFit = project.fit.parameters.length > 0 && project.activeDatasetIndex !== null
  return (
    <>
      <ButtonRow>
        <button type="button" className="primary" onClick={start} disabled={fitStatus.running || !canFit}>
          Start
        </button>
        <button type="button" onClick={stop} disabled={!fitStatus.running}>
          Stop
        </button>
        <button type="button" onClick={evaluate} disabled={fitStatus.running || project.activeDatasetIndex === null} title="χ² of the current parameters">
          χ²
        </button>
      </ButtonRow>
      <dl className="fit-status">
        <dt>iteration</dt>
        <dd>{fitStatus.iteration}</dd>
        <dt>χ²</dt>
        <dd>{fitStatus.chi2 === null ? '–' : formatNumber(fitStatus.chi2)}</dd>
      </dl>
      {fitStatus.message && <Note>{fitStatus.message}</Note>}
      {!canFit && <Note>A fit needs an active dataset (Sample → Dataset) and at least one parameter.</Note>}
    </>
  )
}
