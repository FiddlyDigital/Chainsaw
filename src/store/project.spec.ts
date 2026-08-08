import { beforeEach, describe, expect, it } from 'vitest'
import { emptyProject, makeSlot } from '../model/defaults'
import { validateProject } from '../model/validate'
import { useProject } from './project'

const store = () => useProject.getState()
const project = () => useProject.getState().project

beforeEach(() => {
  useProject.setState({
    project: emptyProject(),
    past: [],
    future: [],
    lastError: null,
    dirty: false,
  })
})

describe('mutations', () => {
  it('creates a slot with the project"s default length', () => {
    store().setMeta({ defaultSlotLength: 32 })
    expect(store().createSlot('A1')).toBe(true)
    expect(project().slots.A1.length).toBe(32)
  })

  it('refuses an id that is not a valid name', () => {
    expect(store().createSlot('bad id')).toBe(false)
    expect(store().lastError).toMatch(/not a valid id/)
    expect(project().slots['bad id']).toBeUndefined()
  })

  it('refuses an id already used by a chain, because the grid shares one namespace', () => {
    store().createChain('X', 1)
    expect(store().createSlot('X')).toBe(false)
    expect(store().lastError).toMatch(/already a chain/)
  })

  it('renames a slot everywhere it is referenced', () => {
    store().createSlot('A1')
    store().createChain('CH', 1)
    store().addChainStep('CH', { slot: 'A1', repeat: 1, transpose: 0, gainOffset: 0 })
    store().addScene('one')
    store().setCell(0, 1, 'A1')

    expect(store().renameSlot('A1', 'KICK')).toBe(true)
    expect(project().slots.KICK).toBeDefined()
    expect(project().slots.A1).toBeUndefined()
    expect(project().chains.CH.steps[0].slot).toBe('KICK')
    expect(project().grid.scenes[0].cells['1']).toBe('KICK')
  })

  it('removes a slot from every chain and scene that used it', () => {
    store().createSlot('A1')
    store().createChain('CH', 1)
    store().addChainStep('CH', { slot: 'A1', repeat: 1, transpose: 0, gainOffset: 0 })
    store().addScene('one')
    store().setCell(0, 1, 'A1')

    expect(store().removeSlot('A1')).toBe(true)
    expect(project().chains.CH.steps).toEqual([])
    expect(project().grid.scenes[0].cells['1']).toBeUndefined()
    expect(validateProject(project()).ok).toBe(true)
  })

  it('removes a chain from the arrangement that used it', () => {
    store().createSlot('A1')
    store().createChain('CH', 1)
    store().placeChain(1, { bar: 0, chain: 'CH', len: 4 })
    store().removeChain('CH')
    expect(project().arrangement.tracks['1']).toEqual([])
  })

  it('keeps a track"s placements sorted by bar', () => {
    store().createSlot('A1')
    store().createChain('CH', 1)
    store().placeChain(1, { bar: 8, chain: 'CH', len: 4 })
    store().placeChain(1, { bar: 0, chain: 'CH', len: 4 })
    expect(project().arrangement.tracks['1'].map((placement) => placement.bar)).toEqual([0, 8])
  })

  it('reorders chain steps', () => {
    store().createSlot('A1')
    store().createSlot('A2')
    store().createChain('CH', 1)
    store().addChainStep('CH', { slot: 'A1', repeat: 1, transpose: 0, gainOffset: 0 })
    store().addChainStep('CH', { slot: 'A2', repeat: 1, transpose: 0, gainOffset: 0 })
    store().moveChainStep('CH', 1, 0)
    expect(project().chains.CH.steps.map((step) => step.slot)).toEqual(['A2', 'A1'])
  })

  it('ignores a reorder that would fall off the end', () => {
    store().createSlot('A1')
    store().createChain('CH', 1)
    store().addChainStep('CH', { slot: 'A1', repeat: 1, transpose: 0, gainOffset: 0 })
    expect(store().moveChainStep('CH', 0, 5)).toBe(true)
    expect(project().chains.CH.steps).toHaveLength(1)
  })
})

