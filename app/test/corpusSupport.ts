// Public CI output must never contain corpus paths, project contents or parser diagnostics.
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { importAllFile } from '../src/import/allFile'
import { projectSchema } from '../src/model/project'

export function discoverCorpus(directory: string | undefined): string[] {
  if (!directory?.trim()) throw new Error('CORPUS_DIR must point to a nonempty private corpus directory.')
  const files: string[] = []
  try {
    const visit = (path: string) => {
      const stat = lstatSync(path)
      // Reject links rather than following cycles or silently excluding projects.
      if (stat.isSymbolicLink()) throw new Error('Unsupported link')
      if (stat.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name))
      else if (stat.isFile() && path.toLowerCase().endsWith('.all')) files.push(path)
    }
    if (!lstatSync(directory).isDirectory()) throw new Error('Not a directory')
    visit(directory)
  } catch {
    throw new Error('Private corpus discovery failed: check directory access and remove symbolic links. Paths are withheld.')
  }
  if (!files.length) throw new Error('Private corpus contains no .all projects.')
  return files
}

export function validateCorpusFile(file: string): void {
  try {
    const { project } = importAllFile(readFileSync(file), 'private project')
    if (!projectSchema.safeParse(project).success) throw new Error('Invalid project')
  } catch {
    throw new Error('Private corpus project could not be read, imported or schema-validated. Details are withheld.')
  }
}
