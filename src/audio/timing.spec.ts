import { describe, expect, it } from 'vitest'
import { cpsFor, nextBoundary, slotCycles, stepsPerCycle, wrap } from './timing'

describe('stepsPerCycle', () => {
  it('reads the note division', () => {
    expect(stepsPerCycle('16n')).toBe(16)
    expect(stepsPerCycle('4n')).toBe(4)
    expect(stepsPerCycle('1n')).toBe(1)
  })
})

describe('slotCycles', () => {
  it('makes the LSDJ default phrase exactly one cycle', () => {
    expect(slotCycles({ length: 16, steps: '16n' })).toBe(1)
  })

  it('scales with length and with resolution', () => {
    expect(slotCycles({ length: 32, steps: '16n' })).toBe(2)
    expect(slotCycles({ length: 8, steps: '16n' })).toBe(0.5)
    expect(slotCycles({ length: 16, steps: '8n' })).toBe(2)
  })
})

describe('cpsFor', () => {
  it('matches Strudel"s own default at 120bpm in 4/4', () => {
    expect(cpsFor({ bpm: 120, cyclesPerBar: 1 })).toBe(0.5)
  })

  it('scales with tempo and with cycles per bar', () => {
    expect(cpsFor({ bpm: 240, cyclesPerBar: 1 })).toBe(1)
    expect(cpsFor({ bpm: 120, cyclesPerBar: 2 })).toBe(1)
  })
})

describe('nextBoundary', () => {
  it('leaves an immediate change where it is', () => {
    expect(nextBoundary(3.7, 'immediate', 1)).toBe(3.7)
  })

  it('rounds up to the next whole cycle', () => {
    expect(nextBoundary(3.2, 'cycle', 1)).toBe(4)
    expect(nextBoundary(3.9, 'cycle', 4)).toBe(4)
  })

  it('rounds up to the next bar', () => {
    expect(nextBoundary(3.2, 'bar', 4)).toBe(4)
    expect(nextBoundary(4.1, 'bar', 4)).toBe(8)
  })

  it('waits for the following boundary when it is already on one', () => {
    // Landing a change on the boundary that has just been queried would place
    // it inside audio that is already scheduled.
    expect(nextBoundary(4, 'bar', 4)).toBe(8)
    expect(nextBoundary(0, 'cycle', 1)).toBe(1)
  })
})

describe('wrap', () => {
  it('keeps a position inside the loop, including behind zero', () => {
    expect(wrap(9, 4)).toBe(1)
    expect(wrap(-1, 4)).toBe(3)
    expect(wrap(3, 0)).toBe(0)
  })
})