describe('rejection', () => {
  it('rejects a placement that would overlap, leaving the document untouched', () => {
    store().createSlot('A1')
    store().createChain('CH', 1)
    store().placeChain(1, { bar: 0, chain: 'CH', len: 8 })
    const before = project()

    expect(store().placeChain(1, { bar: 4, chain: 'CH', len: 4 })).toBe(false)
    expect(project()).toBe(before)
    expect(store().lastError).toMatch(/overlap/)
  })

  it('rejects a chain moved to a track that does not exist', () => {
    store().createChain('CH', 1)
    const before = project()
    expect(store().updateChain('CH', { track: 99 })).toBe(false)
    expect(project()).toBe(before)
  })

  it('rejects a rename onto a taken id', () => {
    store().createSlot('A1')
    store().createSlot('A2')
    expect(store().renameSlot('A1', 'A2')).toBe(false)
    expect(project().slots.A1).toBeDefined()
  })

  it('reports a mutation aimed at something that has gone', () => {
    expect(store().updateSlot('nope', { code: 'x' })).toBe(false)
    expect(store().lastError).toMatch(/no slot "nope"/)
  })

  it('does not push a rejected mutation onto the undo stack', () => {
    store().createSlot('A1')
    const depth = store().past.length
    store().createSlot('A1')
    expect(store().past.length).toBe(depth)
  })
})

describe('track count', () => {
  it('drops arrangement and scene data above the new bound', () => {
    store().createSlot('A1')
    store().createChain('CH', 6)
    store().placeChain(6, { bar: 0, chain: 'CH', len: 4 })
    store().addScene('one')
    store().setCell(0, 6, 'A1')

    expect(store().setMeta({ trackCount: 4 })).toBe(true)
    expect(project().arrangement.tracks['6']).toBeUndefined()
    expect(project().grid.scenes[0].cells['6']).toBeUndefined()
    expect(project().chains.CH.track).toBe(4)
    expect(validateProject(project()).ok).toBe(true)
  })

  it('leaves data alone when the count grows', () => {
    store().createSlot('A1')
    store().createChain('CH', 1)
    store().placeChain(1, { bar: 0, chain: 'CH', len: 4 })
    store().setMeta({ trackCount: 16 })
    expect(project().arrangement.tracks['1']).toHaveLength(1)
  })
})

describe('scene order', () => {
  const names = () => project().grid.scenes.map((scene) => scene.name)

  beforeEach(() => {
    store().addScene('one')
    store().addScene('two')
    store().addScene('three')
  })

  it('moves a scene up and down the list', () => {
    expect(store().moveScene(2, 0)).toBe(true)
    expect(names()).toEqual(['three', 'one', 'two'])
    expect(store().moveScene(0, 1)).toBe(true)
    expect(names()).toEqual(['one', 'three', 'two'])
  })

  it('carries the scene"s cells with it', () => {
    store().createSlot('A1')
    store().setCell(2, 1, 'A1')
    store().moveScene(2, 0)
    expect(project().grid.scenes[0].cells['1']).toBe('A1')
  })

  it('does nothing at the ends of the list', () => {
    expect(store().moveScene(0, -1)).toBe(true)
    expect(store().moveScene(2, 3)).toBe(true)
    expect(names()).toEqual(['one', 'two', 'three'])
  })

  it('is undoable', () => {
    store().moveScene(0, 2)
    expect(names()).toEqual(['two', 'three', 'one'])
    store().undo()
    expect(names()).toEqual(['one', 'two', 'three'])
  })
})

