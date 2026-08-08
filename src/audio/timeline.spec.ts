import { describe, expect, it } from 'vitest'
import { demoProject, emptyProject, makeSlot } from '../model/defaults'
import type { Project } from '../model/types'
import { chainTimeline, refTimeline, resolveTracks, sceneCycles, segmentAt } from './timeline'

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

describe('sceneCycles', () => {
  const scene = (cells: Record<string, string>) => ({ name: 'S', cells })

  it('is the longest cell, so nothing is cut off part-way', () => {
    // A is one cycle, B is two, C is a half.
    expect(sceneCycles(fixture(), scene({ '1': 'A', '2': 'B', '3': 'C' }))).toBe(2)
  })

  it('measures a chain by its whole run, not by one step', () => {
    // CH is A twice then B once: 1 + 1 + 2 = 4 cycles.
    expect(sceneCycles(fixture(), scene({ '1': 'CH' }))).toBe(4)
    // …and it wins over a longer single slot only because it really is longer.
    expect(sceneCycles(fixture(), scene({ '1': 'CH', '2': 'B' }))).toBe(4)
  })

  it('is zero for a scene with nothing in it', () => {
    expect(sceneCycles(fixture(), scene({}))).toBe(0)
  })

  it('ignores a reference that no longer resolves', () => {
    expect(sceneCycles(fixture(), scene({ '1': 'A', '2': 'GONE' }))).toBe(1)
    expect(sceneCycles(fixture(), scene({ '1': 'GONE' }))).toBe(0)
  })
})

describe('resolveTracks', () => {
  const project = fixture()

  it('gives every track a timeline, silent until something is triggered', () => {
    const tracks = resolveTracks(project)
    expect(tracks.size).toBe(project.meta.trackCount)
    for (const track of tracks.values()) expect(track.timeline.segments).toEqual([])
  })

  it('plays a triggered clip on its own track and no other', () => {
    const tracks = resolveTracks(project, { 1: { ref: 'C', startCycle: 9 } })
    expect(tracks.get(1)?.ref).toBe('C')
    expect(tracks.get(2)?.ref).toBeUndefined()
    expect(tracks.get(2)?.timeline.segments).toEqual([])
  })

  it('starts a clip at its own first step, not part-way through', () => {
    const tracks = resolveTracks(project, { 1: { ref: 'CH', startCycle: 9 } })
    const track = tracks.get(1)!
    expect(track.offset).toBe(9)
    expect(segmentAt(track, 9)?.slot).toBe('A')
    expect(segmentAt(track, 11)?.slot).toBe('B')
    // and loops from there
    expect(segmentAt(track, 13)?.slot).toBe('A')
  })

  it('leaves the track silent once the clip is stopped', () => {
    const track = resolveTracks(project, {}).get(1)!
    expect(track.timeline.segments).toEqual([])
    expect(segmentAt(track, 4)).toBeUndefined()
  })
})

describe('the demo project', () => {
  it('leaves nothing in it unreachable from the grid', () => {
    // With the grid the only way to play anything, a slot or chain no scene
    // references is dead weight in the file people first see.
    const project = demoProject()
    const referenced = new Set(project.grid.scenes.flatMap((scene) => Object.values(scene.cells)))
    const reachableSlots = new Set(
      [...referenced].flatMap((ref) =>
        project.slots[ref] ? [ref] : (project.chains[ref]?.steps.map((step) => step.slot) ?? []),
      ),
    )
    expect([...Object.keys(project.chains)].filter((id) => !referenced.has(id))).toEqual([])
    expect([...Object.keys(project.slots)].filter((id) => !reachableSlots.has(id))).toEqual([])
  })
})
