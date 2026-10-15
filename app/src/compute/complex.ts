// Minimal immutable complex arithmetic for the mock physics (double precision).

export interface C {
  re: number
  im: number
}

export const c = (re: number, im = 0): C => ({ re, im })
export const add = (a: C, b: C): C => ({ re: a.re + b.re, im: a.im + b.im })
export const sub = (a: C, b: C): C => ({ re: a.re - b.re, im: a.im - b.im })
export const mul = (a: C, b: C): C => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re })
export const scale = (a: C, s: number): C => ({ re: a.re * s, im: a.im * s })
export const abs2 = (a: C): number => a.re * a.re + a.im * a.im

export function div(a: C, b: C): C {
  const d = abs2(b)
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }
}

export function exp(a: C): C {
  const m = Math.exp(a.re)
  return { re: m * Math.cos(a.im), im: m * Math.sin(a.im) }
}

// Principal square root (non-negative real part), which is the physical branch for kz.
export function sqrt(a: C): C {
  const r = Math.hypot(a.re, a.im)
  const re = Math.sqrt((r + a.re) / 2)
  const im = Math.sqrt((r - a.re) / 2)
  return { re, im: a.im < 0 ? -im : im }
}
