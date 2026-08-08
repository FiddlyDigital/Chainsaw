import { useMemo, useState } from 'react'
import { chainTimeline, songCycles } from '../audio/timeline'
import { useProject } from '../store/project'
import { useRuntime } from '../store/runtime'
import { TrackMix } from './TrackMix'
import { useCoarsePointer } from './viewport'

/**
 * Bar width, and the width of the track labels down the left.
 *
 * A tap resolves to a bar by dividing its x-coordinate by the first of these,
 * so both live here rather than in the stylesheet, which reads them back as
 * custom properties. A mouse can hit a 26px bar; a fingertip covers three of
 * them, hence the wider default.
 */
const BARS = { fine: 26, coarse: 44 }
/** Wide enough for the track number, its live marker and its mute/solo. */
const LABEL_WIDTH = 92

/**
 * The widths zoom steps through.
 *
 * Discrete rather than a continuous factor: a button press should land
 * somewhere predictable, and repeated multiplication drifts into fractional
 * pixels that make the ruler and the blocks disagree about where a bar is.
 * The two defaults are both in the list, so the first press from either moves
 * exactly one step.
 */
const ZOOM_STEPS = [8, 12, 17, 26, 34, 44, 60, 82, 112]

/** The step nearest a width, so a zoom from either default lands cleanly. */
function stepIndex(width: number): number {
  let best = 0
  for (let i = 1; i < ZOOM_STEPS.length; i += 1) {
    if (Math.abs(ZOOM_STEPS[i] - width) < Math.abs(ZOOM_STEPS[best] - width)) best = i
  }
  return best
}

interface Drag {
  track: number
  index: number
  mode: 'move' | 'resize'
  startX: number
  startBar: number
  startLen: number
  /** Where the block currently sits on screen; not yet in the document. */
  bar: number
  len: number
}

/**
 * Arrangement view (PRD §8.6): tracks as rows, a bar ruler on top, chain
 * placements as blocks that can be dragged along the timeline and resized from
 * their right edge. The playhead follows the transport.
 *
 * Placing works like a pen tool: pick a chain from the palette, then click an
 * empty stretch of a track. Overlaps are rejected by the store's validator, so
 * a drag that would collide simply does not take.
 */
