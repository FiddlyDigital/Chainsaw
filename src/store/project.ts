/**
 * The Project Store (PRD §5).
 *
 * Single source of truth, shaped exactly like the JSON on disk. Every UI action
 * lands here; the scheduler observes it. Two rules hold for all of it:
 *
 *  - A mutation that would produce an invalid document is **rejected whole**.
 *    The recipe runs against a draft, so a rejected mutation leaves the live
 *    store byte-identical to what it was.
 *  - Every accepted mutation pushes the previous document onto the undo stack.
 */
import { produce } from 'immer'
import { create } from 'zustand'
import { demoProject, isValidId, makeSlot } from '../model/defaults'
import {
  TRACK_DEFAULTS,
  type Chain,
  type ChainStep,
  type Instrument,
  type Meta,
  type Project,
  type Scene,
  type Slot,
  type TrackSettings,
} from '../model/types'
import { formatErrors, validateProject } from '../model/validate'

const UNDO_LIMIT = 100

export interface ProjectStore {
  project: Project
  past: Project[]
  future: Project[]
  /** Message from the most recent rejected mutation, for inline display. */
  lastError: string | null
  /** True when there are changes not yet written to a file. */
  dirty: boolean

  apply: (recipe: (draft: Project) => void, options?: { silent?: boolean }) => boolean
  load: (project: Project) => boolean
  reset: () => void
  undo: () => void
  redo: () => void
  clearError: () => void
  markSaved: () => void

  setMeta: (patch: Partial<Meta>) => boolean

  /** Patch a track's mixer state. Clearing every flag drops it from the document. */
  setTrack: (track: number, patch: Partial<TrackSettings>) => boolean
  /** Drop every solo at once — the way out when several are lit. */
  clearTrackSolos: () => boolean

  /** Replace the project's prebake. Empty string removes it from the document. */
  setPrebake: (code: string) => boolean

  upsertInstrument: (id: string, instrument: Instrument) => boolean
  removeInstrument: (id: string) => boolean

  createSlot: (id: string, slot?: Partial<Slot>) => boolean
  updateSlot: (id: string, patch: Partial<Slot>) => boolean
  renameSlot: (id: string, next: string) => boolean
  removeSlot: (id: string) => boolean

  createChain: (id: string, track: number) => boolean
  updateChain: (id: string, patch: Partial<Chain>) => boolean
  renameChain: (id: string, next: string) => boolean
  removeChain: (id: string) => boolean
  addChainStep: (id: string, step: ChainStep, index?: number) => boolean
  updateChainStep: (id: string, index: number, patch: Partial<ChainStep>) => boolean
  removeChainStep: (id: string, index: number) => boolean
  moveChainStep: (id: string, from: number, to: number) => boolean

  addScene: (name: string) => boolean
  renameScene: (index: number, name: string) => boolean
  removeScene: (index: number) => boolean
  /** Reorder the scene list. Out-of-range indices are a no-op. */
  moveScene: (from: number, to: number) => boolean
  setCell: (index: number, track: number, ref: string | null) => boolean
  setLastSceneState: (cells: Record<string, string>, scene?: string) => boolean
}

function touch(project: Project): Project {
  return { ...project, meta: { ...project.meta, modified: new Date().toISOString() } }
}

