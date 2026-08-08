/**
 * The browser side of MIDI: asking for access, and listing outputs.
 *
 * Kept apart from `midi.ts` so the clock arithmetic stays testable without a
 * browser, and so there is exactly one place that knows Web MIDI is optional.
 * Firefox gates it behind a permission prompt and Safari did not ship it for
 * years, so every path here has to survive a flat refusal.
 */
import type { MidiOutputPort } from './midi'

let access: MIDIAccess | null = null

/** Whether this browser has Web MIDI at all, before asking for anything. */
export function midiSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function'
}

/**
 * Request MIDI access, prompting the user the first time.
 *
 * Deliberately not called on load: asking for a permission nobody has yet
 * shown any interest in is how you get it denied for the rest of the session.
 */
export async function requestMidiAccess(): Promise<boolean> {
  if (access) return true
  if (!midiSupported()) return false
  try {
    access = await navigator.requestMIDIAccess({ sysex: false })
    return true
  } catch {
    return false // refused, or blocked by permissions policy
  }
}

/**
 * Whether MIDI access has already been granted, without asking for it.
 *
 * This is what makes reconnecting to last session's output on load safe:
 * calling `requestMIDIAccess` outright would put a permission prompt in front
 * of someone who has not asked for MIDI yet, on every boot. A browser that
 * does not recognise the permission name answers false, so it waits to be
 * asked properly rather than gambling on a prompt.
 */
export async function midiPermissionGranted(): Promise<boolean> {
  if (access) return true
  if (!midiSupported() || !navigator.permissions?.query) return false
  try {
    const status = await navigator.permissions.query({ name: 'midi' as PermissionName })
    return status.state === 'granted'
  } catch {
    return false
  }
}

export function midiOutputs(): MidiOutputPort[] {
  if (!access) return []
  return [...access.outputs.values()].map((output) => ({ id: output.id, name: output.name || output.id }))
}

export function midiOutput(id: string | null): MIDIOutput | null {
  if (!access || !id) return null
  return access.outputs.get(id) ?? null
}

/** Call `listener` when a device is plugged in or pulled out. */
export function onMidiPortsChanged(listener: () => void): () => void {
  const target = access
  if (!target) return () => {}
  const handler = () => listener()
  target.addEventListener('statechange', handler)
  return () => target.removeEventListener('statechange', handler)
}