describe('the track mixer', () => {
  it('records a mute and validates', () => {
    expect(store().setTrack(2, { muted: true })).toBe(true)
    expect(project().tracks?.['2']).toEqual({ muted: true })
    expect(validateProject(project()).ok).toBe(true)
  })

  it('keeps the record sparse: a track back at its defaults leaves no trace', () => {
    store().setTrack(2, { muted: true })
    store().setTrack(2, { soloed: true })
    expect(project().tracks?.['2']).toEqual({ muted: true, soloed: true })

    store().setTrack(2, { muted: false })
    expect(project().tracks?.['2']).toEqual({ soloed: true })

    store().setTrack(2, { soloed: false })
    // The last flag off takes the whole record with it, so an untouched
    // project never grows a `tracks` key at all.
    expect(project().tracks).toBeUndefined()
  })

  it('drops every solo at once, leaving mutes alone', () => {
    store().setTrack(1, { soloed: true })
    store().setTrack(2, { soloed: true, muted: true })
    expect(store().clearTrackSolos()).toBe(true)
    expect(project().tracks?.['1']).toBeUndefined()
    expect(project().tracks?.['2']).toEqual({ muted: true })
  })

  it('is undoable like any other edit', () => {
    store().setTrack(3, { muted: true })
    store().undo()
    expect(project().tracks).toBeUndefined()
  })

  it('keeps a fader pulled all the way down', () => {
    // 0 is falsy, and dropping it would silently restore the track to unity.
    expect(store().setTrack(1, { gain: 0 })).toBe(true)
    expect(project().tracks?.['1']).toEqual({ gain: 0 })
    expect(validateProject(project()).ok).toBe(true)
  })

  it('drops a fader back at unity', () => {
    // 1 is truthy, and keeping it would leave a no-op entry in every file.
    store().setTrack(1, { gain: 0.5 })
    expect(project().tracks?.['1']).toEqual({ gain: 0.5 })
    store().setTrack(1, { gain: 1 })
    expect(project().tracks).toBeUndefined()
  })

  it('carries a fader alongside the flags without either clobbering the other', () => {
    store().setTrack(1, { gain: 0.25 })
    store().setTrack(1, { muted: true })
    expect(project().tracks?.['1']).toEqual({ gain: 0.25, muted: true })
    store().setTrack(1, { muted: false })
    expect(project().tracks?.['1']).toEqual({ gain: 0.25 })
  })

  it('drops mixer state above a shrunken track count', () => {
    store().setTrack(6, { muted: true })
    expect(store().setMeta({ trackCount: 4 })).toBe(true)
    expect(project().tracks).toBeUndefined()
    expect(validateProject(project()).ok).toBe(true)
  })
})

describe('undo and redo', () => {
  it('steps back and forward through edits', () => {
    store().createSlot('A1')
    store().updateSlot('A1', { code: 'first' })
    store().updateSlot('A1', { code: 'second' })

    store().undo()
    expect(project().slots.A1.code).toBe('first')
    store().undo()
    expect(project().slots.A1.code).toBe(makeSlot().code)
    store().redo()
    expect(project().slots.A1.code).toBe('first')
  })

  it('drops the redo stack once a new edit is made', () => {
    store().createSlot('A1')
    store().updateSlot('A1', { code: 'first' })
    store().undo()
    store().updateSlot('A1', { code: 'other' })
    expect(store().future).toEqual([])
  })

  it('does nothing at the ends of the stack', () => {
    const before = project()
    store().undo()
    store().redo()
    expect(project()).toBe(before)
  })
})

describe('live state', () => {
  it('records what is playing without becoming an undoable edit', () => {
    store().createSlot('A1')
    const depth = store().past.length
    store().setLastSceneState({ '1': 'A1' }, 'drop')
    expect(project().meta.lastSceneState).toEqual({ cells: { '1': 'A1' }, scene: 'drop' })
    expect(store().past.length).toBe(depth)
  })
})

describe('load', () => {
  it('refuses a document that does not validate and keeps the current one', () => {
    const before = project()
    expect(store().load({ meta: {} } as never)).toBe(false)
    expect(project()).toBe(before)
  })

  it('accepts a valid document and clears the history', () => {
    store().createSlot('A1')
    const incoming = emptyProject('other')
    expect(store().load(incoming)).toBe(true)
    expect(project().meta.name).toBe('other')
    expect(store().past).toEqual([])
    expect(store().dirty).toBe(false)
  })
})
