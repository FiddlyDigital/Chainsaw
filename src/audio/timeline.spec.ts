import { describe, expect, it } from 'vitest'
import { demoProject, emptyProject, makeSlot } from '../model/defaults'
import type { Project } from '../model/types'
import { arrangementTimeline, chainTimeline, refTimeline, resolveTracks, segmentAt, songCycles, tile } from './timeline'

/** A minimal project with two slots of different lengths and one chain. */
function fixture(): Project {
  const project = emptyProject()
  project.slots = {
    // one cycle
    A: makeSlot({ code: 's("bd*4")' }),
    // two cycles
    B: makeSlot({ code: 's("cp")', length: 32 }),
    // half a cycle
    C: makeSlot({ code: 's("hh*4")', length: 8 }),
  }
  project.chains = {
    CH: {
      track: 1,
      steps: [
        { slot: 'A', repeat: 2, transpose: 0, gainOffset: 0 },
        { slot: 'B', repeat: 1, transpose: 7, gainOffset: -0.2 },
      ],
    },
  }
  return project
}

describe('chainTimeline', () => {
  it('lays steps end to end, one segment per repeat', () => {
    const timeline = chainTimeline(fixture(), 'CH')
    expect(timeline.loop).toBe(4) // 1 + 1 + 2
    expect(timeline.segments).toEqual([
      { begin: 0, end: 1, slot: 'A', transpose: 0, gainOffset: 0 },
      { begin: 1, end: 2, slot: 'A', transpose: 0, gainOffset: 0 },
      { begin: 2, end: 4, slot: 'B', transpose: 7, gainOffset: -0.2 },
    ])
  })

  it('carries the step overrides onto every repeat without touching the slot', () => {
    const project = fixture()
    project.chains.CH.steps[0].transpose = 3
    const timeline = chainTimeline(project, 'CH')
    expect(timeline.segments.slice(0, 2).every((segment) => segment.transpose === 3)).toBe(true)
    expect(project.slots.A.code).toBe('s("bd*4")')
  })

  it('skips a step whose slot has gone missing rather than throwing', () => {
    const project = fixture()
    project.chains.CH.steps.push({ slot: 'GONE', repeat: 1, transpose: 0, gainOffset: 0 })
    expect(chainTimeline(project, 'CH').loop).toBe(4)
  })

  it('is empty for an unknown chain', () => {
    expect(chainTimeline(fixture(), 'nope')).toEqual({ segments: [], loop: 0 })
  })
})

describe('refTimeline', () => {
  it('resolves a slot id to a single segment of the slot"s own length', () => {
    expect(refTimeline(fixture(), 'C')).toEqual({
      segments: [{ begin: 0, end: 0.5, slot: 'C', transpose: 0, gainOffset: 0 }],
      loop: 0.5,
    })
  })

  it('resolves a chain id to the chain"s timeline', () => {
    expect(refTimeline(fixture(), 'CH').loop).toBe(4)
  })

  it('prefers a slot when both namespaces are searched', () => {
    // Ids are validated as unique across both, so a slot hit is decisive.
    expect(refTimeline(fixture(), 'A').segments[0].slot).toBe('A')
  })
})

describe('tile', () => {
  const inner = { segments: [{ begin: 0, end: 1, slot: 'A', transpose: 0, gainOffset: 0 }], loop: 1 }

  it('repeats to fill the span', () => {
    expect(tile(inner, 4, 3).map((segment) => [segment.begin, segment.end])).toEqual([
      [4, 5],
      [5, 6],
      [6, 7],
    ])
  })

  it('clips a repetition that would overrun the span', () => {
    const two = { segments: [{ begin: 0, end: 2, slot: 'B', transpose: 0, gainOffset: 0 }], loop: 2 }
    expect(tile(two, 0, 3).map((segment) => [segment.begin, segment.end])).toEqual([
      [0, 2],
      [2, 3],
    ])
  })

  it('produces nothing for an empty inner timeline', () => {
    expect(tile({ segments: [], loop: 0 }, 0, 8)).toEqual([])
  })
})

