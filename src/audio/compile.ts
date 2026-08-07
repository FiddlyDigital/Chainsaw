/**
 * Turning project code strings into Strudel patterns.
 *
 * Slot code and instrument code are evaluated **separately** and combined with
 * a Strudel pattern operation — never by concatenating source and evaluating
 * the result. This is what PRD §11 Q2 asks to settle, and the structured route
 * is available: `instrument.set.out(slot)` takes its structure and its value
 * precedence from the slot, filling in whatever controls the instrument
 * declared and the slot did not. Swapping a slot's instrument therefore cannot
 * disturb the slot's code, and a slot can always override one of the
 * instrument's controls by simply setting it.
 */
import { evalScope, evaluate } from '@strudel/core'
import * as core from '@strudel/core'
import * as mini from '@strudel/mini'
import * as tonal from '@strudel/tonal'
import { transpiler } from '@strudel/transpiler'
import type { Project } from '../model/types'
import { noteToMidi } from './note'
import type { SlotRef } from './timeline'
import { type StrudelPattern, silence } from './patterns'

export class PatternError extends Error {
  constructor(
    readonly where: string,
    readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'PatternError'
  }
}

let scopeReady: Promise<void> | undefined

/** Load Strudel's vocabulary into the evaluation scope. Idempotent. */
export function initPatternScope(): Promise<void> {
  scopeReady ??= evalScope(core, mini, tonal).then(() => undefined)
  return scopeReady as Promise<void>
}

// Compilation is pure with respect to the code string, so results are cached.
// The cache is bounded because a live-coding session generates a new key on
// every committed edit.
const CACHE_LIMIT = 512
const cache = new Map<string, StrudelPattern>()

function remember(code: string, pattern: StrudelPattern): StrudelPattern {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(code, pattern)
  return pattern
}

export function clearPatternCache(): void {
  cache.clear()
}

/**
 * Evaluate one Strudel expression. Throws `PatternError` on bad code so the
 * caller can attribute the failure to a slot and keep the rest playing.
 */
export async function compile(code: string, where = 'pattern'): Promise<StrudelPattern> {
  const trimmed = code.trim()
  if (!trimmed) return silence
  const hit = cache.get(trimmed)
  if (hit) return hit

  await initPatternScope()
  let pattern: unknown
  try {
    ;({ pattern } = await evaluate(trimmed, transpiler))
  } catch (error) {
    throw new PatternError(where, error)
  }
  if (!core.isPattern(pattern)) {
    throw new PatternError(where, new Error('expression did not produce a pattern'))
  }
  return remember(trimmed, pattern as StrudelPattern)
}

/** Add semitones to a hap's `note`, leaving everything else alone. */
function transposeValue(value: Record<string, unknown>, semitones: number) {
  if (value == null || value.note === undefined) return value
  const midi = typeof value.note === 'number' ? value.note : noteToMidi(value.note)
  if (!Number.isFinite(midi)) return value
  return { ...value, note: midi + semitones }
}

function offsetGain(value: Record<string, unknown>, offset: number) {
  const current = typeof value?.gain === 'number' ? value.gain : 1
  return { ...value, gain: Math.max(0, current + offset) }
}

/**
 * The playable pattern for one occurrence of a slot, including the instrument
 * it names and the transpose/gain offsets of the chain step that placed it.
 */
export async function compileSlot(project: Project, ref: SlotRef): Promise<StrudelPattern> {
  const slot = project.slots[ref.slot]
  if (!slot || slot.muted) return silence

  let pattern = await compile(slot.code, `slot ${ref.slot}`)

  if (slot.instrument) {
    const instrument = project.instruments[slot.instrument]
    if (instrument) {
      const base = await compile(instrument.base, `instrument ${slot.instrument}`)
      // Structure and value precedence from the slot; the instrument supplies
      // every control the slot left unset.
      pattern = base.set.out(pattern)
    }
  }

  if (ref.transpose !== 0) {
    pattern = pattern.withValue((value: Record<string, unknown>) => transposeValue(value, ref.transpose))
  }
  if (ref.gainOffset !== 0) {
    pattern = pattern.withValue((value: Record<string, unknown>) => offsetGain(value, ref.gainOffset))
  }
  return pattern
}