export function ArrangementView() {
  const project = useProject((state) => state.project)
  const placeChain = useProject((state) => state.placeChain)
  const updatePlacement = useProject((state) => state.updatePlacement)
  const removePlacement = useProject((state) => state.removePlacement)
  const lastError = useProject((state) => state.lastError)

  const bar = useRuntime((state) => state.status.bar)
  // The song, not the clock: a playhead sweeping an arrangement that is not
  // sounding — because only the scratch pad is — says the wrong thing.
  const started = useRuntime((state) => state.status.started && state.tracksPlaying)
  const overrides = useRuntime((state) => state.overrides)
  const setEditingChain = useRuntime((state) => state.setEditingChain)

  const storedBarWidth = useRuntime((state) => state.arrangementBarWidth)
  const setBarWidth = useRuntime((state) => state.setArrangementBarWidth)
  const coarse = useCoarsePointer()
  const BAR_WIDTH = storedBarWidth ?? (coarse ? BARS.coarse : BARS.fine)

  const zoomIndex = stepIndex(BAR_WIDTH)
  const zoom = (direction: 1 | -1) => setBarWidth(ZOOM_STEPS[zoomIndex + direction])

  const [pen, setPen] = useState<string | null>(null)
  // A drag is previewed locally and written to the document once, on release.
  // Committing per pointer move would re-resolve the pattern and push an undo
  // entry for every pixel of the gesture.
  const [drag, setDrag] = useState<Drag | null>(null)

  const tracks = useMemo(() => Array.from({ length: project.meta.trackCount }, (_, i) => i + 1), [project.meta.trackCount])
  const totalBars = Math.max(32, Math.ceil(songCycles(project) / project.meta.cyclesPerBar) + 8)

  /** Default placement length: one full pass of the chain, rounded up to a bar. */
  const chainBars = (chainId: string) => {
    const cycles = chainTimeline(project, chainId).loop
    return Math.max(1, Math.ceil(cycles / project.meta.cyclesPerBar))
  }

  const onPointerDown = (event: React.PointerEvent, track: number, index: number, mode: Drag['mode']) => {
    event.stopPropagation()
    const placement = project.arrangement.tracks[String(track)]?.[index]
    if (!placement) return
    ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
    setDrag({
      track,
      index,
      mode,
      startX: event.clientX,
      startBar: placement.bar,
      startLen: placement.len,
      bar: placement.bar,
      len: placement.len,
    })
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (!drag) return
    const delta = Math.round((event.clientX - drag.startX) / BAR_WIDTH)
    const bar = drag.mode === 'move' ? Math.max(0, drag.startBar + delta) : drag.startBar
    const len = drag.mode === 'resize' ? Math.max(1, drag.startLen + delta) : drag.startLen
    if (bar === drag.bar && len === drag.len) return
    setDrag({ ...drag, bar, len })
  }

  const onPointerUp = () => {
    if (!drag) return
    if (drag.bar !== drag.startBar || drag.len !== drag.startLen) {
      updatePlacement(drag.track, drag.index, { bar: drag.bar, len: drag.len })
    }
    setDrag(null)
  }

  /** Where a block should be drawn: its dragged position, or its stored one. */
  const shown = (track: number, index: number, placement: { bar: number; len: number }) =>
    drag && drag.track === track && drag.index === index ? { bar: drag.bar, len: drag.len } : placement

  const placeAt = (track: number, event: React.MouseEvent<HTMLDivElement>) => {
    if (!pen) return
    const rect = event.currentTarget.getBoundingClientRect()
    const barIndex = Math.max(0, Math.floor((event.clientX - rect.left) / BAR_WIDTH))
    placeChain(track, { bar: barIndex, chain: pen, len: chainBars(pen) })
  }

  return (
    <div className="arrangement">
      <div className="palette">
        {/* Doubles as the pen's status line, rather than a separate hint that
            would be off the side of a narrow screen exactly when it matters. */}
        <span className={`palette-label ${pen ? 'armed' : ''}`}>{pen ? <>place “{pen}” on a track</> : 'chains'}</span>
        {/* Only the chips scroll, so the pen's status line and the zoom stay
            put on a narrow screen instead of sliding off the ends. */}
        <div className="palette-chips">
          {Object.entries(project.chains).map(([id, chain]) => (
            <button
              key={id}
              className={`chip ${pen === id ? 'on' : ''}`}
              onClick={() => setPen(pen === id ? null : id)}
              title={`Track ${chain.track}, ${chainTimeline(project, id).loop} cycles. Select, then click a track row to place.`}
            >
              {id}
              <em>t{chain.track}</em>
            </button>
          ))}
          {Object.keys(project.chains).length === 0 && <span className="hint">no chains yet — make one in the panel</span>}
        </div>
        <span className="zoom">
          <button className="mini" onClick={() => zoom(-1)} disabled={zoomIndex === 0} aria-label="Zoom out" title="Zoom out">
            −
          </button>
          <button
            className="mini"
            onClick={() => zoom(1)}
            disabled={zoomIndex === ZOOM_STEPS.length - 1}
            aria-label="Zoom in"
            title="Zoom in"
          >
            +
          </button>
        </span>
      </div>

      <div className="timeline-scroll">
        <div
          className="timeline"
          style={{ width: totalBars * BAR_WIDTH + LABEL_WIDTH, ['--label-width' as string]: `${LABEL_WIDTH}px` }}
        >
          <div className="ruler">
            <div className="row-label" />
            <div className="ruler-bars">
              {Array.from({ length: totalBars }, (_, i) => (
                <span key={i} className={i % 4 === 0 ? 'tick major' : 'tick'} style={{ width: BAR_WIDTH }}>
                  {i % 4 === 0 ? i + 1 : ''}
                </span>
              ))}
            </div>
          </div>

          {tracks.map((track) => {
            const placements = project.arrangement.tracks[String(track)] ?? []
            return (
              <div key={track} className={`track-row ${overrides[track] ? 'overridden' : ''}`}>
                <div className="row-label">
                  {track}
                  {overrides[track] && <em title="A live scene is overriding this track">live</em>}
                  <TrackMix track={track} />
                </div>
                <div
                  className="lane"
                  onClick={(event) => placeAt(track, event)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                >
                  {placements.map((placement, index) => {
                    const at = shown(track, index, placement)
                    return (
                      <div
                        key={`${placement.chain}-${index}`}
                        className="block"
                        style={{ left: at.bar * BAR_WIDTH, width: at.len * BAR_WIDTH - 2 }}
                        onPointerDown={(event) => onPointerDown(event, track, index, 'move')}
                        // Without this the lane's pen-tool click would fire too,
                        // dropping a second chain on top of the one just dragged.
                        onClick={(event) => event.stopPropagation()}
                        onDoubleClick={() => setEditingChain(placement.chain)}
                        title={`${placement.chain} — bar ${at.bar + 1} for ${at.len} bars. Drag to move, drag the right edge to resize, double-click to edit.`}
                      >
                        <span className="block-name">{placement.chain}</span>
                        <button
                          className="block-remove"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            removePlacement(track, index)
                          }}
                          aria-label={`Remove ${placement.chain} from track ${track}`}
                        >
                          ×
                        </button>
                        <span
                          className="block-resize"
                          onPointerDown={(event) => onPointerDown(event, track, index, 'resize')}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {started && (
            <div className="playhead" style={{ left: LABEL_WIDTH + (bar % totalBars) * BAR_WIDTH }} aria-hidden="true" />
          )}
        </div>
      </div>
      {lastError && <p className="inline-error">{lastError}</p>}
    </div>
  )
}
