/**
 * Note-name to MIDI conversion, used when a chain step transposes a slot.
 *
 * superdough has this function but does not export it from `@strudel/webaudio`'s
 * published bundle, so it is reimplemented here to the same rules — including
 * the default octave of 3, which is what an untagged `note("c")` means
 * everywhere else in Strudel. Getting that constant wrong would transpose by
 * whole octaves.
 */
const CHROMA: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }
const ACCIDENTAL: Record<string, number> = { '#': 1, s: 1, b: -1, f: -1 }

const NOTE = /^([a-gA-G])([#bsf]*)(-?[0-9]*)$/

/** MIDI number for a note name, or NaN if it is not one. */
export function noteToMidi(note: unknown, defaultOctave = 3): number {
  if (typeof note !== 'string') return Number.NaN
  const match = NOTE.exec(note.trim())
  if (!match) return Number.NaN
  const [, pitch, accidentals, octave] = match
  const offset = accidentals.split('').reduce((total, char) => total + (ACCIDENTAL[char] ?? 0), 0)
  const oct = octave === '' ? defaultOctave : Number(octave)
  return (oct + 1) * 12 + CHROMA[pitch.toLowerCase()] + offset
}
