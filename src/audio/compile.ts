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
import * as webaudio from '@strudel/webaudio'
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

/**
 * Load Strudel's vocabulary into the evaluation scope. Idempotent.
 *
 * `webaudio` is in here for the same reason as the rest: without it a whole
 * shelf of the standard vocabulary is simply missing — `setGainCurve`,
 * `setDefault`, `samples` — and a pattern using one fails with nothing more
 * helpful than "not defined". It is already in the bundle, since the engine
 * and the built-in kit both import from it, and putting names in scope fetches
 * nothing: the kit stays synthesised and offline stays offline. What it does
 * is stop the scope being a subset of the language everything else is written
 * in.
 */
export function initPatternScope(): Promise<void> {
  scopeReady ??= evalScope(core, mini, tonal, webaudio).then(() => undefined)
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
 * Run the project's prebake: definitions every slot can then use.
 *
 * Unlike a slot, this is evaluated for its **side effects** and its result is
 * thrown away, so it does not have to end in a pattern. That is also the only
 * way it can work: each slot is evaluated in its own scope, so a bare
 * `const foo = …` here is invisible everywhere else. What survives is what
 * Strudel and JavaScript keep globally — `register('name', …)`, a method on
 * `Pattern.prototype`, an assignment to `globalThis`.
 *
 * It goes through the transpiler like everything else, so mini-notation still
 * works inside a helper. That has one sharp edge worth knowing: the transpiler
 * rewrites **every double-quoted string** into a mini-notation pattern, so a
 * string that is meant to stay a string — a name, a preset key — has to be
 * single-quoted. `register("verb", …)` registers under a pattern rather than a
 * name and then silently does nothing.
 */
export async function runPrebake(code: string): Promise<void> {
  const trimmed = code.trim()
  if (!trimmed) return
  await initPatternScope()
  try {
    // The transpiler insists the last top-level statement be an *expression*,
    // because for a pattern it turns that statement into the return value. A
    // prebake has no reason to end in one — a function declaration is the
    // obvious way to finish — and gets `unexpected ast format without body
    // expression` for its trouble. A trailing literal satisfies it, costs
    // nothing, and leaves every line number above it alone.
    await evaluate(`${trimmed}\n;0`, transpiler)
  } catch (error) {
    throw new PatternError('prebake', error)
  }
}

/**
 * Prebake code that will not work, and will not say so either.
 *
 * `register("verb", …)` is the one worth catching. The transpiler rewrites the
 * double-quoted name into a mini-notation pattern, so the function registers
 * under a pattern instead of a name: no error, no exception, no function — and
 * nothing to search for when the slot that calls it says only that `verb` is
 * not a function. Single quotes are the whole fix.
 */
export function prebakeWarnings(code: string): string[] {
  const warnings: string[] = []
  if (/\bregister\s*\(\s*"/.test(code)) {
    warnings.push(
      'register("…") names the function with a double-quoted string, which the transpiler turns into a pattern — ' +
        "it will register nothing. Use single quotes: register('name', …)",
    )
  }
  return warnings
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
