import { describe, expect, it } from 'vitest'
import { demoProject, emptyProject, makeSlot } from './defaults'
import type { Project } from './types'
import { validateProject } from './validate'

const messages = (project: unknown) => validateProject(project).errors.map((error) => error.message)

function base(): Project {
  const project = emptyProject()
  project.slots = { A1: makeSlot() }
  project.chains = { CH: { track: 1, steps: [{ slot: 'A1', repeat: 1, transpose: 0, gainOffset: 0 }] } }
  return project
}

describe('shape', () => {
  it('accepts an empty project and the demo project', () => {
    expect(validateProject(emptyProject()).ok).toBe(true)
    expect(validateProject(demoProject()).ok).toBe(true)
  })

  it('rejects anything that is not a project', () => {
    expect(validateProject(null).ok).toBe(false)
    expect(validateProject({}).ok).toBe(false)
    expect(validateProject('{}').ok).toBe(false)
  })

  it('rejects ids with spaces or punctuation', () => {
    const project = base()
    project.slots['bad id'] = makeSlot()
    expect(validateProject(project).ok).toBe(false)
  })

  it('rejects a track count outside 1-32', () => {
    expect(validateProject({ ...emptyProject(), meta: { ...emptyProject().meta, trackCount: 0 } }).ok).toBe(false)
    expect(validateProject({ ...emptyProject(), meta: { ...emptyProject().meta, trackCount: 33 } }).ok).toBe(false)
  })

  it('rejects unknown fields, so a typo cannot be silently dropped on save', () => {
    const project = base() as Project & { extra?: number }
    project.extra = 1
    expect(validateProject(project).ok).toBe(false)
  })
})

describe('references', () => {
  it('catches a slot pointing at a missing instrument', () => {
    const project = base()
    project.slots.A1.instrument = 'gone'
    expect(messages(project)).toContain('slot "A1" references unknown instrument "gone"')
  })

  it('catches a chain step pointing at a missing slot', () => {
    const project = base()
    project.chains.CH.steps[0].slot = 'gone'
    expect(messages(project)).toContain('chain "CH" step 0 references unknown slot "gone"')
  })

  it('catches an arrangement placement pointing at a missing chain', () => {
    const project = base()
    project.arrangement.tracks['1'] = [{ bar: 0, chain: 'gone', len: 4 }]
    expect(messages(project)[0]).toMatch(/unknown chain "gone"/)
  })

  it('catches a grid cell pointing at nothing', () => {
    const project = base()
    project.grid.scenes = [{ name: 'one', cells: { '1': 'gone' } }]
    expect(messages(project)[0]).toMatch(/references unknown "gone"/)
  })

  it('accepts a grid cell holding either a slot or a chain', () => {
    const project = base()
    project.grid.scenes = [{ name: 'one', cells: { '1': 'A1', '2': 'CH' } }]
    expect(validateProject(project).ok).toBe(true)
  })

  it('rejects an id shared between a slot and a chain', () => {
    const project = base()
    project.chains.A1 = { track: 1, steps: [] }
    expect(messages(project)[0]).toMatch(/used by both a slot and a chain/)
  })

  it('rejects a track number above the track count', () => {
    const project = base()
    project.chains.CH.track = 9
    project.arrangement.tracks['9'] = []
    const found = messages(project)
    expect(found.some((message) => message.includes('chain "CH" is on track 9'))).toBe(true)
    expect(found.some((message) => message.includes('arrangement track 9'))).toBe(true)
  })

  it('rejects overlapping placements on one track', () => {
    const project = base()
    project.arrangement.tracks['1'] = [
      { bar: 0, chain: 'CH', len: 8 },
      { bar: 4, chain: 'CH', len: 4 },
    ]
    expect(messages(project)[0]).toMatch(/placements overlap on track 1/)
  })

  it('accepts placements that touch but do not overlap', () => {
    const project = base()
    project.arrangement.tracks['1'] = [
      { bar: 0, chain: 'CH', len: 4 },
      { bar: 4, chain: 'CH', len: 4 },
    ]
    expect(validateProject(project).ok).toBe(true)
  })

  it('allows the same chain on two different tracks at the same bar', () => {
    const project = base()
    project.arrangement.tracks['1'] = [{ bar: 0, chain: 'CH', len: 4 }]
    project.arrangement.tracks['2'] = [{ bar: 0, chain: 'CH', len: 4 }]
    expect(validateProject(project).ok).toBe(true)
  })

  it('rejects duplicate scene names', () => {
    const project = base()
    project.grid.scenes = [
      { name: 'one', cells: {} },
      { name: 'one', cells: {} },
    ]
    expect(messages(project)[0]).toMatch(/duplicate scene name/)
  })

  it('catches saved live state that has gone stale', () => {
    const project = base()
    project.meta.lastSceneState = { cells: { '1': 'gone' } }
    expect(messages(project)[0]).toMatch(/saved live state references unknown "gone"/)
  })
})
