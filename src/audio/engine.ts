/**
 * The scheduler / runtime layer (PRD §5, §7).
 *
 * It observes the project document and reconciles it into a running Strudel
 * pattern. Nothing in the UI touches this directly and nothing here writes back
 * to the project — the document stays authoritative.
 *
 * The glitch-free property comes from `pieces()` rather than from timing luck:
 * a change never replaces the pattern the scheduler is currently reading.
 * A rebuild appends the new pattern as a piece beginning at the next boundary,
 * so everything before that boundary still resolves to exactly what it did
 * before, including audio the scheduler has already queried and queued.
 */
import { Cyclist, stack } from '@strudel/core'
import { getAudioContext, initAudio, webaudioOutput } from '@strudel/webaudio'
import type { Project, Quantize, TrackSettings } from '../model/types'
import { PatternError, compile, compileSlot, initPatternScope } from './compile'
import { type Piece, type StrudelPattern, pieces, silence, timelinePattern } from './patterns'
import { type LiveOverride, resolveTracks } from './timeline'
import { cpsFor, nextBoundary } from './timing'

/**
 * What the scratch pad is doing to the mix.
 *
 * `stack` is the stock Strudel REPL: the scratch pattern sounds over whatever
 * the tracks are playing. `solo` auditions an idea against silence without
 * disturbing the document, and `off` keeps the pattern compiled and ready but
 * silent. All three are performance controls, so a change between them lands
 * on a boundary like any other (PRD §7.3) rather than the instant it is asked
 * for.
 */
export type ScratchMode = 'off' | 'stack' | 'solo'

/**
 * The patterns that should be sounding, given what the tracks resolved to and
 * what the scratch pad is set to do.
 *
 * A mode only means anything while there is a scratch pattern to apply it to —
 * soloing nothing would silence the set, which is never what was asked for.
 */
export function audible<T>(tracks: T[], scratch: T | null, mode: ScratchMode): T[] {
  if (!scratch || mode === 'off') return tracks
  return mode === 'solo' ? [scratch] : [...tracks, scratch]
}

/**
 * Whether a track should be heard.
 *
 * Solo is exclusive rather than additive-to-mute: the moment anything is
 * soloed, everything that is not drops out. Mute still wins over solo on the
 * same track, so a soloed track that is also muted stays silent — which is
 * what every mixer does, and what stops a stray solo from resurrecting a track
 * the performer deliberately killed.
 */
export function trackAudible(settings: TrackSettings | undefined, anySoloed: boolean): boolean {
  if (settings?.muted) return false
  return anySoloed ? Boolean(settings?.soloed) : true
}

/** Whether any track in the project is soloed. */
export function anySoloed(tracks: Record<string, TrackSettings> | undefined): boolean {
  return Object.values(tracks ?? {}).some((settings) => settings.soloed)
}

export interface EngineStatus {
  started: boolean
  /** Absolute cycle position of the transport. */
  cycle: number
  bar: number
  /** Compile failures, keyed by the slot or instrument they came from. */
  errors: Record<string, string>
  /** Cycle at which a queued change lands, or null when nothing is queued. */
  pendingAt: number | null
  audioReady: boolean
}

const IDLE: EngineStatus = {
  started: false,
  cycle: 0,
  bar: 0,
  errors: {},
  pendingAt: null,
  audioReady: false,
}

export class Engine {
  private scheduler: any
  private project: Project | undefined
  private overrides: Record<number, LiveOverride> = {}
  private timeline: Piece[] = []
  private generation = 0
  private status: EngineStatus = { ...IDLE }
  private frame: number | undefined
  private masterVolume = 0.8
  private audioReady = false
  /** The scratch pad's pattern, mixed in per `scratchMode`. Not part of the project. */
  private scratch: StrudelPattern | null = null
  private scratchMode: ScratchMode = 'stack'

  constructor(private readonly onStatus: (status: EngineStatus) => void) {
    this.scheduler = new Cyclist({
      // Master volume is applied here rather than being folded into the
      // pattern, so dragging the fader costs nothing: no re-resolve, no
      // recompile, and no change queued against a bar boundary.
      onTrigger: (hap: any, deadline: number, duration: number, cps: number, t: number) =>
        webaudioOutput(this.scaled(hap), deadline, duration, cps, t),
      getTime: () => getAudioContext().currentTime,
      onToggle: (started: boolean) => this.publish({ started }),
      onError: (error: unknown) => console.error('[chainsaw scheduler]', error),
    })
  }

  private scaled(hap: any) {
    if (this.masterVolume === 1) return hap
    return hap.withValue((value: Record<string, unknown>) => ({
      ...value,
      postgain: (typeof value?.postgain === 'number' ? value.postgain : 1) * this.masterVolume,
    }))
  }

  /** Current transport position in cycles. */
  now(): number {
    return this.scheduler.started ? this.scheduler.now() : 0
  }

  private publish(patch: Partial<EngineStatus>) {
    this.status = { ...this.status, ...patch }
    this.onStatus(this.status)
  }

  /**
   * Start the audio context. Must be called from a user gesture; browsers will
   * not let a page make sound otherwise.
   */
  async unlockAudio(): Promise<void> {
    if (this.audioReady) return
    await initAudio()
    const { registerBuiltInSounds } = await import('./sounds')
    registerBuiltInSounds()
    await initPatternScope()
    this.audioReady = true
    this.publish({ audioReady: true })
  }

  async setProject(project: Project): Promise<void> {
    const tempoChanged =
      this.project?.meta.bpm !== project.meta.bpm || this.project?.meta.cyclesPerBar !== project.meta.cyclesPerBar
    this.project = project
    if (tempoChanged) this.scheduler.setCps(cpsFor(project.meta))
    await this.rebuild()
  }