export const useProject = create<ProjectStore>()((set, get) => ({
  project: demoProject(),
  past: [],
  future: [],
  lastError: null,
  dirty: false,

  apply(recipe, options) {
    const current = get().project
    let next: Project
    try {
      next = produce(current, (draft) => recipe(draft))
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : String(error) })
      return false
    }
    if (next === current) return true

    const stamped = touch(next)
    const result = validateProject(stamped)
    if (!result.ok) {
      set({ lastError: formatErrors(result.errors) })
      return false
    }
    set((state) => ({
      project: stamped,
      past: options?.silent ? state.past : [...state.past, current].slice(-UNDO_LIMIT),
      future: options?.silent ? state.future : [],
      lastError: null,
      dirty: true,
    }))
    return true
  },

  load(project) {
    const result = validateProject(project)
    if (!result.ok) {
      set({ lastError: formatErrors(result.errors) })
      return false
    }
    set({ project, past: [], future: [], lastError: null, dirty: false })
    return true
  },

  reset() {
    set({ project: demoProject(), past: [], future: [], lastError: null, dirty: false })
  },

  undo() {
    const { past, project, future } = get()
    const previous = past[past.length - 1]
    if (!previous) return
    set({ project: previous, past: past.slice(0, -1), future: [project, ...future], dirty: true })
  },

  redo() {
    const { past, project, future } = get()
    const [next, ...rest] = future
    if (!next) return
    set({ project: next, past: [...past, project], future: rest, dirty: true })
  },

  clearError() {
    set({ lastError: null })
  },

  markSaved() {
    set({ dirty: false })
  },

  setMeta(patch) {
    return get().apply((draft) => {
      Object.assign(draft.meta, patch)
      if (patch.trackCount !== undefined) {
        // Data beyond the new bound would dangle; the caller confirms first.
        for (const scene of draft.grid.scenes) {
          for (const key of Object.keys(scene.cells)) {
            if (Number(key) > patch.trackCount) delete scene.cells[key]
          }
        }
        for (const chain of Object.values(draft.chains)) {
          if (chain.track > patch.trackCount) chain.track = patch.trackCount
        }
        for (const key of Object.keys(draft.meta.lastSceneState?.cells ?? {})) {
          if (Number(key) > patch.trackCount) delete draft.meta.lastSceneState!.cells[key]
        }
        for (const key of Object.keys(draft.tracks ?? {})) {
          if (Number(key) > patch.trackCount) delete draft.tracks![key]
        }
        if (draft.tracks && Object.keys(draft.tracks).length === 0) delete draft.tracks
      }
    })
  },

  setTrack(track, patch) {
    return get().apply((draft) => {
      const key = String(track)
      const next: TrackSettings = { ...draft.tracks?.[key], ...patch }
      // Keep the record sparse: a track back at its defaults leaves no trace in
      // the document, so the mixer costs nothing to a project that ignores it.
      // Compared field by field rather than by truthiness — a fader at 0 is
      // falsy and meaningful, and a fader at 1 is truthy and the default.
      for (const name of Object.keys(next) as (keyof TrackSettings)[]) {
        if (next[name] === TRACK_DEFAULTS[name]) delete next[name]
      }
      if (Object.keys(next).length === 0) {
        if (draft.tracks) delete draft.tracks[key]
        if (draft.tracks && Object.keys(draft.tracks).length === 0) delete draft.tracks
        return
      }
      draft.tracks ??= {}
      draft.tracks[key] = next
    })
  },

  clearTrackSolos() {
    return get().apply((draft) => {
      for (const [key, settings] of Object.entries(draft.tracks ?? {})) {
        if (!settings.soloed) continue
        delete settings.soloed
        if (Object.keys(settings).length === 0) delete draft.tracks![key]
      }
      if (draft.tracks && Object.keys(draft.tracks).length === 0) delete draft.tracks
    })
  },

  setPrebake(code) {
    return get().apply((draft) => {
      // Absent rather than empty, so a project that does not use one carries no
      // trace of it — the same rule the mixer follows.
      if (code.trim()) draft.prebake = code
      else delete draft.prebake
    })
  },

  upsertInstrument(id, instrument) {
    if (!isValidId(id)) return fail(set, `"${id}" is not a valid id (letters, digits, - and _ only)`)
    return get().apply((draft) => {
      draft.instruments[id] = instrument
    })
  },

  removeInstrument(id) {
    return get().apply((draft) => {
      delete draft.instruments[id]
      for (const slot of Object.values(draft.slots)) {
        if (slot.instrument === id) delete slot.instrument
      }
    })
  },

  createSlot(id, slot) {
    if (!isValidId(id)) return fail(set, `"${id}" is not a valid id (letters, digits, - and _ only)`)
    const { project } = get()
    if (id in project.slots) return fail(set, `slot "${id}" already exists`)
    if (id in project.chains) return fail(set, `"${id}" is already a chain; ids are shared between slots and chains`)
    return get().apply((draft) => {
      draft.slots[id] = makeSlot({ length: draft.meta.defaultSlotLength, ...slot })
    })
  },

  updateSlot(id, patch) {
    return get().apply((draft) => {
      const slot = draft.slots[id]
      if (!slot) throw new Error(`no slot "${id}"`)
      Object.assign(slot, patch)
    })
  },

  renameSlot(id, next) {
    if (!isValidId(next)) return fail(set, `"${next}" is not a valid id`)
    const { project } = get()
    if (next !== id && (next in project.slots || next in project.chains)) {
      return fail(set, `"${next}" is already taken`)
    }
    return get().apply((draft) => {
      const slot = draft.slots[id]
      if (!slot) throw new Error(`no slot "${id}"`)
      delete draft.slots[id]
      draft.slots[next] = slot
      for (const chain of Object.values(draft.chains)) {
        for (const step of chain.steps) if (step.slot === id) step.slot = next
      }
      renameCellRefs(draft, id, next)
    })
  },

  removeSlot(id) {
    return get().apply((draft) => {
      delete draft.slots[id]
      for (const chain of Object.values(draft.chains)) {
        chain.steps = chain.steps.filter((step) => step.slot !== id)
      }
      dropCellRefs(draft, id)
    })
  },

  createChain(id, track) {
    if (!isValidId(id)) return fail(set, `"${id}" is not a valid id`)
    const { project } = get()
    if (id in project.chains) return fail(set, `chain "${id}" already exists`)
    if (id in project.slots) return fail(set, `"${id}" is already a slot; ids are shared between slots and chains`)
    return get().apply((draft) => {
      draft.chains[id] = { track, steps: [] }
    })
  },

  updateChain(id, patch) {
    return get().apply((draft) => {
      const chain = draft.chains[id]
      if (!chain) throw new Error(`no chain "${id}"`)
      Object.assign(chain, patch)
    })
  },

  renameChain(id, next) {
    if (!isValidId(next)) return fail(set, `"${next}" is not a valid id`)
    const { project } = get()
    if (next !== id && (next in project.chains || next in project.slots)) {
      return fail(set, `"${next}" is already taken`)
    }
    return get().apply((draft) => {
      const chain = draft.chains[id]
      if (!chain) throw new Error(`no chain "${id}"`)
      delete draft.chains[id]
      draft.chains[next] = chain
      renameCellRefs(draft, id, next)
    })
  },

  removeChain(id) {
    return get().apply((draft) => {
      delete draft.chains[id]
      dropCellRefs(draft, id)
    })
  },

  addChainStep(id, step, index) {
    return get().apply((draft) => {
      const chain = draft.chains[id]
      if (!chain) throw new Error(`no chain "${id}"`)
      chain.steps.splice(index ?? chain.steps.length, 0, step)
    })
  },

  updateChainStep(id, index, patch) {
    return get().apply((draft) => {
      const step = draft.chains[id]?.steps[index]
      if (!step) throw new Error(`no step ${index} in chain "${id}"`)
      Object.assign(step, patch)
    })
  },

  removeChainStep(id, index) {
    return get().apply((draft) => {
      draft.chains[id]?.steps.splice(index, 1)
    })
  },

  moveChainStep(id, from, to) {
    return get().apply((draft) => {
      const steps = draft.chains[id]?.steps
      if (!steps) throw new Error(`no chain "${id}"`)
      if (to < 0 || to >= steps.length || from < 0 || from >= steps.length) return
      const [moved] = steps.splice(from, 1)
      steps.splice(to, 0, moved)
    })
  },

  addScene(name) {
    if (!isValidId(name)) return fail(set, `"${name}" is not a valid scene name`)
    return get().apply((draft) => {
      draft.grid.scenes.push({ name, cells: {} } satisfies Scene)
    })
  },

  renameScene(index, name) {
    if (!isValidId(name)) return fail(set, `"${name}" is not a valid scene name`)
    return get().apply((draft) => {
      const scene = draft.grid.scenes[index]
      if (!scene) throw new Error(`no scene ${index}`)
      scene.name = name
    })
  },

  removeScene(index) {
    return get().apply((draft) => {
      draft.grid.scenes.splice(index, 1)
    })
  },

  moveScene(from, to) {
    return get().apply((draft) => {
      const scenes = draft.grid.scenes
      // Out of range is a no-op rather than a failure: the callers are ↑/↓
      // buttons at the ends of the list, and refusing is the same as disabling.
      if (to < 0 || to >= scenes.length || from < 0 || from >= scenes.length) return
      const [moved] = scenes.splice(from, 1)
      scenes.splice(to, 0, moved)
    })
  },

  setCell(index, track, ref) {
    return get().apply((draft) => {
      const scene = draft.grid.scenes[index]
      if (!scene) throw new Error(`no scene ${index}`)
      if (ref === null) delete scene.cells[String(track)]
      else scene.cells[String(track)] = ref
    })
  },

  setLastSceneState(cells, scene) {
    // Live state is a by-product of performing, not an edit: it must not be
    // undoable, and it must not mark the project dirty on its own.
    const current = get().project
    const next = produce(current, (draft) => {
      draft.meta.lastSceneState = { cells, ...(scene ? { scene } : {}) }
    })
    if (next === current) return true
    set({ project: next })
    return true
  },
}))

function fail(set: (partial: Partial<ProjectStore>) => void, message: string): false {
  set({ lastError: message })
  return false
}

function renameCellRefs(draft: Project, from: string, to: string) {
  for (const scene of draft.grid.scenes) {
    for (const [track, ref] of Object.entries(scene.cells)) {
      if (ref === from) scene.cells[track] = to
    }
  }
  const live = draft.meta.lastSceneState?.cells
  if (live) {
    for (const [track, ref] of Object.entries(live)) if (ref === from) live[track] = to
  }
}

function dropCellRefs(draft: Project, id: string) {
  for (const scene of draft.grid.scenes) {
    for (const [track, ref] of Object.entries(scene.cells)) {
      if (ref === id) delete scene.cells[track]
    }
  }
  const live = draft.meta.lastSceneState?.cells
  if (live) {
    for (const [track, ref] of Object.entries(live)) if (ref === id) delete live[track]
  }
}
