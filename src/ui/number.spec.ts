import { describe, expect, it } from 'vitest'
import { parseNumberField } from './number'

/**
 * What a number field is allowed to pass on.
 *
 * Every case here is reachable by typing, and the ones that matter are the
 * halfway states: a field being cleared before a new value goes in, and the
 * lone minus of a negative number. Both used to reach the store as 0 or NaN.
 */
describe('parseNumberField', () => {
  it('takes a number inside the bounds', () => {
    expect(parseNumberField('90', 20, 400)).toBe(90)
    expect(parseNumberField(' 90 ', 20, 400)).toBe(90)
    expect(parseNumberField('0.5', 0.25, 16)).toBe(0.5)
  })

  it('refuses an empty field rather than reading it as zero', () => {
    expect(parseNumberField('', 20, 400)).toBeNull()
    expect(parseNumberField('   ', 20, 400)).toBeNull()
  })

  it('refuses the halfway states of typing a negative number', () => {
    expect(parseNumberField('-', -48, 48)).toBeNull()
    expect(parseNumberField('-4', -48, 48)).toBe(-4)
  })

  it('refuses text', () => {
    expect(parseNumberField('abc', 20, 400)).toBeNull()
  })

  it('refuses the Infinity that 1e999 parses to', () => {
    // A JSON Schema `maximum` does not catch this one: Infinity is not less
    // than the limit, so the comparison the validator generates passes it.
    expect(parseNumberField('1e999', 20, 400)).toBeNull()
    expect(parseNumberField('-1e999', 20, 400)).toBeNull()
  })

  it('refuses a value outside the bounds, at either end', () => {
    expect(parseNumberField('19', 20, 400)).toBeNull()
    expect(parseNumberField('401', 20, 400)).toBeNull()
    expect(parseNumberField('20', 20, 400)).toBe(20)
    expect(parseNumberField('400', 20, 400)).toBe(400)
  })

  it('refuses a fraction where the document wants an integer', () => {
    expect(parseNumberField('2.5', 1, 32, true)).toBeNull()
    expect(parseNumberField('2', 1, 32, true)).toBe(2)
    // …and allows one where it does not.
    expect(parseNumberField('2.5', 1, 32)).toBe(2.5)
  })
})
