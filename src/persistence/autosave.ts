/**
 * Autosave into localStorage.
 *
 * The file on disk is the real project; this is only so that a reload, a
 * crashed tab or a closed laptop mid-set does not lose the last few minutes.
 * A stored document that no longer validates is discarded rather than loaded,
 * so a bad autosave can never wedge the app on boot.
 */
import type { Project } from '../model/types'
import { migrate } from '../model/migrate'
import { validateProject } from '../model/validate'

export const AUTOSAVE_KEY = 'chainsaw.autosave.v1'

export function readAutosave(storage: Storage = localStorage): Project | null {
  let raw: string | null
  try {
    raw = storage.getItem(AUTOSAVE_KEY)
  } catch {
    return null // storage disabled (private mode, blocked cookies)
  }
  if (!raw) return null
  try {
    // Migrated like a file on disk: an autosave written by an older version
    // carries fields this one has dropped, and a closed schema rejects the
    // whole document over them rather than ignoring them.
    const { document } = migrate(JSON.parse(raw))
    return validateProject(document).ok ? (document as Project) : null
  } catch {
    return null
  }
}

export function writeAutosave(project: Project, storage: Storage = localStorage): boolean {
  try {
    storage.setItem(AUTOSAVE_KEY, JSON.stringify(project))
    return true
  } catch {
    return false // quota exceeded or storage disabled; the file is still the truth
  }
}

export function clearAutosave(storage: Storage = localStorage): void {
  try {
    storage.removeItem(AUTOSAVE_KEY)
  } catch {
    // nothing to do
  }
}

/** Call `flush` at most once per `delay` ms, and once more after the last call. */
export function debounce<T extends unknown[]>(fn: (...args: T) => void, delay: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const wrapped = (...args: T) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
  }
  return wrapped
}
