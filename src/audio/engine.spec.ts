import { describe, expect, it } from 'vitest'
import { audible, prune } from './engine'

/**
 * What the scratch pad contributes to the mix. The scratch pattern plays
 * alongside the tracks rather than instead of them, which is the whole point
 * of having it — and every one of these is queued for a boundary by the caller,
 * so none of them is heard mid-bar.
 */
describe('audible', () => {
  it('stacks the scratch over the tracks', () => {
    expect(audible(['a', 'b'], 'scratch', 'stack')).toEqual(['a', 'b', 'scratch'])
  })

  it('drops the tracks when the scratch is soloed', () => {
    expect(audible(['a', 'b'], 'scratch', 'solo')).toEqual(['scratch'])
  })

  it('leaves the tracks alone when the scratch is muted', () => {
    expect(audible(['a', 'b'], 'scratch', 'off')).toEqual(['a', 'b'])
  })

  it('never silences the set for want of a scratch pattern to solo', () => {
    expect(audible(['a', 'b'], null, 'solo')).toEqual(['a', 'b'])
    expect(audible(['a', 'b'], null, 'stack')).toEqual(['a', 'b'])
  })

  it('plays the scratch against silence when there are no tracks', () => {
    expect(audible([], 'scratch', 'stack')).toEqual(['scratch'])
    expect(audible([], 'scratch', 'solo')).toEqual(['scratch'])
  })

  it('does not disturb the array it was given', () => {
    const tracks = ['a']
    audible(tracks, 'scratch', 'stack')
    expect(tracks).toEqual(['a'])
  })
})

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
