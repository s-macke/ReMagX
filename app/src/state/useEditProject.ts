import { useCallback } from 'react'
import type { Project } from '../model/project'
import { useDispatch } from './context'

// Returns edit(recipe, coalesce?): the recipe mutates a copy of the project, which then replaces
// the current one. Keeps section components short; datasets are shared, not copied, unless
// touched. Edits with the same coalesce key in quick succession form one undo step (typing).
export function useEditProject(): (recipe: (draft: Project) => void, coalesce?: string) => void {
  const dispatch = useDispatch()
  return useCallback(
    (recipe, coalesce) =>
      dispatch({
        type: 'updateProject',
        coalesce,
        update: (project) => {
          const draft: Project = { ...structuredClone({ ...project, datasets: [] }), datasets: [...project.datasets] }
          recipe(draft)
          return draft
        },
      }),
    [dispatch],
  )
}
