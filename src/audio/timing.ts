/**
 * Tempo and boundary arithmetic. Pure — no Strudel, no audio.
 *
 * Everything downstream measures time in **cycles**, because that is the unit
 * Strudel's scheduler counts in. Bars are a presentation layer on top:
 * one bar is `meta.cyclesPerBar` cycles.
 */
import { BEATS_PER_BAR, type Meta, type Quantize, type Slot, type StepResolution } from '../model/types'

/** How many steps of the given resolution fit in one cycle. */
export function stepsPerCycle(resolution: StepResolution): number {
  return Number(resolution.slice(0, -1))
}

/**
 * How many cycles a slot occupies on a timeline.
 *
 * A slot of 16 steps at `16n` is exactly one cycle — the LSDJ default phrase.
 * Halving the length halves the time it takes, and its code is *windowed* to
 * that time rather than squashed into it, which is how an LSDJ phrase with a
 * shortened length behaves: you hear its first N steps and then it moves on.
 */
export function slotCycles(slot: Pick<Slot, 'length' | 'steps'>): number {
  return slot.length / stepsPerCycle(slot.steps)
}

/**
 * Cycles per second for Strudel's scheduler.
 *
 * At the defaults (120 bpm, 1 cycle per bar, 4/4) this is 0.5, which is
 * Strudel's own default — so a pattern typed into Chainsaw runs at the same
 * tempo it would in the stock REPL.
 */
export function cpsFor(meta: Pick<Meta, 'bpm' | 'cyclesPerBar'>): number {
  return (meta.bpm / 60 / BEATS_PER_BAR) * meta.cyclesPerBar
}

/**
 * The next point at which a queued change is allowed to take effect.
 *
 * `immediate` returns `now` unchanged; the others round up to the next whole
 * cycle or bar. A change queued exactly on a boundary waits for the following
 * one, so it never lands retroactively inside audio that has already been
 * scheduled.
 */
export function nextBoundary(now: number, quantize: Quantize, cyclesPerBar: number): number {
  if (quantize === 'immediate') return now
  const grid = quantize === 'bar' ? cyclesPerBar : 1
  const steps = Math.floor(now / grid) + 1
  return steps * grid
}

/** Positive modulo, so negative cycle positions still index a loop correctly. */
export function wrap(value: number, length: number): number {
  if (length <= 0) return 0
  return ((value % length) + length) % length
}

/**
 * Round to a dyadic-rational-safe precision.
 *
 * All timeline boundaries come from `length / stepsPerCycle` where the divisor
 * is a power of two, so they are exact in binary floating point. Summing many
 * of them is still exact, but this guards the comparisons against any value a
 * user-supplied `cyclesPerBar` might introduce.
 */
export function quantum(value: number): number {
  return Math.round(value * 1e6) / 1e6
}
