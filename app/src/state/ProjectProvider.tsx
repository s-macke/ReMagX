import { useEffect, useReducer, type ReactNode } from 'react'
import { discardComputeService } from './useCalculation'
import { initialState, reducer } from './appState'
import { DispatchContext, StateContext } from './context'

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  useEffect(() => {
    if (state.fitInvalidations > 0) discardComputeService()
  }, [state.fitInvalidations])
  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  )
}
