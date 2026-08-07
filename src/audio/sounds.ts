/**
 * The built-in kit.
 *
 * Strudel's usual drum sounds are sample packs fetched from the network. An
 * installed PWA has to make noise with the aeroplane mode on, so Chainsaw
 * synthesises its kit instead: every sound below is built from oscillators and
 * a noise buffer at trigger time, and nothing is fetched. Strudel's own
 * waveform and ZZFX synths are registered alongside them.
 *
 * Names follow the Dirt/Strudel convention (`bd`, `sd`, `hh`, …) so patterns
 * written here read the same as patterns written anywhere else.
 */
import { getAudioContext, registerSound, registerSynthSounds, registerZZFXSounds } from '@strudel/webaudio'

interface SoundHandle {
  node: AudioNode
  nodes?: Record<string, AudioNode[]>
  stop: (time: number) => void
}

let noiseBuffer: AudioBuffer | undefined

function noise(ac: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ac.sampleRate) return noiseBuffer
  const length = Math.floor(ac.sampleRate * 2)
  const buffer = ac.createBuffer(1, length, ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1
  noiseBuffer = buffer
  return buffer
}

/** A gain node carrying an exponential-ish decay from `peak` to silence. */
function decayEnvelope(ac: AudioContext, t: number, peak: number, decay: number, attack = 0.001): GainNode {
  const gain = ac.createGain()
  gain.gain.setValueAtTime(0, t)
  gain.gain.linearRampToValueAtTime(peak, t + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
  gain.gain.setValueAtTime(0, t + attack + decay)
  return gain
}

function noiseSource(ac: AudioContext, t: number, duration: number): AudioBufferSourceNode {
  const source = ac.createBufferSource()
  source.buffer = noise(ac)
  source.loop = true
  source.start(t)
  source.stop(t + duration + 0.02)
  return source
}

type Build = (ac: AudioContext, t: number, value: Record<string, number>) => SoundHandle & { tail: number }

/** Kick: a sine dropping from `bend` to its fundamental. */
const kick =
  (fundamental: number, bend: number, decay: number): Build =>
  (ac, t) => {
    const osc = ac.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(bend, t)
    osc.frequency.exponentialRampToValueAtTime(fundamental, t + 0.06)
    const env = decayEnvelope(ac, t, 1, decay)
    osc.connect(env)
    osc.start(t)
    osc.stop(t + decay + 0.05)
    return { node: env, nodes: { source: [osc] }, stop: (end) => osc.stop(end), tail: decay + 0.05 }
  }

/** Toms: like a kick but pitched, with a shorter bend. */
const tom =
  (fundamental: number): Build =>
  (ac, t) => {
    const osc = ac.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(fundamental * 1.6, t)
    osc.frequency.exponentialRampToValueAtTime(fundamental, t + 0.08)
    const env = decayEnvelope(ac, t, 0.9, 0.3)
    osc.connect(env)
    osc.start(t)
    osc.stop(t + 0.4)
    return { node: env, nodes: { source: [osc] }, stop: (end) => osc.stop(end), tail: 0.4 }
  }

/** Snare: filtered noise plus a short body tone. */
const snare: Build = (ac, t) => {
  const out = ac.createGain()
  out.gain.value = 1

  const source = noiseSource(ac, t, 0.2)
  const band = ac.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 1800
  band.Q.value = 0.7
  const noiseEnv = decayEnvelope(ac, t, 0.8, 0.18)
  source.connect(band).connect(noiseEnv).connect(out)

  const body = ac.createOscillator()
  body.type = 'triangle'
  body.frequency.setValueAtTime(190, t)
  const bodyEnv = decayEnvelope(ac, t, 0.5, 0.09)
  body.connect(bodyEnv).connect(out)
  body.start(t)
  body.stop(t + 0.15)

  return {
    node: out,
    nodes: { source: [source, body] },
    stop: (end) => {
      source.stop(end)
      body.stop(end)
    },
    tail: 0.25,
  }
}

/** Hats: high-passed noise; open and closed differ only in decay. */
const hat =
  (decay: number): Build =>
  (ac, t) => {
    const source = noiseSource(ac, t, decay + 0.05)
    const high = ac.createBiquadFilter()
    high.type = 'highpass'
    high.frequency.value = 7000
    const env = decayEnvelope(ac, t, 0.5, decay)
    source.connect(high).connect(env)
    return { node: env, nodes: { source: [source] }, stop: (end) => source.stop(end), tail: decay + 0.05 }
  }

/** Clap: three quick noise bursts, then a short tail. */
const clap: Build = (ac, t) => {
  const out = ac.createGain()
  const band = ac.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 1200
  band.Q.value = 1.2
  band.connect(out)

  const source = noiseSource(ac, t, 0.22)
  const env = ac.createGain()
  env.gain.setValueAtTime(0, t)
  for (const offset of [0, 0.012, 0.024]) {
    env.gain.setValueAtTime(0.9, t + offset)
    env.gain.exponentialRampToValueAtTime(0.05, t + offset + 0.011)
  }
  env.gain.setValueAtTime(0.7, t + 0.036)
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.2)
  source.connect(env).connect(band)

  return { node: out, nodes: { source: [source] }, stop: (end) => source.stop(end), tail: 0.25 }
}