  async setOverrides(overrides: Record<number, LiveOverride>): Promise<void> {
    this.overrides = overrides
    await this.rebuild()
  }

  /**
   * Evaluate the scratch pad. It plays alongside the tracks and is not part of
   * the project until the performer commits it to a slot — this is the stock
   * Strudel REPL, kept intact (PRD §8.2). Throws `PatternError` on bad code,
   * leaving whatever was already playing alone.
   */
  async setScratch(code: string): Promise<void> {
    this.scratch = code.trim() ? await compile(code, 'scratch') : null
    await this.rebuild()
  }

  /**
   * Mix the scratch pattern in, out, or over the top of everything else.
   *
   * The pattern itself is kept either way, so muting and unmuting costs no
   * recompile and loses no state — it is a fader, not an undo.
   */
  async setScratchMode(mode: ScratchMode): Promise<void> {
    if (mode === this.scratchMode) return
    this.scratchMode = mode
    await this.rebuild()
  }

  clearScratch(): void {
    this.scratch = null
    void this.rebuild()
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume))
  }

  /** The boundary a trigger issued right now would land on. */
  boundaryFor(quantize: Quantize): number {
    if (!this.project) return 0
    if (!this.scheduler.started) return 0
    return nextBoundary(this.now(), quantize, this.project.meta.cyclesPerBar)
  }

  async play(): Promise<void> {
    await this.unlockAudio()
    if (!this.project) return
    if (this.timeline.length === 0) await this.rebuild()
    this.scheduler.setCps(cpsFor(this.project.meta))
    await this.scheduler.start()
    this.watch()
  }

  pause(): void {
    this.scheduler.pause()
    this.unwatch()
  }

  stop(): void {
    this.scheduler.stop()
    this.unwatch()
    // A fresh start begins at cycle 0, so the queued history is meaningless.
    this.timeline = this.timeline.length ? [{ from: 0, pattern: this.timeline[this.timeline.length - 1].pattern }] : []
    void this.scheduler.setPattern(pieces(this.timeline), false)
    this.publish({ cycle: 0, bar: 0, pendingAt: null })
  }

  dispose(): void {
    this.unwatch()
    this.scheduler.stop()
  }

  /**
   * Re-resolve the project into a pattern and queue it for the next boundary.
   *
   * Concurrent rebuilds are safe: compilation is async, so a rebuild that
   * finishes after a newer one started throws its result away rather than
   * overwriting it.
   */
  private async rebuild(): Promise<void> {
    if (!this.project) return
    const project = this.project
    const generation = (this.generation += 1)

    const errors: Record<string, string> = {}
    const tracks = resolveTracks(project, this.overrides)
    const trackPatterns: StrudelPattern[] = []
    const soloing = anySoloed(project.tracks)

    for (const [number, track] of tracks) {
      const { timeline, offset } = track
      if (timeline.loop <= 0 || timeline.segments.length === 0) continue
      // A muted track is still compiled below, so its slots keep reporting
      // their errors and unmuting costs no recompile — it just is not stacked.
      const heard = trackAudible(project.tracks?.[String(number)], soloing)
      const entries = []
      for (const segment of timeline.segments) {
        try {
          entries.push({
            begin: segment.begin,
            end: segment.end,
            pattern: await compileSlot(project, segment),
          })
        } catch (error) {
          if (error instanceof PatternError) errors[error.where] = error.message
          else errors[`slot ${segment.slot}`] = String(error)
        }
      }
      if (entries.length && heard) trackPatterns.push(timelinePattern(entries, timeline.loop, offset))
    }
    // Every track is still compiled under `solo`, so its errors are still
    // reported and coming out of solo needs no recompile.
    const patterns = audible(trackPatterns, this.scratch, this.scratchMode)

    if (generation !== this.generation) return // superseded while compiling

    const next: StrudelPattern = patterns.length ? stack(...patterns) : silence

    const quantize = project.meta.quantize ?? 'bar'
    if (!this.scheduler.started) {
      // Nothing is playing, so there is nothing to protect: start from zero.
      this.timeline = [{ from: 0, pattern: next }]
      this.publish({ errors, pendingAt: null })
    } else {
      const at = nextBoundary(this.now(), quantize, project.meta.cyclesPerBar)
      this.timeline = [...prune(this.timeline, this.now()).filter((piece) => piece.from < at), { from: at, pattern: next }]
      this.publish({ errors, pendingAt: at })
    }

    await this.scheduler.setPattern(pieces(this.timeline), false)
  }

  private watch() {
    if (this.frame !== undefined) return
    const tick = () => {
      const cycle = this.now()
      const bar = this.project ? cycle / this.project.meta.cyclesPerBar : 0
      const pendingAt = this.status.pendingAt !== null && cycle >= this.status.pendingAt ? null : this.status.pendingAt
      if (cycle !== this.status.cycle || pendingAt !== this.status.pendingAt) {
        this.publish({ cycle, bar, pendingAt })
      }
      this.frame = requestAnimationFrame(tick)
    }
    this.frame = requestAnimationFrame(tick)
  }

  private unwatch() {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame)
    this.frame = undefined
  }
}

/**
 * Drop pieces that can no longer be reached: everything before the last piece
 * that has already started. Without this the list would grow by one entry for
 * every keystroke-committed edit of a performance.
 */
export function prune(list: Piece[], now: number): Piece[] {
  const sorted = [...list].sort((a, b) => a.from - b.from)
  let lastPast = -1
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i].from <= now) lastPast = i
  }
  return lastPast <= 0 ? sorted : sorted.slice(lastPast)
}