describe('arrangement', () => {
  it('measures the song by its last placement', () => {
    const project = fixture()
    project.arrangement.tracks['1'] = [
      { bar: 0, chain: 'CH', len: 4 },
      { bar: 8, chain: 'CH', len: 4 },
    ]
    expect(songCycles(project)).toBe(12)
  })

  it('leaves gaps between placements silent', () => {
    const project = fixture()
    project.arrangement.tracks['1'] = [
      { bar: 0, chain: 'CH', len: 4 },
      { bar: 8, chain: 'CH', len: 4 },
    ]
    const timeline = arrangementTimeline(project, 1, songCycles(project))
    const track = { timeline, offset: 0, source: 'arrangement' as const }
    expect(segmentAt(track, 0)?.slot).toBe('A')
    expect(segmentAt(track, 5)).toBeUndefined() // inside the gap
    expect(segmentAt(track, 8)?.slot).toBe('A') // second placement
  })

  it('follows the timeline across the boundary between two chains', () => {
    const project = fixture()
    project.chains.OTHER = { track: 1, steps: [{ slot: 'C', repeat: 1, transpose: 0, gainOffset: 0 }] }
    project.arrangement.tracks['1'] = [
      { bar: 0, chain: 'CH', len: 4 },
      { bar: 4, chain: 'OTHER', len: 2 },
    ]
    const track = {
      timeline: arrangementTimeline(project, 1, songCycles(project)),
      offset: 0,
      source: 'arrangement' as const,
    }
    expect(segmentAt(track, 3)?.slot).toBe('B') // tail of the first chain
    expect(segmentAt(track, 4)?.slot).toBe('C') // first cycle of the second
    // OTHER is half a cycle long, so it repeats four times to fill its two bars
    // rather than leaving the rest of the placement silent.
    expect(segmentAt(track, 4.5)?.begin).toBe(4.5)
    expect(segmentAt(track, 5.5)?.slot).toBe('C')
    // The song is six cycles long, so cycle 6 is cycle 0 again.
    expect(songCycles(project)).toBe(6)
    expect(segmentAt(track, 6)?.slot).toBe('A')
  })

  it('loops the whole song, so tracks stay in phase with each other', () => {
    const project = fixture()
    project.arrangement.tracks['1'] = [{ bar: 0, chain: 'CH', len: 4 }]
    project.arrangement.tracks['2'] = [{ bar: 0, chain: 'CH', len: 8 }]
    const loop = songCycles(project)
    expect(loop).toBe(8)
    const one = { timeline: arrangementTimeline(project, 1, loop), offset: 0, source: 'arrangement' as const }
    // Track 1's placement ends at cycle 4; the song does not loop until 8.
    expect(segmentAt(one, 5)).toBeUndefined()
    expect(segmentAt(one, 8)?.slot).toBe('A')
  })
})

describe('resolveTracks', () => {
  const project = (() => {
    const base = fixture()
    base.arrangement.tracks['1'] = [{ bar: 0, chain: 'CH', len: 4 }]
    return base
  })()

  it('gives every track a timeline, arranged or empty', () => {
    const tracks = resolveTracks(project)
    expect(tracks.size).toBe(project.meta.trackCount)
    expect(tracks.get(1)?.source).toBe('arrangement')
    expect(tracks.get(2)?.timeline.segments).toEqual([])
  })

  it('lets a live override win on its own track and no other', () => {
    const tracks = resolveTracks(project, { 1: { ref: 'C', startCycle: 9 } })
    expect(tracks.get(1)?.source).toBe('live')
    expect(tracks.get(1)?.ref).toBe('C')
    expect(tracks.get(2)?.source).toBe('arrangement')
  })

  it('starts an override at its own first step, not part-way through', () => {
    const tracks = resolveTracks(project, { 1: { ref: 'CH', startCycle: 9 } })
    const track = tracks.get(1)!
    expect(track.offset).toBe(9)
    expect(segmentAt(track, 9)?.slot).toBe('A')
    expect(segmentAt(track, 11)?.slot).toBe('B')
    // and loops from there
    expect(segmentAt(track, 13)?.slot).toBe('A')
  })

  it('hands the track back to the arrangement when the override is dropped', () => {
    expect(resolveTracks(project, {}).get(1)?.source).toBe('arrangement')
  })
})

describe('the demo project', () => {
  it('places two chains back to back on one track', () => {
    const project = demoProject()
    const loop = songCycles(project)
    const track = { timeline: arrangementTimeline(project, 1, loop), offset: 0, source: 'arrangement' as const }
    expect(segmentAt(track, 7)?.slot).toBe('A2') // last bar of DRUMS_A
    expect(segmentAt(track, 8)?.slot).toBe('A2') // first bar of DRUMS_B
    expect(segmentAt(track, 8)?.gainOffset).toBe(0.1) // …with DRUMS_B's offset
  })
})
