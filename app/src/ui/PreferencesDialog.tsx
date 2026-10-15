import { useAppState } from '../state/context'
import { useEditProject } from '../state/useEditProject'
import { Dialog } from './Dialog'
import { CheckboxField, Note, RadioGroupField } from './form'

// Legacy "Settings" dialog (guidll/SettingsForm). Precision and parallel computing are gone:
// the web app always computes in double precision and parallelizes on its own.
export function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const { project } = useAppState()
  const edit = useEditProject()
  const { calculation } = project
  return (
    <Dialog title="Preferences" onClose={onClose}>
      <div className="preferences">
        <RadioGroupField
          label="Algorithm"
          value={calculation.algorithm}
          options={[
            { value: 'parratt', label: 'Parratt' },
            { value: 'matrix', label: 'Full matrix formalism' },
            { value: 'zak', label: 'Zak matrix formalism' },
            { value: 'parratt-single-scattering', label: 'Parratt without multiple scattering' },
            { value: 'electron-yield', label: 'Total electron yield (testing)' },
          ]}
          onChange={(algorithm) => edit((p) => void (p.calculation.algorithm = algorithm))}
        />
        <RadioGroupField
          label="Roughness approximation"
          value={calculation.roughnessModel}
          options={[
            { value: 'nevot-croce', label: 'Nevot & Croce' },
            { value: 'segmentation', label: 'layer segmentation' },
          ]}
          onChange={(roughnessModel) => edit((p) => void (p.calculation.roughnessModel = roughnessModel))}
        />
        <RadioGroupField
          label="Treat δm and βm as"
          value={calculation.tensorContribution}
          options={[
            { value: 'magnetic', label: 'magnetic contribution' },
            { value: 'tetragonal', label: 'tetragonal contribution (in z)' },
          ]}
          onChange={(tensorContribution) => edit((p) => void (p.calculation.tensorContribution = tensorContribution))}
        />
        <RadioGroupField
          label="Scattering type (experimental, matrix algorithms)"
          value={project.experiment.scattering}
          options={[
            { value: 'reflection', label: 'reflection' },
            { value: 'transmission', label: 'transmission' },
          ]}
          onChange={(scattering) => edit((p) => void (p.experiment.scattering = scattering))}
        />
        <RadioGroupField
          label="Asymmetry definition"
          value={calculation.asymmetryDefinition}
          options={[
            { value: 'normalized', label: '(Ray1 − Ray2) / (Ray1 + Ray2)' },
            { value: 'difference', label: 'Ray1 − Ray2' },
          ]}
          onChange={(asymmetryDefinition) => edit((p) => void (p.calculation.asymmetryDefinition = asymmetryDefinition))}
        />
        <fieldset className="group">
          <legend>Script and database</legend>
          <CheckboxField label="Disable script execution" checked={!project.scripts.enabled} onChange={(v) => edit((p) => void (p.scripts.enabled = !v))} />
          <CheckboxField label="Use Chantler database" checked={calculation.useChantlerDatabase} onChange={(v) => edit((p) => void (p.calculation.useChantlerDatabase = v))} />
        </fieldset>
      </div>
      <Note>All calculations use double precision. The mock engine only implements Parratt with Nevot & Croce roughness.</Note>
    </Dialog>
  )
}
