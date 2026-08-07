/**
 * Resolving the project document into per-track timelines.
 *
 * This is the whole of the slot → chain → arrangement/grid resolution described
 * in PRD §7, and it is deliberately free of Strudel: a timeline is a plain
 * description of *which slot plays over which stretch of cycles*, which makes
 * the hard part of the system unit-testable without an audio context.
 * `audio/patterns.ts` turns a timeline into something that makes noise.
 */
import type { Project } from '../model/types'
import { barToCycle, quantum, slotCycles } from './timing'

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

export type TrackSource = 'arrangement' | 'live'

export interface TrackTimeline {
  timeline: Timeline
  /**
   * Absolute cycle at which this timeline's position 0 falls. The arrangement
   * is anchored to 0; a live-triggered cell is anchored to the cycle it was
   * triggered on, so it starts from its own first step rather than joining the
   * song part-way through.
   */
  offset: number
  source: TrackSource
  /** The slot or chain id a live trigger referenced, for the UI to highlight. */
  ref?: string
}

/** An override placed on a track by a scene or cell trigger (PRD §7.5). */
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
 * Tile a timeline across `[start, start + span)`, clipping the last repetition
 * if it does not fit. A placement shorter than its chain plays the front of the
 * chain and then moves on, the same way a shortened LSDJ phrase does.
 */
export function tile(inner: Timeline, start: number, span: number): Segment[] {
  if (inner.loop <= 0 || span <= 0) return []
  const out: Segment[] = []
  const repeats = Math.ceil(span / inner.loop)
  for (let r = 0; r < repeats; r += 1) {
    const base = quantum(start + r * inner.loop)
    for (const segment of inner.segments) {
      const begin = quantum(base + segment.begin)
      const end = quantum(Math.min(base + segment.end, start + span))
      if (end <= begin) continue
      out.push({ ...segment, begin, end })
      if (end >= quantum(start + span)) break
    }
  }
  return out
}

/** Total length of the arranged song in cycles; 0 when nothing is arranged. */
export function songCycles(project: Project): number {
  const { cyclesPerBar } = project.meta
  let lastBar = 0
  for (const placements of Object.values(project.arrangement.tracks)) {
    for (const placement of placements) {
      lastBar = Math.max(lastBar, placement.bar + placement.len)
    }
  }
  return quantum(barToCycle(lastBar, cyclesPerBar))
}

/**
 * One track's arrangement, laid out over the full song length so that every
 * track loops together. Gaps between placements are simply absent from
 * `segments` and play as silence.
 */
export function arrangementTimeline(project: Project, track: number, loop: number): Timeline {
  const placements = project.arrangement.tracks[String(track)] ?? []
  const { cyclesPerBar } = project.meta
  const segments: Segment[] = []
  for (const placement of [...placements].sort((a, b) => a.bar - b.bar)) {
    const start = barToCycle(placement.bar, cyclesPerBar)
    const span = barToCycle(placement.len, cyclesPerBar)
    segments.push(...tile(chainTimeline(project, placement.chain), start, span))
  }
  return { segments, loop }
}

/**
 * What every track should be playing, given the arrangement and any live
 * overrides on top of it.
 *
 * A live override wins over the arrangement on its track and on no other
 * (PRD §7.5); removing it hands the track back to the arrangement.
 */
export function resolveTracks(project: Project, overrides: Record<number, LiveOverride> = {}): Map<number, TrackTimeline> {
  const loop = songCycles(project)
  const result = new Map<number, TrackTimeline>()
  for (let track = 1; track <= project.meta.trackCount; track += 1) {
    const override = overrides[track]
    if (override) {
      result.set(track, {
        timeline: refTimeline(project, override.ref),
        offset: override.startCycle,
        source: 'live',
        ref: override.ref,
      })
    } else {
      result.set(track, { timeline: arrangementTimeline(project, track, loop), offset: 0, source: 'arrangement' })
    }
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

/** Every arrangement track and scene that references a chain. */
export function referencesToChain(project: Project, chainId: string): { tracks: number[]; scenes: string[] } {
  const tracks = Object.entries(project.arrangement.tracks)
    .filter(([, placements]) => placements.some((placement) => placement.chain === chainId))
    .map(([track]) => Number(track))
  const scenes = project.grid.scenes.filter((scene) => Object.values(scene.cells).includes(chainId)).map((scene) => scene.name)
  return { tracks, scenes }
}
