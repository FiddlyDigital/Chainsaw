import { describe, expect, it } from 'vitest'
import { anySoloed, audible, prune, trackAudible } from './engine'

/**
 * The mixer. Getting solo wrong silences a set on stage, so the rules are
 * pinned here rather than left to read off the one line that implements them.
 */
describe('trackAudible', () => {
  it('plays a track nobody has touched', () => {
    expect(trackAudible(undefined, false)).toBe(true)
    expect(trackAudible({}, false)).toBe(true)
  })

  it('silences a muted track', () => {
    expect(trackAudible({ muted: true }, false)).toBe(false)
  })

  it('silences everything that is not soloed, once anything is', () => {
    expect(trackAudible(undefined, true)).toBe(false)
    expect(trackAudible({ soloed: true }, true)).toBe(true)
  })

  it('lets mute win over solo on the same track', () => {
    expect(trackAudible({ muted: true, soloed: true }, true)).toBe(false)
  })

  it('ignores a stale solo flag when nothing is soloing', () => {
    // `anySoloed` is what decides; a lone flag cannot mute the rest by itself.
    expect(trackAudible({ soloed: true }, false)).toBe(true)
  })

  it('treats a fader all the way down as nothing to schedule', () => {
    expect(trackAudible({ gain: 0 }, false)).toBe(false)
    // …but only at zero. Quiet is still audible, and unity is the default.
    expect(trackAudible({ gain: 0.01 }, false)).toBe(true)
    expect(trackAudible({ gain: 1 }, false)).toBe(true)
  })
})

describe('anySoloed', () => {
  it('is false for a project with no mixer state at all', () => {
    expect(anySoloed(undefined)).toBe(false)
    expect(anySoloed({})).toBe(false)
  })

  it('is false when tracks are only muted', () => {
    expect(anySoloed({ '1': { muted: true }, '2': { muted: true } })).toBe(false)
  })

  it('is true as soon as one track is soloed', () => {
    expect(anySoloed({ '1': { muted: true }, '3': { soloed: true } })).toBe(true)
  })
})

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