/** Rimshot: a very short square blip. */
const rim: Build = (ac, t) => {
  const osc = ac.createOscillator()
  osc.type = 'square'
  osc.frequency.setValueAtTime(1700, t)
  const env = decayEnvelope(ac, t, 0.6, 0.035)
  osc.connect(env)
  osc.start(t)
  osc.stop(t + 0.08)
  return { node: env, nodes: { source: [osc] }, stop: (end) => osc.stop(end), tail: 0.08 }
}

export const BUILT_IN_KIT: Record<string, Build> = {
  bd: kick(52, 160, 0.35),
  sd: snare,
  sn: snare,
  hh: hat(0.045),
  oh: hat(0.3),
  cp: clap,
  rim: rim,
  cb: (ac, t) => {
    const osc = ac.createOscillator()
    osc.type = 'square'
    osc.frequency.setValueAtTime(800, t)
    const env = decayEnvelope(ac, t, 0.4, 0.2)
    osc.connect(env)
    osc.start(t)
    osc.stop(t + 0.3)
    return { node: env, nodes: { source: [osc] }, stop: (end) => osc.stop(end), tail: 0.3 }
  },
  lt: tom(90),
  mt: tom(140),
  ht: tom(210),
}

let registered = false

/** Register Strudel's synths and the built-in kit. Idempotent. */
export function registerBuiltInSounds(): void {
  if (registered) return
  registered = true

  registerSynthSounds()
  registerZZFXSounds()

  for (const [name, build] of Object.entries(BUILT_IN_KIT)) {
    registerSound(
      name,
      (t: number, value: Record<string, number>, onended: () => void) => {
        const ac = getAudioContext() as AudioContext
        const { node, nodes, stop, tail } = build(ac, t, value)
        // superdough releases the surrounding chain once we say we are done.
        const timer = setTimeout(() => onended(), Math.max(0, (t + tail - ac.currentTime) * 1000) + 50)
        return {
          node,
          nodes,
          stop: (end: number) => {
            clearTimeout(timer)
            try {
              stop(end)
            } catch {
              // A source already stopped throws; nothing to do about it.
            }
            onended()
          },
        }
      },
      { type: 'synth', prebake: true },
    )
  }
}

export const BUILT_IN_SOUND_NAMES = [
  ...Object.keys(BUILT_IN_KIT),
  'sine',
  'sawtooth',
  'square',
  'triangle',
  'z_sine',
  'z_sawtooth',
  'z_square',
  'z_noise',
]
