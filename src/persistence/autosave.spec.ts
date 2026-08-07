import { describe, expect, it, vi } from 'vitest'
import { demoProject } from '../model/defaults'
import { AUTOSAVE_KEY, clearAutosave, debounce, readAutosave, writeAutosave } from './autosave'

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial))
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  }
}

describe('autosave', () => {
  it('round-trips a project', () => {
    const storage = fakeStorage()
    const project = demoProject()
    expect(writeAutosave(project, storage)).toBe(true)
    expect(readAutosave(storage)).toEqual(project)
  })

  it('reads nothing when there is nothing stored', () => {
    expect(readAutosave(fakeStorage())).toBeNull()
  })

  it('discards a stored document that no longer validates', () => {
    // A bad autosave must not be able to wedge the app on boot.
    expect(readAutosave(fakeStorage({ [AUTOSAVE_KEY]: '{"meta":{}}' }))).toBeNull()
    expect(readAutosave(fakeStorage({ [AUTOSAVE_KEY]: 'not json' }))).toBeNull()
  })

  it('survives storage being unavailable', () => {
    const broken = {
      ...fakeStorage(),
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
    } as Storage
    expect(readAutosave(broken)).toBeNull()
    expect(writeAutosave(demoProject(), broken)).toBe(false)
  })

  it('clears', () => {
    const storage = fakeStorage()
    writeAutosave(demoProject(), storage)
    clearAutosave(storage)
    expect(readAutosave(storage)).toBeNull()
  })
})

describe('debounce', () => {
  it('runs once, with the last arguments', () => {
    vi.useFakeTimers()
    const spy = vi.fn()
    const debounced = debounce(spy, 100)
    debounced('a')
    debounced('b')
    vi.advanceTimersByTime(99)
    expect(spy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(spy).toHaveBeenCalledExactlyOnceWith('b')
    vi.useRealTimers()
  })

  it('can be cancelled before it fires', () => {
    vi.useFakeTimers()
    const spy = vi.fn()
    const debounced = debounce(spy, 100)
    debounced('a')
    debounced.cancel()
    vi.advanceTimersByTime(200)
    expect(spy).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
