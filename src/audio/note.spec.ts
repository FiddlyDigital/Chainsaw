import { describe, expect, it } from 'vitest'
import { noteToMidi } from './note'

describe('noteToMidi', () => {
  it('uses octave 3 when none is written, as Strudel does', () => {
    expect(noteToMidi('c')).toBe(48)
    expect(noteToMidi('c3')).toBe(48)
  })

  it('reads octaves, including negative ones', () => {
    expect(noteToMidi('c4')).toBe(60)
    expect(noteToMidi('a4')).toBe(69)
    expect(noteToMidi('c-1')).toBe(0)
  })

  it('reads both spellings of both accidentals', () => {
    expect(noteToMidi('c#4')).toBe(61)
    expect(noteToMidi('cs4')).toBe(61)
    expect(noteToMidi('db4')).toBe(61)
    expect(noteToMidi('df4')).toBe(61)
    expect(noteToMidi('c##4')).toBe(62)
  })

  it('is case insensitive', () => {
    expect(noteToMidi('Eb2')).toBe(noteToMidi('eb2'))
  })

  it('returns NaN for anything that is not a note', () => {
    expect(noteToMidi('bd')).toBeNaN()
    expect(noteToMidi('')).toBeNaN()
    expect(noteToMidi(60)).toBeNaN()
    expect(noteToMidi(undefined)).toBeNaN()
  })
})
