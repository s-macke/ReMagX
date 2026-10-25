import type { createScriptArrayWorkspace } from '../../model/scriptArrays'
import type { LuaSession } from './runtime'

/** Publish a project snapshot only after both Lua execution and readback succeed. */
export function runProjectHook(session: LuaSession, workspace: ReturnType<typeof createScriptArrayWorkspace>,
  ownership: 'copy' | 'transfer' = 'copy') {
  try {
    workspace.applyHook(session.runHook(workspace.beginHook()))
    return ownership === 'transfer' ? workspace.releaseSnapshot() : workspace.snapshot()
  } catch (error) {
    session.close()
    throw error
  }
}
