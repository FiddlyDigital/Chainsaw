import { useMemo } from 'react'
import { refTimeline } from '../audio/timeline'
import { useProject } from '../store/project'
import { useRuntime } from '../store/runtime'
import { CommittedInput } from './CommittedInput'
import { TrackMix } from './TrackMix'

/**
 * Session view (PRD §8.5): columns are tracks, rows are scenes, Ableton's way
 * round. Clicking a scene's row header fires every cell in it at once; clicking
 * one cell fires only that track. Both are quantized by the transport's
 * quantize setting, and neither touches the arrangement.
 */
export function GridView() {
  const project = useProject((state) => state.project)
  const addScene = useProject((state) => state.addScene)
  const removeScene = useProject((state) => state.removeScene)
  const renameScene = useProject((state) => state.renameScene)
  const moveScene = useProject((state) => state.moveScene)
  const setCell = useProject((state) => state.setCell)

  const overrides = useRuntime((state) => state.overrides)
  const activeScene = useRuntime((state) => state.activeScene)
  const triggerScene = useRuntime((state) => state.triggerScene)
  const triggerCell = useRuntime((state) => state.triggerCell)
  const clearTrack = useRuntime((state) => state.clearTrack)
  const setEditing = useRuntime((state) => state.setEditing)
  const setEditingChain = useRuntime((state) => state.setEditingChain)

  const tracks = useMemo(() => Array.from({ length: project.meta.trackCount }, (_, i) => i + 1), [project.meta.trackCount])
  const refs = useMemo(
    () => [
      ...Object.keys(project.slots).map((id) => ({ id, kind: 'slot' as const })),
      ...Object.keys(project.chains).map((id) => ({ id, kind: 'chain' as const })),
    ],
    [project.slots, project.chains],
  )

  const colorOf = (ref: string) =>
    project.slots[ref]?.color ?? project.slots[project.chains[ref]?.steps[0]?.slot ?? '']?.color ?? '#4a5568'

  const lengthOf = (ref: string) => {
    const timeline = refTimeline(project, ref)
    return timeline.loop
  }

  return (
    <div className="grid-view">
      <div className="grid-scroll">
        <table className="grid" style={{ ['--tracks' as string]: tracks.length }}>
          <thead>
            <tr>
              <th className="scene-head">scenes</th>
              {tracks.map((track) => (
                <th key={track} className="track-head">
                  <span className="track-number">
                    {track}
                    {overrides[track] && (
                      <button
                        className="mini"
                        onClick={() => clearTrack(track)}
                        title="Hand this track back to the arrangement"
                      >
                        ×
                      </button>
                    )}
                  </span>
                  <TrackMix track={track} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {project.grid.scenes.map((scene, index) => (
              <tr key={scene.name}>
                <th className="scene-head">
                  <button
                    className={`scene-trigger ${activeScene === scene.name ? 'playing' : ''}`}
                    onClick={() => triggerScene(index)}
                    title={`Trigger scene "${scene.name}"`}
                  >
                    ▶
                  </button>
                  <CommittedInput
                    value={scene.name}
                    onCommit={(name) => renameScene(index, name)}
                    ariaLabel={`Scene ${index + 1} name`}
                  />
                  {/* Grouped so a narrow screen can drop them onto a second
                      line rather than widening the sticky column. */}
                  <span className="scene-actions">
                    <button
                      className="mini"
                      onClick={() => moveScene(index, index - 1)}
                      disabled={index === 0}
                      aria-label={`Move scene ${scene.name} up`}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      className="mini"
                      onClick={() => moveScene(index, index + 1)}
                      disabled={index === project.grid.scenes.length - 1}
                      aria-label={`Move scene ${scene.name} down`}
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button className="mini" onClick={() => removeScene(index)} title="Delete scene">
                      ×
                    </button>
                  </span>
                </th>
                {tracks.map((track) => {
                  const ref = scene.cells[String(track)]
                  const playing = overrides[track]?.ref === ref && ref !== undefined
                  return (
                    <td key={track} className="cell-wrap">
                      {ref ? (
                        <button
                          className={`cell ${playing ? 'playing' : ''}`}
                          style={{ ['--cell' as string]: colorOf(ref) }}
                          onClick={() => triggerCell(track, ref)}
                          onDoubleClick={() => (project.slots[ref] ? setEditing(ref) : setEditingChain(ref))}
                          title={`${ref} — ${lengthOf(ref)} cycle${lengthOf(ref) === 1 ? '' : 's'}. Click to trigger, double-click to edit.`}
                        >
                          <span className="cell-name">{ref}</span>
                          <span className="cell-len">{formatLength(lengthOf(ref))}</span>
                        </button>
                      ) : (
                        <span className="cell empty" />
                      )}
                      <select
                        className="cell-assign"
                        value={ref ?? ''}
                        onChange={(event) => setCell(index, track, event.target.value || null)}
                        aria-label={`Scene ${scene.name}, track ${track} clip`}
                      >
                        <option value="">—</option>
                        {refs.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.kind === 'chain' ? `⛓ ${option.id}` : option.id}
                          </option>
                        ))}
                      </select>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid-actions">
        <button onClick={() => addScene(nextSceneName(project.grid.scenes.map((scene) => scene.name)))}>+ scene</button>
        <span className="hint keys">
          click a cell to trigger that track · click ▶ to trigger the whole scene · double-click to edit · Esc returns to the
          arrangement
        </span>
      </div>
    </div>
  )
}

function formatLength(cycles: number): string {
  if (cycles === 0) return '—'
  return cycles % 1 === 0 ? `${cycles}c` : `${cycles.toFixed(2)}c`
}

function nextSceneName(taken: string[]): string {
  const used = new Set(taken)
  for (let i = 1; ; i += 1) {
    const candidate = `scene${i}`
    if (!used.has(candidate)) return candidate
  }
}
