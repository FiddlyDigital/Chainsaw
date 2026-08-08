/**
 * Ephemeral performance state, and the one place that owns the Engine.
 *
 * Nothing in here is persisted with the project except `lastSceneState`, which
 * is written back so a project saved mid-set restores what was playing.
 */
import { create } from 'zustand'
import { Engine, type EngineStatus, type ScratchMode } from '../audio/engine'
import type { MidiOutputPort } from '../audio/midi'
import { midiOutput, midiOutputs, midiPermissionGranted, onMidiPortsChanged, requestMidiAccess } from '../audio/midiAccess'
import { readMidiOutputId, writeMidiOutputId } from '../persistence/midiPreference'
import { sceneCycles, type LiveOverride } from '../audio/timeline'
import type { Project, Quantize } from '../model/types'
import { useProject } from './project'

/**
 * Which of the three columns is on screen when there is only room for one.
 * Ignored by the layout above the narrow breakpoint, where all three are
 * visible at once, but still tracked so a phone rotated to landscape and back
 * returns to where the performer was.
 */
export type Pane = 'project' | 'stage' | 'editor'

export interface RuntimeStore {
  status: EngineStatus
  /** What each track is playing, by track (PRD §7.5). The grid is the song. */
  overrides: Record<number, LiveOverride>
  /** Name of the scene triggered whole, when the overrides still match it. */
  activeScene: string | null
  /** Index of that scene, which is what auto-advance steps along. */
  activeSceneIndex: number | null
  /**
   * The scene most recently triggered, remembered after it stops.
   *
   * Distinct from `activeSceneIndex`, which is only ever the scene playing
   * right now: this is what play starts when nothing is playing, so a stopped
   * set resumes where it left off rather than jumping back to the top.
   */
  lastSceneIndex: number | null
  /**
   * Absolute cycle at which the active scene has played through, or null when
   * nothing is due to follow it — no scene, an empty one, or the end of the
   * list. Auto-advance watches this and nothing else.
   */
  sceneEndsAt: number | null
  /** Fire the next scene when this one has played through. */
  autoAdvance: boolean
  /**
   * Whether the grid's clips are playing.
   *
   * Distinct from `status.started`, which is only whether the clock is
   * running. Evaluating a scratch pattern starts the clock without starting
   * the song, so the two are not the same question.
   */
  tracksPlaying: boolean
  /** Which single column is shown on a narrow screen. */
  pane: Pane
  /** Slot currently open in the editor, or null for the scratch pad. */
  editing: string | null
  /**
   * Whether the editor is showing the project's prebake instead.
   *
   * A second flag rather than a tagged union on `editing`, which is a slot id
   * in a dozen call sites. The two are kept mutually exclusive by their
   * setters, so only one thing is ever open.
   */
  editingPrebake: boolean
  /** Chain currently open in the chain editor. */
  editingChain: string | null
  scratch: string
  /** How the scratch pattern is mixed against the tracks. */
  scratchMode: ScratchMode
  /** Whether a scratch pattern is compiled and waiting, whatever the mode. */
  scratchLive: boolean
  masterVolume: number

  /** MIDI outputs we can send clock to. Empty until access has been granted. */
  midiOutputs: MidiOutputPort[]
  /** The output receiving clock, or null for none. */
  midiOutputId: string | null

  setPane: (pane: Pane) => void
  setEditing: (slot: string | null) => void
  setEditingPrebake: (open: boolean) => void
  setEditingChain: (chain: string | null) => void
  setScratch: (code: string) => void
  setMasterVolume: (volume: number) => void

  play: () => Promise<void>
  pause: () => void
  stop: () => void

  triggerScene: (index: number) => void
  /** The scene play would start from here. */
  resumeIndex: () => number
  /** Take up a freshly loaded project's live state, dropping the old one's. */
  adoptProject: () => void
  setAutoAdvance: (on: boolean) => void
  /** Step to the next scene. A no-op at the end of the list, which holds. */
  advanceScene: () => void
  triggerCell: (track: number, ref: string) => void
  clearTrack: (track: number) => void
  /** Stop every clip, leaving the grid silent. */
  stopAll: () => void
  /** Evaluate scratch-pad code straight away, the stock REPL behaviour. */
  evaluateScratch: (code: string) => Promise<void>
  /** Mix the scratch layer in, out, or over everything else. */
  setScratchMode: (mode: ScratchMode) => void
  /** Drop the scratch pattern entirely. The code in the editor is untouched. */
  clearScratch: () => void
  scratchError: string | null

