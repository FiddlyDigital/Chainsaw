/**
 * Resolving the project document into per-track timelines.
 *
 * This is the whole of the slot → chain → arrangement/grid resolution described
 * in PRD §7, and it is deliberately free of Strudel: a timeline is a plain
 * description of *which slot plays over which stretch of cycles*, which makes
 * the hard part of the system unit-testable without an audio context.
 * `audio/patterns.ts` turns a timeline into something that makes noise.
 */
import type { Project, Scene } from '../model/types'
import { quantum, slotCycles } from './timing'

/** A slot together with the per-chain-step overrides that apply to this playing of it. */
export interface SlotRef {
  slot: string
  transpose: number
  gainOffset: number
}

/** A slot occupying `[begin, end)` on a timeline, measured in cycles. */
export interface Segment extends SlotRef {
  begin: number
  end: number
}

export interface Timeline {
  segments: Segment[]
  /** Total length in cycles; the timeline repeats after this. 0 means silence. */
  loop: number
}

export const EMPTY_TIMELINE: Timeline = { segments: [], loop: 0 }

export interface TrackTimeline {
  timeline: Timeline
  /**
   * Absolute cycle at which this timeline's position 0 falls: the cycle the
   * clip was triggered on, so it starts from its own first step.
   */
  offset: number
  /** The slot or chain id that was triggered, for the UI to highlight. */
  ref?: string
}

/** What a scene or cell trigger put on a track (PRD §7.5). */
export interface LiveOverride {
  /** A slot id or a chain id. */
  ref: string
  /** Absolute cycle the override starts at. */
  startCycle: number
}

/** Laying a chain out end to end: one segment per repeat of each step. */
export function chainTimeline(project: Project, chainId: string): Timeline {
  const chain = project.chains[chainId]
  if (!chain) return EMPTY_TIMELINE

  const segments: Segment[] = []
  let cursor = 0
  for (const step of chain.steps) {
    const slot = project.slots[step.slot]
    if (!slot) continue // validation reports this; playback simply skips it
    const duration = slotCycles(slot)
    if (duration <= 0) continue
    for (let r = 0; r < step.repeat; r += 1) {
      segments.push({
        begin: quantum(cursor),
        end: quantum(cursor + duration),
        slot: step.slot,
        transpose: step.transpose,
        gainOffset: step.gainOffset,
      })
      cursor = quantum(cursor + duration)
    }
  }
  return { segments, loop: cursor }
}

/** A grid cell holds either a slot id or a chain id; slots first, per PRD §6. */
export function refTimeline(project: Project, ref: string): Timeline {
  const slot = project.slots[ref]
  if (slot) {
    const duration = slotCycles(slot)
    if (duration <= 0) return EMPTY_TIMELINE
    return {
      segments: [{ begin: 0, end: duration, slot: ref, transpose: 0, gainOffset: 0 }],
      loop: duration,
    }
  }
  if (project.chains[ref]) return chainTimeline(project, ref)
  return EMPTY_TIMELINE
}

/**
 * How long a scene runs before it has played through, in cycles.
 *
 * Its longest cell: the scene is done when the last of its clips has had one
 * full pass, so nothing is cut off part-way. A scene with nothing in it — or
 * with only references that no longer resolve — returns 0, which callers read
 * as "no length", not "advance immediately".
 */
export function sceneCycles(project: Project, scene: Scene): number {
  let longest = 0
  for (const ref of Object.values(scene.cells)) {
    longest = Math.max(longest, refTimeline(project, ref).loop)
  }
  return longest
}

/**
 * What every track is playing.
 *
 * The grid is the whole of it: a track plays whatever was last triggered on it
 * and nothing otherwise. Each clip is anchored to the cycle it was fired on, so
 * it starts from its own first step rather than joining something already in
 * progress — there is no longer a written song for it to join.
 */
export function resolveTracks(project: Project, overrides: Record<number, LiveOverride> = {}): Map<number, TrackTimeline> {
  const result = new Map<number, TrackTimeline>()
  for (let track = 1; track <= project.meta.trackCount; track += 1) {
    const override = overrides[track]
    result.set(
      track,
      override
        ? { timeline: refTimeline(project, override.ref), offset: override.startCycle, ref: override.ref }
        : { timeline: EMPTY_TIMELINE, offset: 0 },
    )
  }
  return result
}

/** The segment playing at an absolute cycle position, or undefined for silence. */
export function segmentAt(track: TrackTimeline, cycle: number): Segment | undefined {
  const { timeline, offset } = track
  if (timeline.loop <= 0) return undefined
  const local = quantum((((cycle - offset) % timeline.loop) + timeline.loop) % timeline.loop)
  return timeline.segments.find((segment) => local >= segment.begin && local < segment.end)
}

/** Every chain that references a slot, and every track those chains reach. */
export function referencesToSlot(project: Project, slotId: string): { chains: string[]; scenes: string[] } {
  const chains = Object.entries(project.chains)
    .filter(([, chain]) => chain.steps.some((step) => step.slot === slotId))
    .map(([id]) => id)
  const scenes = project.grid.scenes.filter((scene) => Object.values(scene.cells).includes(slotId)).map((scene) => scene.name)
  return { chains, scenes }
}

/** Every scene that references a chain. */
export function referencesToChain(project: Project, chainId: string): { scenes: string[] } {
  const scenes = project.grid.scenes.filter((scene) => Object.values(scene.cells).includes(chainId)).map((scene) => scene.name)
  return { scenes }
}
