import { describe, expect, it } from 'vitest'
import { demoProject } from './defaults'
import { migrate } from './migrate'
import { validateProject } from './validate'

/**
 * Opening projects written by an older version.
 *
 * The schema is closed, so a removed field is not ignored on load — it makes
 * the whole document invalid and the file refuses to open. Every one of these
 * is the difference between someone's saved set opening and not.
 */

/** A project as an older, arrangement-carrying version would have written it. */
function legacy() {
  return {
    ...demoProject(),
    arrangement: {
      tracks: {
        '1': [
          { bar: 0, chain: 'DRUMS_A', len: 8 },
          { bar: 8, chain: 'DRUMS_B', len: 8 },
        ],
        '2': [{ bar: 4, chain: 'HATS', len: 12 }],
      },
    },
  }
}

describe('migrate', () => {
  it('lets an older project open, where the raw document would be refused', () => {
    const before = legacy()
    expect(validateProject(before).ok).toBe(false)
    expect(validateProject(migrate(before).document).ok).toBe(true)
  })

  it('says what it had to drop, and how much', () => {
    expect(migrate(legacy()).dropped).toEqual(['its arrangement (3 placements) — Chainsaw is grid-only now'])
  })

  it('counts one placement in the singular', () => {
    const project = { ...demoProject(), arrangement: { tracks: { '1': [{ bar: 0, chain: 'DRUMS_A', len: 8 }] } } }
    expect(migrate(project).dropped).toEqual(['its arrangement (1 placement) — Chainsaw is grid-only now'])
  })

  it('keeps everything the current format still has', () => {
    const migrated = migrate(legacy()).document as Record<string, unknown>
    const expected = demoProject()
    expect(migrated).toEqual(expected)
    // Chains and slots survive; it is only the placements that are gone, so
    // nothing has to be rebuilt to get the sounds back.
    expect(Object.keys(migrated.chains as object)).toEqual(Object.keys(expected.chains))
  })

  it('says nothing about an empty arrangement, which lost nobody anything', () => {
    const project = { ...demoProject(), arrangement: { tracks: {} } }
    const { document, dropped } = migrate(project)
    expect(dropped).toEqual([])
    expect(validateProject(document).ok).toBe(true)
  })

  it('leaves a current project completely alone', () => {
    const project = demoProject()
    const { document, dropped } = migrate(project)
    expect(document).toEqual(project)
    expect(dropped).toEqual([])
  })

  it('does not mutate what it was given', () => {
    const project = legacy()
    migrate(project)
    expect('arrangement' in project).toBe(true)
  })

  it('passes rubbish straight through for the validator to reject', () => {
    expect(migrate(null).document).toBeNull()
    expect(migrate('nope').document).toBe('nope')
    expect(migrate(42).dropped).toEqual([])
  })
})