  /** Prompt for MIDI access and populate the output list. Safe to call twice. */
  enableMidi: () => Promise<boolean>
  /** Reconnect to last session's output, but only without prompting for it. */
  restoreMidi: () => Promise<void>
  /** Point the clock at an output, or null to stop sending. */
  setMidiOutput: (id: string | null) => void
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
  activeSceneIndex: null,
  lastSceneIndex: null,
  sceneEndsAt: null,
  autoAdvance: false,
  tracksPlaying: false,
  pane: 'stage',
  editing: null,
  editingPrebake: false,
  editingChain: null,
  scratch: 's("bd*4, hh*8").gain(0.8)',
  scratchMode: 'stack',
  scratchLive: false,
  masterVolume: 0.8,
  scratchError: null,
  midiOutputs: [],
  midiOutputId: null,

  setPane: (pane) => set({ pane }),
  // Opening something for editing brings its editor on screen. On a wide
  // layout the pane is inert and this changes nothing; on a narrow one it is
  // the difference between tapping a slot and appearing to do nothing.
  setEditing: (editing) => set(editing === null ? { editing } : { editing, editingPrebake: false, pane: 'editor' }),
  setEditingPrebake: (editingPrebake) =>
    set(editingPrebake ? { editingPrebake, editing: null, pane: 'editor' } : { editingPrebake }),
  setEditingChain: (editingChain) => set(editingChain === null ? { editingChain } : { editingChain, pane: 'stage' }),
  setScratch: (scratch) => set({ scratch }),

  setMasterVolume(volume) {
    set({ masterVolume: volume })
    getEngine().setMasterVolume(volume)
  },

  async play() {
    set({ tracksPlaying: true })
    const engineRef = getEngine()
    await engineRef.setTracksPlaying(true)
    // Play is the only transport control that also *chooses* something to
    // play. With the grid as the whole song, starting the clock over silence
    // and waiting to be told what to fire is a dead press; so pick up where the
    // set left off, or start at the top. Something already playing is left
    // exactly as it is — this must not restart a scene on resume from pause.
    if (Object.keys(get().overrides).length === 0) get().triggerScene(get().resumeIndex())
    await engineRef.play()
  },

  /** The scene play should start: the one last triggered, else the first. */
  resumeIndex() {
    const scenes = useProject.getState().project.grid.scenes
    const remembered = get().lastSceneIndex
    // A remembered scene can have been deleted since; fall back rather than
    // silently firing nothing.
    return remembered !== null && remembered < scenes.length ? remembered : 0
  },

  pause() {
    getEngine().pause()
  },

  stop() {
    set({ tracksPlaying: false })
    // Stop means back to the top. The clock resets to cycle 0, so clips still
    // anchored to the cycle they were fired on would come back part-way
    // through; clear them and let play start the scene from its first step.
    commit(set, {}, null)
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
    // A scene with no length has nothing to wait for, so it holds rather than
    // advancing straight past itself.
    const length = sceneCycles(project, scene)
    set({ activeSceneIndex: index, lastSceneIndex: index, sceneEndsAt: length > 0 ? at + length : null })
    commit(set, overrides, scene.name)
  },

  adoptProject() {
    // A project records the scene that was playing when it was saved. Read it
    // back so play resumes that scene rather than the top of a stranger's set —
    // and drop the outgoing project's clips, which mean nothing here.
    const project = useProject.getState().project
    const name = project.meta.lastSceneState?.scene
    const index = name ? project.grid.scenes.findIndex((scene) => scene.name === name) : -1
    set({
      overrides: {},
      activeScene: null,
      activeSceneIndex: null,
      sceneEndsAt: null,
      lastSceneIndex: index >= 0 ? index : null,
    })
    // Not through `commit`: that would write the live state back into the
    // project we have just opened.
    void getEngine().setOverrides({})
  },

