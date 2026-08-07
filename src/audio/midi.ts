/**
 * MIDI clock and transport out (Chainsaw as master).
 *
 * Clock only: 24 ticks per quarter note plus Start/Stop/Continue and Song
 * Position, so a drum machine or another DAW follows Chainsaw's transport.
 * Nothing here sends notes or controllers.
 *
 * The arithmetic is pure and lives at the top of this file, because "which
 * ticks fall in the next 100ms" is the part that can be wrong in ways you
 * cannot hear until something is drifting on stage. `MidiClock` below is the
 * part that needs a browser: it owns the port and turns tick positions into
 * timestamped sends.
 */
import { BEATS_PER_BAR } from '../model/types'

/** MIDI System Real-Time status bytes. */
export const CLOCK = 0xf8
export const START = 0xfa
export const CONTINUE = 0xfb
export const STOP = 0xfc
export const SONG_POSITION = 0xf2

/** Clock ticks per quarter note. Fixed by the MIDI spec. */
export const PPQN = 24

/** How many clock ticks fit in one Strudel cycle at this bar length. */
export function ticksPerCycle(cyclesPerBar: number): number {
  return (BEATS_PER_BAR * PPQN) / cyclesPerBar
}

/** Clock ticks elapsed at a cycle position. Fractional between ticks. */
export function ticksAt(cycle: number, cyclesPerBar: number): number {
  return cycle * ticksPerCycle(cyclesPerBar)
}

/**
 * Song Position Pointer for a cycle position, in MIDI beats.
 *
 * A "MIDI beat" is a sixteenth note, not a quarter — six clock ticks. The
 * value is 14-bit, so a long set eventually runs past what SPP can express;
 * it wraps rather than sending a malformed message, which is what receivers
 * cope with best.
 */
export function songPositionAt(cycle: number, cyclesPerBar: number): number {
  const sixteenths = Math.floor(ticksAt(cycle, cyclesPerBar) / 6)
  return ((sixteenths % 0x4000) + 0x4000) % 0x4000
}

/** SPP as its two 7-bit data bytes, least significant first. */
export function songPositionBytes(position: number): [number, number] {
  return [position & 0x7f, (position >> 7) & 0x7f]
}

/**
 * The cycle positions of every clock tick in `(from, to]`.
 *
 * Half-open at the start so a tick is never sent twice across consecutive
 * passes, and closed at the end so none is skipped. Returns positions rather
 * than times: converting to a timestamp needs a clock, and that is the caller's
 * problem, not this function's.
 */
export function ticksBetween(from: number, to: number, cyclesPerBar: number): number[] {
  if (!(to > from) || !(cyclesPerBar > 0)) return []
  const per = ticksPerCycle(cyclesPerBar)
  const first = Math.floor(ticksAt(from, cyclesPerBar)) + 1
  const last = Math.floor(ticksAt(to, cyclesPerBar))
  // A pathological tempo or a long stall could ask for an unbounded list; the
  // receiver has no use for a burst that large, and neither has the event loop.
  if (last - first > 10_000) return []
  const out: number[] = []
  for (let tick = first; tick <= last; tick += 1) out.push(tick / per)
  return out
}

/** What the clock needs to know about the transport on each pass. */
export interface TransportPosition {
  /** Absolute cycle position now. */
  cycle: number
  /** Cycles per second, for turning a cycle distance into seconds. */
  cps: number
  cyclesPerBar: number
}

export interface MidiOutputPort {
  id: string
  name: string
}

interface SendablePort {
  send: (data: number[], timestamp?: number) => void
}

/** How far ahead to queue ticks, and how often to do it. */
const LOOKAHEAD_MS = 120
const PASS_MS = 25

/**
 * Drives a MIDI output from the transport.
 *
 * Ticks are queued ahead with timestamps rather than sent one at a time on a
 * timer: the browser's MIDI implementation delivers a timestamped message far
 * more precisely than a JavaScript interval can fire, and a 120ms queue
 * survives the main thread being busy with a rebuild.
 */
export class MidiClock {
  private port: SendablePort | null = null
  private timer: ReturnType<typeof setInterval> | undefined
  /** Cycle position up to which ticks have already been queued. */
  private sentTo = 0
  private running = false

  constructor(private readonly position: () => TransportPosition) {}

  setPort(port: SendablePort | null): void {
    if (this.port === port) return
    if (this.running) this.send([STOP])
    this.port = port
    // A port swap mid-flight leaves the new device with no idea where we are.
    if (this.running) this.resync()
  }

  get enabled(): boolean {
    return this.port !== null
  }

  /**
   * Begin, from wherever the transport is.
   *
   * From the top that is a bare Start; resuming mid-song is a Song Position
   * followed by Continue, which is the difference between a receiver playing
   * bar 1 and playing along with you.
   */
  start(): void {
    if (this.running) return
    this.running = true
    this.resync()
    this.timer ??= setInterval(() => this.pass(), PASS_MS)
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
    this.send([STOP])
  }

  dispose(): void {
    this.stop()
    this.port = null
  }

  private resync(): void {
    const { cycle, cyclesPerBar } = this.position()
    this.sentTo = cycle
    if (cycle <= 0) {
      this.send([START])
      return
    }
    this.send([SONG_POSITION, ...songPositionBytes(songPositionAt(cycle, cyclesPerBar))])
    this.send([CONTINUE])
  }

  private pass(): void {
    if (!this.port || !this.running) return
    const { cycle, cps, cyclesPerBar } = this.position()
    if (!(cps > 0)) return

    const horizon = cycle + (cps * LOOKAHEAD_MS) / 1000

    // In steady state `sentTo` sits between the transport and the horizon: it
    // is deliberately ahead, because that is what queueing ahead means. Outside
    // that band the transport has jumped — a seek, or a stall long enough that
    // the queued timestamps are now in the past — and the queue is meaningless.
    // Start again from where the transport actually is rather than spraying
    // catch-up ticks a receiver would hear as a stumble.
    if (this.sentTo > horizon || this.sentTo < cycle) this.sentTo = cycle

    const now = performance.now()
    for (const at of ticksBetween(this.sentTo, horizon, cyclesPerBar)) {
      this.send([CLOCK], now + ((at - cycle) / cps) * 1000)
    }
    this.sentTo = horizon
  }

  private send(data: number[], timestamp?: number): void {
    try {
      this.port?.send(data, timestamp)
    } catch {
      // A port that vanished mid-set must not take the audio down with it.
    }
  }
}
