/** D-50: ordinary Lua 5.1/Borland integer arguments round to nearest, ties to even.
 * This conversion applies only to array indices, sizes and type IDs, never data.
 * Reject undefined overflow of the original signed 32-bit int representation.
 */
export function scriptIntegerArgument(value: number): number {
  if (!Number.isFinite(value)) throw new Error('finite number expected')
  const lower = Math.floor(value)
  const fraction = value - lower
  const rounded = fraction < 0.5 || (fraction === 0.5 && lower % 2 === 0) ? lower : lower + 1
  if (rounded < -2147483648 || rounded > 2147483647) throw new Error('integer out of range')
  return rounded === 0 ? 0 : rounded
}
