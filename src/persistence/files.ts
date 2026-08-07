/**
 * Reading and writing the project file.
 *
 * A project is one `.chainsaw.json` document — readable, diffable, and the same
 * bytes whether it came from the file picker or a download. Where the File
 * System Access API exists it is used so that Save writes back to the file the
 * performer opened; everywhere else it falls back to a download and a file
 * input, which works in every browser.
 */
import type { Project } from '../model/types'
import { formatErrors, validateProject } from '../model/validate'

export const FILE_EXTENSION = '.chainsaw.json'

interface PickerWindow {
  showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>
  showOpenFilePicker?: (options: unknown) => Promise<FileSystemFileHandle[]>
}

export function hasFileSystemAccess(): boolean {
  const picker = globalThis as unknown as PickerWindow
  return typeof picker.showSaveFilePicker === 'function' && typeof picker.showOpenFilePicker === 'function'
}

/** Two-space JSON with a trailing newline, so `git diff` stays legible. */
export function serialize(project: Project): string {
  return `${JSON.stringify(project, null, 2)}\n`
}

export function parse(text: string): Project {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`not valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  const result = validateProject(value)
  if (!result.ok) throw new Error(`not a valid Chainsaw project:\n${formatErrors(result.errors)}`)
  return value as Project
}

function fileName(project: Project): string {
  const safe = project.meta.name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled'
  return `${safe}${FILE_EXTENSION}`
}

const pickerOptions = (project: Project) => ({
  suggestedName: fileName(project),
  types: [{ description: 'Chainsaw project', accept: { 'application/json': ['.json'] } }],
})

/** Ask for a location and write there. Returns the handle for later plain saves. */
export async function saveAs(project: Project): Promise<FileSystemFileHandle | null> {
  const picker = globalThis as unknown as PickerWindow
  if (picker.showSaveFilePicker) {
    const handle = await picker.showSaveFilePicker(pickerOptions(project))
    await writeTo(handle, project)
    return handle
  }
  download(project)
  return null
}

export async function writeTo(handle: FileSystemFileHandle, project: Project): Promise<void> {
  const writable = await handle.createWritable()
  await writable.write(serialize(project))
  await writable.close()
}

export function download(project: Project): void {
  const blob = new Blob([serialize(project)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName(project)
  link.click()
  URL.revokeObjectURL(url)
}

export interface OpenedProject {
  project: Project
  handle: FileSystemFileHandle | null
}

/** Open via the picker where available, otherwise via a transient file input. */
export async function openProject(): Promise<OpenedProject | null> {
  const picker = globalThis as unknown as PickerWindow
  if (picker.showOpenFilePicker) {
    const [handle] = await picker.showOpenFilePicker({
      multiple: false,
      types: [{ description: 'Chainsaw project', accept: { 'application/json': ['.json'] } }],
    })
    if (!handle) return null
    const file = await handle.getFile()
    return { project: parse(await file.text()), handle }
  }
  const file = await pickFile()
  if (!file) return null
  return { project: parse(await file.text()), handle: null }
}

function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => resolve(null), { once: true })
    input.click()
  })
}
