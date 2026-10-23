export function checkTableSessions(module, createSession, lookup, references = []) {
  const ensure = (ok, message) => { if (!ok) throw new Error(message) }
  const fails = run => { let failed = false; try { run() } catch { failed = true } ensure(failed, 'Expected lookup failure') }
  const session = createSession(module)
  try {
    for (const table of references) {
      const result = session.lookup(table, table.queries, table.cursor)
      ensure(result.values.length === table.expected.length, 'Prepared result width mismatch')
      ensure(result.cursor === table.expectedCursor, 'Prepared cursor mismatch')
      result.values.forEach((value, index) => ensure(Math.abs(value - table.expected[index]) <= 1e-15 + 1e-10 * Math.abs(table.expected[index]), 'Prepared native table mismatch'))
    }
  } finally { session.dispose() }
  for (let failAt = 0; failAt <= 6; failAt++) {
    const owned = new Set(), handles = new Set(); let allocations = 0
    const wrapped = new Proxy(module, { get(target, key) {
      if (key === '_remagx_table_prepare') return (...args) => {
        const status = target._remagx_table_prepare(...args)
        if (status === 0) handles.add(new DataView(target.HEAPF64.buffer).getUint32(args[4], true))
        return status
      }
      if (key === '_remagx_table_destroy') return handle => { ensure(handles.delete(handle), 'Invalid table handle destroy'); target._remagx_table_destroy(handle) }
      if (key === '_malloc') return bytes => { if (++allocations === failAt) return 0; const pointer = target._malloc(bytes); if (pointer) owned.add(pointer); return pointer }
      if (key === '_free') return pointer => { ensure(owned.delete(pointer), 'Invalid table free'); target._free(pointer) }
      return target[key]
    } })
    const current = createSession(wrapped)
    const table = { energy: [1, 2, 2, 3], columns: [[10, 20, 30, 40]] }
    try {
      if (failAt) fails(() => current.lookup(table, [2]))
      const first = current.lookup(table, [2])
      const before = allocations
      const actual = current.lookup(table, [2, 2, 0, 3], first.cursor)
      const expected = lookup(module, table, [2, 2, 0, 3], first.cursor)
      ensure(actual.cursor === expected.cursor && String(actual.values) === String(expected.values), 'Duplicate history mismatch')
      ensure(allocations - before === 3, 'Cached table buffers allocated again')
      table.columns[0][0] = 999
      ensure(current.lookup(table, [1]).values[0] === 10, 'Prepared snapshot changed')
      const next = createSession(module)
      try { ensure(next.lookup(table, [1]).values[0] === 999, 'New session retained stale values') } finally { next.dispose() }
      const replacement = { energy: [1, 3], columns: [[5, 7]] }
      ensure(current.lookup(replacement, [1]).values[0] === 5, 'Replacement retained stale values')
      fails(() => current.lookup(table, [NaN]))
      fails(() => current.lookup({ energy: [2, 1], columns: [[1, 2]] }, [1.5]))
      fails(() => current.lookup({ energy: [1, 2, 3], columns: [[1, 1e308, -1e308]] }, [1, 2.5]))
      ensure(current.lookup(table, [1]).values[0] === 10, 'Session failed to recover')
    } finally { current.dispose(); current.dispose() }
    ensure(owned.size === 0 && handles.size === 0, 'Table session leaked')
    fails(() => current.lookup(table, [1]))
  }
}


export function checkTableSessionMemory(module, createSession, growMemory) {
  const session = createSession(module)
  const table = { energy: [1, 2], columns: [[10, 20]] }
  try {
    session.lookup(table, [1])
    const buffer = module.HEAPF64.buffer
    growMemory()
    if (module.HEAPF64.buffer === buffer || session.lookup(table, [1.5]).values[0] !== 15) {
      throw new Error('Prepared lookup did not survive memory growth')
    }
  } finally { session.dispose() }
}
