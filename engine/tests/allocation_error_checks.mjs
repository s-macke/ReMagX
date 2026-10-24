// Fail individual allocations without exhausting the host, using the real WASM
// heap for preceding allocations and recovery. Status 3 is the C API memory code.
export function checkAllocationErrors(module, { generateLookup, fitError, minimize, subdivide, prepareOptics }) {
  const operations = [
    wrapped => generateLookup(wrapped),
    wrapped => fitError(wrapped, { mode: 0, qz: [.1], measured: [1], calculated: [1], qzMin: 0, qzMax: 1 }),
    wrapped => minimize(wrapped, { simplex: [[0], [1]], objective: point => point[0] ** 2, maxIterations: 2 }),
    wrapped => subdivide(wrapped, { minimumDepth: 0, maximumDepth: 1, minimumStep: .1, maximumStep: 1,
      gradientScale: 1, capacity: 10, sample: () => [0, 0, 0, 0] }),
    wrapped => {
      const sampler = prepareOptics(wrapped, { layers: [[0, 0, 0, 0, 0, 0, 90, 90], [10, 0, .001, .0001, 0, 0, 90, 90]],
        boundaries: [0, 10], model: 2, errorSamples: Array(1001).fill(0) })
      sampler.dispose()
    },
  ]
  for (const [index, run] of operations.entries()) {
    for (const failAt of index === 0 ? [1] : [1, 2]) {
      let calls = 0
      const outstanding = new Set()
      const wrapped = new Proxy(module, { get(target, key) {
        if (key === '_malloc') return bytes => {
          if (++calls === failAt) return 0
          const pointer = target._malloc(bytes)
          outstanding.add(pointer)
          return pointer
        }
        if (key === '_free') return pointer => {
          if (!outstanding.delete(pointer)) throw new Error('Unexpected free')
          target._free(pointer)
        }
        return target[key]
      } })
      let failed = false
      try { run(wrapped) } catch (error) {
        if (error.status !== 3 || !error.message.includes('allocation failed')) throw error
        failed = true
      }
      if (!failed || outstanding.size) throw new Error(`Allocation failure/cleanup missing for operation ${index}`)
      run(module)
    }
  }
}
