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
 * The panel currently slid over the grid, or null for none.
 *
 * The grid is the song, so on a narrow screen it is the screen: it stays put
 * and the two side panels come over it as sheets. Ignored by the layout above
 * the narrow breakpoint, where all three are columns side by side, but still
 * tracked so a phone rotated to landscape and back finds what it left open.
 */
export type Sheet = 'project' | 'editor' | null

/**
 * Something the performer needs told, from anywhere in the app.
 *
 * `bad` stays until it is dismissed. An error that clears itself after three
 * seconds is an error nobody read — and the one place rejected edits used to be
 * reported, the project panel, is a pane that is not even on screen on a phone.
 */
export interface Notice {
  message: string
  tone: 'info' | 'bad'
  /** Distinguishes two identical messages, so the second one still shows. */
  id: number
}

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
  /** Which panel is over the grid on a narrow screen. */
  sheet: Sheet
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

  /** The one thing on screen in every pane, whatever went wrong where. */
  notice: Notice | null
  notify: (message: string, tone?: Notice['tone']) => void
  dismissNotice: () => void

  setSheet: (sheet: Sheet) => void
  /** Open this panel, or close it if it is the one already open. */
  toggleSheet: (sheet: Exclude<Sheet, null>) => void
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

let lastNoticeId = 0
const noticeId = () => (lastNoticeId += 1)

/**
 * Say why an engine call that nobody is awaiting failed.
 *
 * Most calls into the Engine are made for their effect and dropped —
 * `setOverrides` from a scene trigger, `setScratchMode` from a fader. Left as
 * bare floating promises, a failure in one is an unhandled rejection: the
 * console gets it, the performer gets a grid that quietly stopped following
 * what they pressed. The Engine already contains its own failures, so this is
 * the belt to that pair of braces, and it is cheap enough to put on every one.
 */
function report(where: string): (error: unknown) => void {
  return (error) => {
    const message = error instanceof Error ? error.message : String(error)
    useRuntime.getState().notify(`${where} failed: ${message}`, 'bad')
  }
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
  sheet: null,
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
  notice: null,

  notify(message, tone = 'info') {
    set({ notice: { message, tone, id: noticeId() } })
  },
  dismissNotice: () => set({ notice: null }),

  setSheet: (sheet) => set({ sheet }),
  toggleSheet: (sheet) => set({ sheet: get().sheet === sheet ? null : sheet }),
  // Opening something for editing brings its editor on screen. On a wide
  // layout the sheet is inert and this changes nothing; on a narrow one it is
  // the difference between tapping a slot and appearing to do nothing.
  setEditing: (editing) => set(editing === null ? { editing } : { editing, editingPrebake: false, sheet: 'editor' }),
  setEditingPrebake: (editingPrebake) =>
    set(editingPrebake ? { editingPrebake, editing: null, sheet: 'editor' } : { editingPrebake }),
  // A chain is edited in its own panel over the grid, so anything already
  // covering the grid is in its way.
  setEditingChain: (editingChain) => set(editingChain === null ? { editingChain } : { editingChain, sheet: null }),
  setScratch: (scratch) => set({ scratch }),

  setMasterVolume(volume) {
    // A NaN here is not a quiet mix, it is a dead one: it reaches an AudioParam
    // and every voice after it is silent until the page is reloaded. Refusing
    // the value keeps the fader where it was, which is recoverable.
    if (!Number.isFinite(volume)) return
    const clamped = Math.max(0, Math.min(1, volume))
    set({ masterVolume: clamped })
    getEngine().setMasterVolume(clamped)
  },

  async play() {
    set({ tracksPlaying: true })
    const engineRef = getEngine()
    try {
      await engineRef.setTracksPlaying(true)
      // Play is the only transport control that also *chooses* something to
      // play. With the grid as the whole song, starting the clock over silence
      // and waiting to be told what to fire is a dead press; so pick up where the
      // set left off, or start at the top. Something already playing is left
      // exactly as it is — this must not restart a scene on resume from pause.
      if (Object.keys(get().overrides).length === 0) get().triggerScene(get().resumeIndex())
      await engineRef.play()
    } catch (error) {
      // The commonest cause is the audio context refusing to start, which
      // leaves the button lit over silence unless the flag goes back.
      set({ tracksPlaying: false })
      report('play')(error)
    }
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
    // Indices arrive from the grid, from auto-advance and from the remembered
    // scene of a project that has since been edited. A fractional or negative
    // one finds nothing and would fire silence.
    if (!Number.isInteger(index)) return
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
    getEngine().setOverrides({}).catch(report('loading the project'))
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
    // A track outside the project's own bounds resolves to nothing and would
    // sit in the overrides for ever, keeping the grid marked live over silence.
    if (!isTrack(track, project)) return
    if (!(ref in project.slots) && !(ref in project.chains)) {
      useRuntime.getState().notify(`no slot or chain called "${ref}"`, 'bad')
      return
    }
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
    // Evaluating asks to hear the scratch pad, never to start the song. With
    // the transport stopped the clock still has to start — the pattern needs
    // something to play against — but the tracks stay out of it until the
    // transport is played deliberately.
    const startingClock = !get().status.started
    try {
      // Inside the try: a browser that refuses to start audio rejects here,
      // and that belongs in the editor's error line like any other reason the
      // evaluation made no sound.
      await engineRef.unlockAudio()
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
    getEngine().setScratchMode(scratchMode).catch(report('the scratch mix'))
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

/** Whether a track number is one this project actually has. */
function isTrack(track: number, project: Project): boolean {
  return Number.isInteger(track) && track >= 1 && track <= project.meta.trackCount
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
  getEngine().setOverrides(overrides).catch(report('the trigger'))
  const cells: Record<string, string> = {}
  for (const [track, override] of Object.entries(overrides)) cells[track] = override.ref
  useProject.getState().setLastSceneState(cells, activeScene ?? undefined)
}

export { SCRATCH_TRACK }
