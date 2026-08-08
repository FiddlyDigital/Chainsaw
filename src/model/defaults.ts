import type { Project, Slot, StepResolution } from './types'

export const PROJECT_VERSION = '0.1'

export const DEFAULT_TRACK_COUNT = 8
export const DEFAULT_SLOT_LENGTH = 16
export const DEFAULT_STEPS: StepResolution = '16n'

/** Track colours, reused for new slots so the grid stays readable. */
export const PALETTE = ['#f06292', '#ba68c8', '#7986cb', '#4fc3f7', '#4db6ac', '#aed581', '#ffd54f', '#ff8a65'] as const

export function paletteColor(index: number): string {
  return PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length]
}

const VALID_ID = /^[A-Za-z0-9_-]+$/

export function isValidId(id: string): boolean {
  return VALID_ID.test(id) && id.length <= 64
}

/** Next free id of the form `A1`, `A2`, … avoiding every taken name. */
export function nextId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  for (let i = 1; ; i += 1) {
    const candidate = `${prefix}${i}`
    if (!used.has(candidate)) return candidate
  }
}

export function makeSlot(overrides: Partial<Slot> = {}): Slot {
  return {
    code: 's("bd*4")',
    length: DEFAULT_SLOT_LENGTH,
    steps: DEFAULT_STEPS,
    color: PALETTE[0],
    muted: false,
    ...overrides,
  }
}

export function emptyProject(name = 'untitled'): Project {
  const now = new Date().toISOString()
  return {
    meta: {
      name,
      bpm: 120,
      cyclesPerBar: 1,
      trackCount: DEFAULT_TRACK_COUNT,
      defaultSlotLength: DEFAULT_SLOT_LENGTH,
      created: now,
      modified: now,
      version: PROJECT_VERSION,
      quantize: 'bar',
    },
    instruments: {},
    slots: {},
    chains: {},
    grid: { scenes: [] },
  }
}

/**
 * The project the app opens on. It is deliberately small but exercises every
 * v1 feature: two instruments, slots of two different lengths, chains with
 * repeats and a transposed step, and four scenes that between them reference
 * every slot and every chain — nothing in here is unreachable from the grid.
 */
export function demoProject(): Project {
  const base = emptyProject('first light')
  return {
    ...base,
    instruments: {
      bass: { base: 'sound("sawtooth").lpf(500).lpq(8).decay(0.2).sustain(0.1)', notes: 'plucky saw bass' },
      keys: { base: 'sound("triangle").room(0.4).gain(0.5)' },
    },
    slots: {
      A1: makeSlot({ code: 's("bd*4")', color: PALETTE[0] }),
      A2: makeSlot({ code: 's("bd ~ bd ~, ~ cp")', color: PALETTE[0] }),
      B1: makeSlot({ code: 's("hh*8").gain(0.4)', color: PALETTE[3] }),
      B2: makeSlot({ code: 's("hh*16").gain("0.5 0.25".fast(8))', color: PALETTE[3] }),
      C1: makeSlot({ instrument: 'bass', code: 'note("c2 ~ eb2 g2")', color: PALETTE[5] }),
      C2: makeSlot({
        instrument: 'bass',
        code: 'note("<c2 ab1> ~ eb2 ~ g2 ~ bb2 ~")',
        length: 32,
        color: PALETTE[5],
      }),
      D1: makeSlot({ instrument: 'keys', code: 'note("<[c4,eb4,g4] [ab3,c4,eb4]>")', color: PALETTE[6] }),
    },
    chains: {
      DRUMS_A: {
        track: 1,
        steps: [
          { slot: 'A1', repeat: 3, transpose: 0, gainOffset: 0 },
          { slot: 'A2', repeat: 1, transpose: 0, gainOffset: 0 },
        ],
      },
      DRUMS_B: {
        track: 1,
        steps: [{ slot: 'A2', repeat: 4, transpose: 0, gainOffset: 0.1 }],
      },
      HATS: {
        track: 2,
        steps: [
          { slot: 'B1', repeat: 3, transpose: 0, gainOffset: 0 },
          { slot: 'B2', repeat: 1, transpose: 0, gainOffset: 0 },
        ],
      },
      BASS: {
        track: 3,
        steps: [
          { slot: 'C1', repeat: 2, transpose: 0, gainOffset: 0 },
          { slot: 'C2', repeat: 1, transpose: 0, gainOffset: 0 },
        ],
      },
      BASS_UP: {
        track: 3,
        steps: [{ slot: 'C1', repeat: 4, transpose: 5, gainOffset: 0 }],
      },
      KEYS: {
        track: 4,
        steps: [{ slot: 'D1', repeat: 4, transpose: 0, gainOffset: 0 }],
      },
    },
    grid: {
      scenes: [
        { name: 'intro', cells: { '1': 'A1', '3': 'C1' } },
        { name: 'verse', cells: { '1': 'DRUMS_A', '2': 'HATS', '3': 'BASS' } },
        { name: 'drop', cells: { '1': 'DRUMS_B', '2': 'B2', '3': 'BASS_UP', '4': 'KEYS' } },
        { name: 'break', cells: { '2': 'B1', '4': 'D1' } },
      ],
    },
  }
}
