/**
 * Ephemeral performance state, and the one place that owns the Engine.
 *
 * Nothing in here is persisted with the project except `lastSceneState`, which
 * is written back so a project saved mid-set restores what was playing.
 */
import { create } from 'zustand'
import { Engine, type EngineStatus } from '../audio/engine'
import type { LiveOverride } from '../audio/timeline'
import type { Project, Quantize } from '../model/types'
import { useProject } from './project'

export type Panel = 'grid' | 'arrangement'

export interface RuntimeStore {
  status: EngineStatus
  /** Live scene/cell overrides, by track (PRD §7.5). Not part of the arrangement. */
  overrides: Record<number, LiveOverride>
  /** Name of the scene triggered whole, when the overrides still match it. */
  activeScene: string | null
  panel: Panel
  /** Slot currently open in the editor, or null for the scratch pad. */
  editing: string | null
  /** Chain currently open in the chain editor. */
  editingChain: string | null
  scratch: string
  masterVolume: number

  setPanel: (panel: Panel) => void
  setEditing: (slot: string | null) => void
  setEditingChain: (chain: string | null) => void
  setScratch: (code: string) => void
  setMasterVolume: (volume: number) => void

  play: () => Promise<void>
  pause: () => void
  stop: () => void

  triggerScene: (index: number) => void
  triggerCell: (track: number, ref: string) => void
  clearTrack: (track: number) => void
  returnToArrangement: () => void
  /** Evaluate scratch-pad code straight away, the stock REPL behaviour. */
  evaluateScratch: (code: string) => Promise<void>
  scratchError: string | null
}

let engine: Engine | undefined

/** The Engine is created lazily so importing this module has no audio side effects. */
export function getEngine(): Engine {
  engine ??= new Engine((status) => useRuntime.setState({ status }))
  return engine
}

const SCRATCH_TRACK = 0

export const useRuntime = create<RuntimeStore>()((set, get) => ({
  status: {
    started: false,
    cycle: 0,
    bar: 0,
    errors: {},
    pendingAt: null,
    audioReady: false,
  },
  overrides: {},
  activeScene: null,
  panel: 'grid',
  editing: null,
  editingChain: null,
  scratch: 's("bd*4, hh*8").gain(0.8)',
  masterVolume: 0.8,
  scratchError: null,

  setPanel: (panel) => set({ panel }),
  setEditing: (editing) => set({ editing }),
  setEditingChain: (editingChain) => set({ editingChain }),
  setScratch: (scratch) => set({ scratch }),

  setMasterVolume(volume) {
    set({ masterVolume: volume })
    getEngine().setMasterVolume(volume)
  },

  async play() {
    await getEngine().play()
  },

  pause() {
    getEngine().pause()
  },

  stop() {
    getEngine().stop()
  },

  triggerScene(index) {
    const project = useProject.getState().project
    const scene = project.grid.scenes[index]
    if (!scene) return
    const at = getEngine().boundaryFor(quantizeOf(project))
    const overrides: Record<number, LiveOverride> = { ...get().overrides }
    for (const [track, ref] of Object.entries(scene.cells)) {
      overrides[Number(track)] = { ref, startCycle: at }
    }
    commit(set, overrides, scene.name)
  },

  triggerCell(track, ref) {
    const project = useProject.getState().project
    const at = getEngine().boundaryFor(quantizeOf(project))
    commit(set, { ...get().overrides, [track]: { ref, startCycle: at } }, null)
  },

  clearTrack(track) {
    const overrides = { ...get().overrides }
    delete overrides[track]
    commit(set, overrides, null)
  },

  returnToArrangement() {
    commit(set, {}, null)
  },

  async evaluateScratch(code) {
    set({ scratch: code })
    const engineRef = getEngine()
    await engineRef.unlockAudio()
    try {
      await engineRef.setScratch(code)
      set({ scratchError: null })
      // Stock Strudel starts playing on evaluate; keep that reflex.
      if (!get().status.started) await engineRef.play()
    } catch (error) {
      set({ scratchError: error instanceof Error ? error.message : String(error) })
    }
  },
}))

function quantizeOf(project: Project): Quantize {
  return project.meta.quantize ?? 'bar'
}

function commit(
  set: (partial: Partial<RuntimeStore>) => void,
  overrides: Record<number, LiveOverride>,
  activeScene: string | null,
) {
  set({ overrides, activeScene })
  void getEngine().setOverrides(overrides)
  const cells: Record<string, string> = {}
  for (const [track, override] of Object.entries(overrides)) cells[track] = override.ref
  useProject.getState().setLastSceneState(cells, activeScene ?? undefined)
}

export { SCRATCH_TRACK }
