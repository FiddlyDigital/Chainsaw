import { describe, expect, it } from 'vitest'
import { prune } from './engine'

/**
 * `prune` bounds the scheduled-piece list. Without it a performance would grow
 * one entry per committed edit and never let go of any of them — and dropping
 * the wrong one would silence a track mid-set, so what it keeps matters.
 */
const piece = (from: number) => ({ from, pattern: { id: from } as never })

describe('prune', () => {
  it('keeps the piece that is currently playing plus everything still to come', () => {
    const list = [piece(0), piece(4), piece(8), piece(12)]
    expect(prune(list, 9).map((p) => p.from)).toEqual([8, 12])
  })

  it('keeps a piece that starts exactly now', () => {
    expect(prune([piece(0), piece(4)], 4).map((p) => p.from)).toEqual([4])
  })

  it('keeps everything when nothing has started yet', () => {
    expect(prune([piece(4), piece(8)], 0).map((p) => p.from)).toEqual([4, 8])
  })

  it('sorts an out-of-order list before deciding', () => {
    expect(prune([piece(8), piece(0), piece(4)], 5).map((p) => p.from)).toEqual([4, 8])
  })

  it('never empties the list', () => {
    expect(prune([piece(0)], 100).map((p) => p.from)).toEqual([0])
    expect(prune([], 100)).toEqual([])
  })
})
