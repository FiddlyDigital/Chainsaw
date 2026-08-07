/**
 * Strudel pattern combinators Chainsaw needs and Strudel does not provide.
 *
 * Both combinators share one property that the rest of the design leans on:
 * they delegate to the inner pattern **at absolute time**. A slot sitting at
 * cycle 12 of the arrangement is queried at cycle 12, so `"<c e g>"` keeps
 * advancing across the song exactly as it would in the stock REPL, rather than
 * being frozen or restarted by the surrounding structure.
 *
 * (Strudel's own `slowcat` cannot be used for this: it re-times each branch to
 * its own rotation count, so a sequence of N patterns only advances the inner
 * pattern once per N cycles.)
 */
import { Fraction, Pattern, TimeSpan, silence } from '@strudel/core'

/** Strudel ships no types; this alias marks the places where its values cross into ours. */
export type StrudelPattern = InstanceType<typeof Pattern>

export interface TimelineEntry {
  /** Position within the timeline, in cycles. */
  begin: number
  end: number
  pattern: StrudelPattern
}

export interface Piece {
  /** Absolute cycle from which this pattern applies. */
  from: number
  pattern: StrudelPattern
}

/** Query `pattern` over `span`, displaced so its own time zero lands at `shift`. */
function queryShifted(pattern: StrudelPattern, state: any, span: any, shift: number) {
  if (shift === 0) return pattern.query(state.setSpan(span))
  const by = Fraction(shift)
  const haps = pattern.query(state.setSpan(span.withTime((t: any) => t.sub(by))))
  return haps.map((hap: any) => hap.withSpan((s: any) => s.withTime((t: any) => t.add(by))))
}

/**
 * Lay entries out over a repeating window of `loop` cycles, anchored so that
 * timeline position 0 falls on absolute cycle `offset`.
 *
 * Each entry is queried over its own stretch only, so a slot shorter than a
 * cycle plays its opening steps and stops — the windowing behaviour described
 * in `timing.slotCycles`. Where an entry starts part-way through a cycle it is
 * displaced by that fraction, so its first step lands on its own downbeat
 * rather than mid-bar.
 */
export function timelinePattern(entries: TimelineEntry[], loop: number, offset = 0): StrudelPattern {
  if (loop <= 0 || entries.length === 0) return silence

  return new Pattern((state: any) => {
    const span = state.span
    const begin = Number(span.begin)
    const end = Number(span.end)
    const first = Math.floor((begin - offset) / loop)
    const last = Math.floor((Math.max(end, begin) - offset) / loop)
    const haps: any[] = []

    for (let repetition = first; repetition <= last; repetition += 1) {
      const base = offset + repetition * loop
      for (const entry of entries) {
        const window = new TimeSpan(Fraction(base + entry.begin), Fraction(base + entry.end))
        const overlap = span.intersection(window)
        if (!overlap) continue
        const start = base + entry.begin
        haps.push(...queryShifted(entry.pattern, state, overlap, start - Math.floor(start)))
      }
    }
    return haps
  })
}

/**
 * Play each pattern from its `from` cycle until the next one starts.
 *
 * This is how a change reaches the audio without a glitch: the running pattern
 * is never swapped out from under the scheduler. Instead the new pattern is
 * appended as a piece starting at the next boundary, so the region the
 * scheduler has already queried keeps producing exactly what it produced
 * before, and the switch happens on the boundary to the sample.
 */
export function pieces(list: Piece[]): StrudelPattern {
  const sorted = [...list].sort((a, b) => a.from - b.from)
  if (sorted.length === 0) return silence
  if (sorted.length === 1) return sorted[0].pattern

  return new Pattern((state: any) => {
    const span = state.span
    const haps: any[] = []
    for (let i = 0; i < sorted.length; i += 1) {
      const from = sorted[i].from
      const until = sorted[i + 1]?.from
      const window = new TimeSpan(Fraction(from), until === undefined ? span.end.max(Fraction(from)) : Fraction(until))
      const overlap = span.intersection(window)
      if (!overlap) continue
      haps.push(...sorted[i].pattern.query(state.setSpan(overlap)))
    }
    return haps
  })
}

export { silence }
