/**
 * Which MIDI output to send clock to, remembered across reloads.
 *
 * In localStorage rather than the project file, deliberately: a port id means
 * nothing on another machine, so it belongs to this browser on this computer
 * and not to the song. The same reason the master fader is not in there.
 */
export const MIDI_OUTPUT_KEY = 'chainsaw.midiOutput.v1'

export function readMidiOutputId(storage: Storage = localStorage): string | null {
  try {
    return storage.getItem(MIDI_OUTPUT_KEY) || null
  } catch {
    return null // storage disabled (private mode, blocked cookies)
  }
}

export function writeMidiOutputId(id: string | null, storage: Storage = localStorage): void {
  try {
    if (id) storage.setItem(MIDI_OUTPUT_KEY, id)
    else storage.removeItem(MIDI_OUTPUT_KEY)
  } catch {
    // Nothing to do: the clock still works, it just needs picking again.
  }
}
