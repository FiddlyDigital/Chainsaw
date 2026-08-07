/**
 * Ephemeral performance state, and the one place that owns the Engine.
 *
 * Nothing in here is persisted with the project except `lastSceneState`, which
 * is written back so a project saved mid-set restores what was playing.
 */
import { create } from 'zustand'
import { Engine, type EngineStatus, type ScratchMode } from '../audio/engine'
import type { LiveOverride } from '../audio/timeline'
import type { Project, Quantize } from '../model/types'
import { useProject } from './project'

export type Panel = 'grid' | 'arrangement'

/**
 * Which of the three columns is on screen when there is only room for one.
 * Ignored by the layout above the narrow breakpoint, where all three are
 * visible at once, but still tracked so a phone rotated to landscape and back
 * returns to where the performer was.
 */
export type Pane = 'project' | 'stage' | 'editor'

export interface RuntimeStore {
  status: EngineStatus
  /** Live scene/cell overrides, by track (PRD §7.5). Not part of the arrangement. */
  overrides: Record<number, LiveOverride>
  /** Name of the scene triggered whole, when the overrides still match it. */
  activeScene: string | null
  panel: Panel
  /** Which single column is shown on a narrow screen. */
  pane: Pane
  /** Slot currently open in the editor, or null for the scratch pad. */
  editing: string | null
  /** Chain currently open in the chain editor. */
  editingChain: string | null
  scratch: string
  /** How the scratch pattern is mixed against the tracks. */
  scratchMode: ScratchMode
  /** Whether a scratch pattern is compiled and waiting, whatever the mode. */
  scratchLive: boolean
  masterVolume: number

  setPanel: (panel: Panel) => void
  setPane: (pane: Pane) => void
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
  /** Mix the scratch layer in, out, or over everything else. */
  setScratchMode: (mode: ScratchMode) => void
  /** Drop the scratch pattern entirely. The code in the editor is untouched. */
  clearScratch: () => void
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
  pane: 'stage',
  editing: null,
  editingChain: null,
  scratch: 's("bd*4, hh*8").gain(0.8)',
  scratchMode: 'stack',
  scratchLive: false,
  masterVolume: 0.8,
  scratchError: null,

  setPanel: (panel) => set({ panel, pane: 'stage' }),
  setPane: (pane) => set({ pane }),
  // Opening something for editing brings its editor on screen. On a wide
  // layout the pane is inert and this changes nothing; on a narrow one it is
  // the difference between tapping a slot and appearing to do nothing.
  setEditing: (editing) => set(editing === null ? { editing } : { editing, pane: 'editor' }),
  setEditingChain: (editingChain) => set(editingChain === null ? { editingChain } : { editingChain, pane: 'stage' }),
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
      // Evaluating is a request to hear it. Muting is undone, but a solo the
      // performer set up deliberately is left alone.
      const mode = get().scratchMode === 'off' ? 'stack' : get().scratchMode
      await engineRef.setScratchMode(mode)
      set({ scratchError: null, scratchLive: code.trim().length > 0, scratchMode: mode })
      // Stock Strudel starts playing on evaluate; keep that reflex.
      if (!get().status.started) await engineRef.play()
    } catch (error) {
      set({ scratchError: error instanceof Error ? error.message : String(error) })
    }
  },

  setScratchMode(scratchMode) {
    set({ scratchMode })
    void getEngine().setScratchMode(scratchMode)
  },

  clearScratch() {
    set({ scratchLive: false })
    getEngine().clearScratch()
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
