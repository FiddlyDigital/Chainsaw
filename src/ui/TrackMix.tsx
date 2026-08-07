import { useProject } from '../store/project'

/**
 * A track's mute and solo, as a channel strip's two buttons.
 *
 * Both live on the project rather than the runtime store, so a set saved
 * mid-performance comes back with the same tracks killed, and both are
 * undoable like every other document change. The engine applies them at the
 * next boundary, so a mute lands on the beat rather than mid-bar.
 *
 * Rendered next to the track number in both places a track is listed — the
 * grid's column headings and the arrangement's row labels — because needing to
 * change pane to drop a track is exactly the wrong thing mid-set.
 */
export function TrackMix({ track }: { track: number }) {
  const settings = useProject((state) => state.project.tracks?.[String(track)])
  const setTrack = useProject((state) => state.setTrack)

  const muted = Boolean(settings?.muted)
  const soloed = Boolean(settings?.soloed)

  return (
    <span className="track-mix">
      <button
        className={`mini mix ${muted ? 'muted' : ''}`}
        onClick={() => setTrack(track, { muted: !muted })}
        aria-pressed={muted}
        aria-label={`${muted ? 'Unmute' : 'Mute'} track ${track}`}
        title={`${muted ? 'Unmute' : 'Mute'} track ${track}`}
      >
        M
      </button>
      <button
        className={`mini mix ${soloed ? 'soloed' : ''}`}
        onClick={() => setTrack(track, { soloed: !soloed })}
        aria-pressed={soloed}
        aria-label={`${soloed ? 'Unsolo' : 'Solo'} track ${track}`}
        title={`${soloed ? 'Unsolo' : 'Solo'} track ${track}`}
      >
        S
      </button>
    </span>
  )
}
