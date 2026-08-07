/**
 * The Chainsaw project document.
 *
 * These types are the TypeScript mirror of `schema/project.schema.json`, which
 * is the authoritative definition. Keep the two in step: the schema is what
 * `model/validate.ts` enforces on load and on every mutation.
 */

/** Quantization applied to live scene/cell triggers and to code edits. */
export type Quantize = 'immediate' | 'cycle' | 'bar'

/** Step resolution of a slot, expressed as a note division of one cycle. */
export type StepResolution = '1n' | '2n' | '4n' | '8n' | '16n' | '32n' | '64n'

/** What a track is playing right now, when it is not following the arrangement. */
export interface SceneState {
  /** Track number (as a string, to match the rest of the schema) -> slot or chain id. */
  cells: Record<string, string>
  /** Name of the scene last triggered whole, if any. */
  scene?: string
}

export interface Meta {
  name: string
  bpm: number
  cyclesPerBar: number
  trackCount: number
  defaultSlotLength: number
  created: string
  modified: string
  version: string
  /** Global trigger quantization (§7.5). Defaults to `bar`. */
  quantize?: Quantize
  /**
   * Live overrides at the moment the project was saved, so a project saved
   * mid-performance restores what was playing (§7.5). Never read by the
   * arrangement itself.
   */
  lastSceneState?: SceneState
}

export interface Instrument {
  /** A Strudel expression describing the sound, e.g. `s("piano").lpf(800)`. */
  base: string
  notes?: string
}

export interface Slot {
  /** Optional instrument id. When omitted, `code` must stand on its own. */
  instrument?: string
  /** A Strudel pattern expression. Must not embed the instrument's `base`. */
  code: string
  /** Phrase length, counted in `steps` units. */
  length: number
  steps: StepResolution
  color: string
  muted: boolean
}

export interface ChainStep {
  slot: string
  repeat: number
  /** Semitone offset for this step only. Does not mutate the slot. */
  transpose: number
  /** Additive gain offset for this step only. */
  gainOffset: number
}

export interface Chain {
  track: number
  steps: ChainStep[]
}

export interface Placement {
  bar: number
  chain: string
  len: number
}

export interface Scene {
  name: string
  /** Track number (as a string) -> slot id or chain id. */
  cells: Record<string, string>
}

export interface Project {
  meta: Meta
  instruments: Record<string, Instrument>
  slots: Record<string, Slot>
  chains: Record<string, Chain>
  arrangement: { tracks: Record<string, Placement[]> }
  grid: { scenes: Scene[] }
}

export const STEP_RESOLUTIONS: StepResolution[] = ['1n', '2n', '4n', '8n', '16n', '32n', '64n']

export const QUANTIZE_OPTIONS: Quantize[] = ['immediate', 'cycle', 'bar']

/** Beats in a bar. Fixed at 4 in v1; `cyclesPerBar` is the tempo lever. */
export const BEATS_PER_BAR = 4

export const MIN_TRACKS = 1
export const MAX_TRACKS = 32
