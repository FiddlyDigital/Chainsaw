import { describe, expect, it } from 'vitest'
import { PPQN, songPositionAt, songPositionBytes, ticksAt, ticksBetween, ticksPerCycle } from './midi'

/**
 * MIDI clock arithmetic. A receiver has no way to tell you it is drifting —
 * it just gradually stops being in time with you — so the rates and the
 * tick-selection boundaries are pinned here rather than trusted.
 */

describe('tick rate', () => {
  it('puts 96 ticks in a cycle at the default one bar per cycle', () => {
    // Four quarter notes to the bar, 24 ticks to the quarter.
    expect(ticksPerCycle(1)).toBe(4 * PPQN)
  })

  it('scales with the bar length rather than the tempo', () => {
    // Two cycles to the bar means half a bar per cycle: 48 ticks.
    expect(ticksPerCycle(2)).toBe(48)
    expect(ticksPerCycle(0.5)).toBe(192)
  })

  it('counts ticks from the top of the song', () => {
    expect(ticksAt(0, 1)).toBe(0)
    expect(ticksAt(1, 1)).toBe(96)
    expect(ticksAt(0.25, 1)).toBe(24) // one quarter note in
  })
})

describe('song position', () => {
  it('counts sixteenth notes, not quarters', () => {
    // One cycle at one bar per cycle is a whole bar: sixteen sixteenths.
    expect(songPositionAt(1, 1)).toBe(16)
    expect(songPositionAt(0.25, 1)).toBe(4)
  })

  it('starts at zero', () => {
    expect(songPositionAt(0, 1)).toBe(0)
  })

  it('splits into two 7-bit bytes, least significant first', () => {
    expect(songPositionBytes(0)).toEqual([0, 0])
    expect(songPositionBytes(1)).toEqual([1, 0])
    expect(songPositionBytes(128)).toEqual([0, 1])
    expect(songPositionBytes(0x3fff)).toEqual([0x7f, 0x7f])
  })

  it('wraps rather than overflowing its 14 bits on a long set', () => {
    const wrapped = songPositionAt(0x4000 / 16 + 1, 1)
    expect(wrapped).toBeGreaterThanOrEqual(0)
    expect(wrapped).toBeLessThan(0x4000)
    expect(songPositionBytes(wrapped).every((byte) => byte <= 0x7f)).toBe(true)
  })
})

describe('ticksBetween', () => {
  it('returns the ticks in the window, as cycle positions', () => {
    // 96 ticks per cycle, so ticks land every 1/96 of a cycle.
    expect(ticksBetween(0, 3 / 96, 1)).toEqual([1 / 96, 2 / 96, 3 / 96])
  })

  it('is half-open at the start, so consecutive passes never repeat a tick', () => {
    const first = ticksBetween(0, 2 / 96, 1)
    const second = ticksBetween(2 / 96, 4 / 96, 1)
    expect(first).toEqual([1 / 96, 2 / 96])
    expect(second).toEqual([3 / 96, 4 / 96])
    expect(new Set([...first, ...second]).size).toBe(4)
  })

  it('skips nothing across a run of passes', () => {
    let at = 0
    const seen: number[] = []
    for (let pass = 0; pass < 20; pass += 1) {
      const to = at + 0.037 // a window that does not divide evenly into ticks
      seen.push(...ticksBetween(at, to, 1))
      at = to
    }
    // Every tick from 1 up to the last one inside the window, exactly once.
    const expected = Array.from({ length: seen.length }, (_, i) => (i + 1) / 96)
    expect(seen).toEqual(expected)
  })

  it('is empty for a window that does not move, or moves backwards', () => {
    expect(ticksBetween(1, 1, 1)).toEqual([])
    expect(ticksBetween(1, 0.5, 1)).toEqual([])
  })

  it('refuses to emit an unbounded burst after a long stall', () => {
    expect(ticksBetween(0, 10_000, 1)).toEqual([])
  })

  it('treats a nonsense bar length as nothing to send', () => {
    expect(ticksBetween(0, 1, 0)).toEqual([])
    expect(ticksBetween(0, 1, -4)).toEqual([])
  })
})
