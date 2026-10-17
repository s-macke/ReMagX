import type { createScriptArrayWorkspace } from '../../model/scriptArrays'
import type { LuaSession } from './runtime'

/** Publish a project snapshot only after both Lua execution and readback succeed. */
export function runProjectHook(session: LuaSession, workspace: ReturnType<typeof createScriptArrayWorkspace>) {
  try {
    workspace.applyHook(session.runHook(workspace.beginHook()))
    return workspace.snapshot()
  } catch (error) {
    session.close()
    throw error
  }
}
