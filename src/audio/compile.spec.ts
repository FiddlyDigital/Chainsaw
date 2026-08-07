import { beforeAll, describe, expect, it } from 'vitest'
import { emptyProject, makeSlot } from '../model/defaults'
import type { Project } from '../model/types'
import { PatternError, clearPatternCache, compile, compileSlot, initPatternScope } from './compile'

function values(pattern: any, from = 0, to = 1) {
  return pattern.queryArc(from, to).map((hap: any) => hap.value)
}

function fixture(): Project {
  const project = emptyProject()
  project.instruments = { bass: { base: 'sound("sawtooth").lpf(500)' } }
  project.slots = {
    plain: makeSlot({ code: 's("bd sd")' }),
    played: makeSlot({ instrument: 'bass', code: 'note("c3 e3")' }),
    loud: makeSlot({ instrument: 'bass', code: 'note("c3").sound("square").gain(0.5)' }),
    hushed: makeSlot({ code: 's("bd*4")', muted: true }),
  }
  return project
}

const ref = (slot: string, transpose = 0, gainOffset = 0) => ({ slot, transpose, gainOffset })

describe('compile', () => {
  beforeAll(() => initPatternScope())

  it('evaluates a Strudel expression', async () => {
    expect(values(await compile('s("bd sd")'))).toEqual([{ s: 'bd' }, { s: 'sd' }])
  })

  it('understands mini-notation, so patterns read as they do in Strudel', async () => {
    expect(values(await compile('s("bd*2 [hh hh]")')).length).toBe(4)
  })

  it('reuses the compiled pattern for identical code', async () => {
    clearPatternCache()
    const first = await compile('s("bd*4")')
    expect(await compile('s("bd*4")')).toBe(first)
    expect(await compile('  s("bd*4")  ')).toBe(first) // whitespace is not meaning
  })

  it('reports bad code as a PatternError naming where it came from', async () => {
    await expect(compile('s("bd"', 'slot A1')).rejects.toBeInstanceOf(PatternError)
    await expect(compile('s("bd"', 'slot A1')).rejects.toMatchObject({ where: 'slot A1' })
  })

  it('rejects an expression that is not a pattern at all', async () => {
    await expect(compile('1 + 1', 'slot A1')).rejects.toBeInstanceOf(PatternError)
  })

  it('is silent for empty code', async () => {
    expect(values(await compile(''))).toEqual([])
  })
})

describe('compileSlot', () => {
  beforeAll(() => initPatternScope())

  it('plays a slot with no instrument exactly as written', async () => {
    const pattern = await compileSlot(fixture(), ref('plain'))
    expect(values(pattern)).toEqual([{ s: 'bd' }, { s: 'sd' }])
  })

  it('takes structure from the slot and fills in the instrument', async () => {
    const pattern = await compileSlot(fixture(), ref('played'))
    expect(values(pattern)).toEqual([
      { s: 'sawtooth', cutoff: 500, note: 'c3' },
      { s: 'sawtooth', cutoff: 500, note: 'e3' },
    ])
  })

  it('lets the slot override one of the instrument"s controls', async () => {
    const pattern = await compileSlot(fixture(), ref('loud'))
    expect(values(pattern)[0]).toMatchObject({ s: 'square', cutoff: 500, gain: 0.5 })
  })

  it('does not mutate the slot when a chain step transposes it', async () => {
    const project = fixture()
    const pattern = await compileSlot(project, ref('played', 7))
    // c3 is midi 48; +7 semitones is 55.
    expect(values(pattern).map((value: any) => value.note)).toEqual([55, 59])
    expect(project.slots.played.code).toBe('note("c3 e3")')
  })

  it('leaves a drum pattern alone when transposed, having no note to move', async () => {
    const pattern = await compileSlot(fixture(), ref('plain', 12))
    expect(values(pattern)).toEqual([{ s: 'bd' }, { s: 'sd' }])
  })

  it('offsets gain from the slot"s own value, or from unity', async () => {
    expect(values(await compileSlot(fixture(), ref('plain', 0, -0.3)))[0].gain).toBeCloseTo(0.7)
    expect(values(await compileSlot(fixture(), ref('loud', 0, 0.25)))[0].gain).toBeCloseTo(0.75)
  })

  it('never drives gain below silence', async () => {
    expect(values(await compileSlot(fixture(), ref('plain', 0, -1)))[0].gain).toBe(0)
  })

  it('is silent for a muted slot', async () => {
    expect(values(await compileSlot(fixture(), ref('hushed')))).toEqual([])
  })

  it('is silent for a slot that has been deleted', async () => {
    expect(values(await compileSlot(fixture(), ref('gone')))).toEqual([])
  })

  it('plays the slot bare when its instrument has been deleted', async () => {
    const project = fixture()
    delete project.instruments.bass
    expect(values(await compileSlot(project, ref('played')))).toEqual([{ note: 'c3' }, { note: 'e3' }])
  })
})
