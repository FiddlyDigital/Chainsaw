import { describe, expect, it } from 'vitest'
import { demoProject, emptyProject } from '../model/defaults'
import { parse, serialize } from './files'

describe('round trip', () => {
  it('reads back exactly what it wrote', () => {
    const project = demoProject()
    expect(parse(serialize(project))).toEqual(project)
  })

  it('produces a stable, diffable document', () => {
    const project = demoProject()
    expect(serialize(project)).toBe(serialize(parse(serialize(project))))
    expect(serialize(project).endsWith('}\n')).toBe(true)
    expect(serialize(project)).toContain('\n  "meta": {')
  })

  it('keeps live scene state across a save and load mid-performance', () => {
    const project = emptyProject()
    project.slots = { A1: { code: 's("bd")', length: 16, steps: '16n', color: '#ffffff', muted: false } }
    project.meta.lastSceneState = { cells: { '1': 'A1' }, scene: 'drop' }
    expect(parse(serialize(project)).meta.lastSceneState).toEqual({ cells: { '1': 'A1' }, scene: 'drop' })
  })
})

describe('parse', () => {
  it('says so when the file is not JSON', () => {
    expect(() => parse('{ nope')).toThrow(/not valid JSON/)
  })

  it('says what is wrong when the JSON is not a project', () => {
    expect(() => parse('{"meta":{}}')).toThrow(/not a valid Chainsaw project/)
  })

  it('refuses a document with a dangling reference rather than loading it half-broken', () => {
    const project = emptyProject() as never as { chains: Record<string, unknown> }
    project.chains = { CH: { track: 1, steps: [{ slot: 'gone', repeat: 1, transpose: 0, gainOffset: 0 }] } }
    expect(() => parse(JSON.stringify(project))).toThrow(/unknown slot "gone"/)
  })
})
