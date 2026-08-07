import { beforeAll, describe, expect, it } from 'vitest'
import { compile, initPatternScope } from './compile'
import { pieces, timelinePattern } from './patterns'

/** Onsets in `[from, to)` as `cycle:value` strings, sorted by time. */
function onsets(pattern: any, from: number, to: number): string[] {
  return pattern
    .queryArc(from, to)
    .filter((hap: any) => hap.hasOnset())
    .map((hap: any) => ({ at: Number(hap.whole.begin), value: hap.value }))
    .sort((a: any, b: any) => a.at - b.at)
    .map(({ at, value }: any) => `${at}:${value.note ?? value.s ?? JSON.stringify(value)}`)
}

describe('timelinePattern', () => {
  let a: any
  let b: any
  let four: any
  let alternating: any

  beforeAll(async () => {
    await initPatternScope()
    a = await compile('note("a")')
    b = await compile('note("b")')
    four = await compile('note("w x y z")')
    alternating = await compile('note("<p q r>")')
  })

  it('plays each entry over its own stretch and loops', () => {
    const pattern = timelinePattern(
      [
        { begin: 0, end: 1, pattern: a },
        { begin: 1, end: 2, pattern: b },
      ],
      2,
    )
    expect(onsets(pattern, 0, 4)).toEqual(['0:a', '1:b', '2:a', '3:b'])
  })

  it('windows an entry shorter than a cycle to its opening steps', () => {
    // Half a cycle of "w x y z" is w and x — the LSDJ short-phrase behaviour.
    const pattern = timelinePattern([{ begin: 0, end: 0.5, pattern: four }], 1)
    expect(onsets(pattern, 0, 1)).toEqual(['0:w', '0.25:x'])
  })

  it('starts an entry on its own downbeat when it begins mid-cycle', () => {
    // The second half of the loop still hears w and x, not y and z.
    const pattern = timelinePattern([{ begin: 0.5, end: 1, pattern: four }], 1)
    expect(onsets(pattern, 0, 1)).toEqual(['0.5:w', '0.75:x'])
  })

  it('keeps an entry longer than a cycle running through its own cycles', () => {
    const pattern = timelinePattern([{ begin: 0, end: 3, pattern: alternating }], 3)
    expect(onsets(pattern, 0, 3)).toEqual(['0:p', '1:q', '2:r'])
  })

  it('queries at absolute time, so alternation advances with the song', () => {
    // This is the property `slowcat` cannot give: entry 0 is queried at cycle 0
    // and again at cycle 2, so "<p q r>" moves on instead of repeating.
    const pattern = timelinePattern(
      [
        { begin: 0, end: 1, pattern: alternating },
        { begin: 1, end: 2, pattern: a },
      ],
      2,
    )
    expect(onsets(pattern, 0, 6)).toEqual(['0:p', '1:a', '2:r', '3:a', '4:q', '5:a'])
  })

  it('anchors the loop to its offset, so a live trigger starts at step one', () => {
    const pattern = timelinePattern(
      [
        { begin: 0, end: 1, pattern: a },
        { begin: 1, end: 2, pattern: b },
      ],
      2,
      9,
    )
    expect(onsets(pattern, 9, 13)).toEqual(['9:a', '10:b', '11:a', '12:b'])
  })

  it('is silent with no entries or no length', () => {
    expect(onsets(timelinePattern([], 4), 0, 4)).toEqual([])
    expect(onsets(timelinePattern([{ begin: 0, end: 1, pattern: a }], 0), 0, 4)).toEqual([])
  })
})

describe('pieces', () => {
  let a: any
  let b: any

  beforeAll(async () => {
    await initPatternScope()
    a = await compile('note("a*2")')
    b = await compile('note("b*2")')
  })

  it('switches on the boundary and not before it', () => {
    const pattern = pieces([
      { from: 0, pattern: a },
      { from: 2, pattern: b },
    ])
    expect(onsets(pattern, 0, 4)).toEqual(['0:a', '0.5:a', '1:a', '1.5:a', '2:b', '2.5:b', '3:b', '3.5:b'])
  })

  it('leaves everything before the boundary byte-identical to the old pattern', () => {
    // This is what makes an edit glitch-free: audio the scheduler has already
    // queried still resolves the same way after the swap.
    const before = onsets(a, 0, 2)
    const after = onsets(
      pieces([
        { from: 0, pattern: a },
        { from: 2, pattern: b },
      ]),
      0,
      2,
    )
    expect(after).toEqual(before)
  })

  it('accepts a fractional boundary, for immediate quantization', () => {
    const pattern = pieces([
      { from: 0, pattern: a },
      { from: 0.75, pattern: b },
    ])
    expect(onsets(pattern, 0, 1)).toEqual(['0:a', '0.5:a'])
    expect(onsets(pattern, 1, 2)).toEqual(['1:b', '1.5:b'])
  })

  it('sorts out-of-order pieces and collapses a single one', () => {
    const pattern = pieces([
      { from: 2, pattern: b },
      { from: 0, pattern: a },
    ])
    expect(onsets(pattern, 0, 3).at(-1)).toBe('2.5:b')
    expect(onsets(pieces([{ from: 0, pattern: a }]), 0, 1)).toEqual(['0:a', '0.5:a'])
  })

  it('is silent with nothing scheduled', () => {
    expect(onsets(pieces([]), 0, 4)).toEqual([])
  })
})