  setAutoAdvance(autoAdvance) {
    set({ autoAdvance })
  },

  advanceScene() {
    const index = get().activeSceneIndex
    if (index === null) return
    const scenes = useProject.getState().project.grid.scenes
    if (index + 1 >= scenes.length) {
      // End of the list: hold the last scene and stop looking. Triggering
      // anything by hand starts the follow off again.
      set({ sceneEndsAt: null })
      return
    }
    get().triggerScene(index + 1)
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

  stopAll() {
    commit(set, {}, null)
  },

  async evaluateScratch(code) {
    set({ scratch: code })
    const engineRef = getEngine()
    await engineRef.unlockAudio()
    // Evaluating asks to hear the scratch pad, never to start the song. With
    // the transport stopped the clock still has to start — the pattern needs
    // something to play against — but the tracks stay out of it until the
    // transport is played deliberately.
    const startingClock = !get().status.started
    try {
      if (startingClock) {
        set({ tracksPlaying: false })
        await engineRef.setTracksPlaying(false)
      }
      await engineRef.setScratch(code)
      // Muting is undone, but a solo the performer set up deliberately is left
      // alone.
      const mode = get().scratchMode === 'off' ? 'stack' : get().scratchMode
      await engineRef.setScratchMode(mode)
      set({ scratchError: null, scratchLive: code.trim().length > 0, scratchMode: mode })
      // Stock Strudel starts playing on evaluate; keep that reflex.
      if (startingClock) await engineRef.play()
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

  async enableMidi() {
    if (!(await requestMidiAccess())) return false
    watchMidiPorts(set, get)
    return true
  },

  async restoreMidi() {
    const remembered = readMidiOutputId()
    if (!remembered) return
    // Only if the browser will hand over access without asking. Prompting for
    // a permission on every boot, for someone who may never use MIDI, is worse
    // than making them pick the port again.
    if (!(await midiPermissionGranted())) return
    if (!(await requestMidiAccess())) return
    watchMidiPorts(set, get)
    // The device may simply not be plugged in this time.
    if (get().midiOutputs.some((output) => output.id === remembered)) get().setMidiOutput(remembered)
  },

  setMidiOutput(midiOutputId) {
    set({ midiOutputId })
    writeMidiOutputId(midiOutputId)
    getEngine().midi.setPort(midiOutput(midiOutputId))
  },
}))

/**
 * Publish the output list and keep it current as devices come and go.
 *
 * A device pulled out mid-set takes the clock with it rather than leaving the
 * transport pointed at a port that no longer exists. The choice is left in
 * storage either way, so plugging the same device back in restores it on the
 * next reload.
 */
function watchMidiPorts(set: (partial: Partial<RuntimeStore>) => void, get: () => RuntimeStore): void {
  const refresh = () => {
    const outputs = midiOutputs()
    set({ midiOutputs: outputs })
    const chosen = get().midiOutputId
    if (chosen && !outputs.some((output) => output.id === chosen)) {
      set({ midiOutputId: null })
      getEngine().midi.setPort(null)
    }
  }
  refresh()
  onMidiPortsChanged(refresh)
}

function quantizeOf(project: Project): Quantize {
  return project.meta.quantize ?? 'bar'
}

function commit(
  set: (partial: Partial<RuntimeStore>) => void,
  overrides: Record<number, LiveOverride>,
  activeScene: string | null,
) {
  // Anything that is not a whole scene breaks the follow — a single cell, a
  // track stopped, everything stopped. There is no longer a scene playing, so
  // there is nothing to advance from.
  set(activeScene === null ? { overrides, activeScene, activeSceneIndex: null, sceneEndsAt: null } : { overrides, activeScene })
  void getEngine().setOverrides(overrides)
  const cells: Record<string, string> = {}
  for (const [track, override] of Object.entries(overrides)) cells[track] = override.ref
  useProject.getState().setLastSceneState(cells, activeScene ?? undefined)
}

export { SCRATCH_TRACK }
