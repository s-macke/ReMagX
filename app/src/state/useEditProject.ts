import { useCallback } from 'react'
import type { Project } from '../model/project'
import { useDispatch } from './context'

// Returns edit(recipe): the recipe mutates a copy of the project, which then replaces the
// current one. Keeps section components short; datasets are shared, not copied, unless touched.
export function useEditProject(): (recipe: (draft: Project) => void) => void {
  const dispatch = useDispatch()
  return useCallback(
    (recipe) =>
      dispatch({
        type: 'updateProject',
        update: (project) => {
          const draft: Project = { ...structuredClone({ ...project, datasets: [] }), datasets: [...project.datasets] }
          recipe(draft)
          return draft
        },
      }),
    [dispatch],
  )
}
