import { chainTimeline } from '../audio/timeline'
import { slotCycles } from '../audio/timing'
import { useProject } from '../store/project'
import { useRuntime } from '../store/runtime'
import { CommittedInput } from './CommittedInput'

/**
 * Chain editor (PRD §8.4): a chain's steps as a table, with LSDJ-style inline
 * increments for repeat and transpose, and drag-free reordering (↑/↓) so it
 * stays usable from the keyboard mid-set.
 */
export function ChainEditor() {
  const chainId = useRuntime((state) => state.editingChain)
  const setEditingChain = useRuntime((state) => state.setEditingChain)
  const setEditing = useRuntime((state) => state.setEditing)
  const project = useProject((state) => state.project)
  const addChainStep = useProject((state) => state.addChainStep)
  const updateChainStep = useProject((state) => state.updateChainStep)
  const removeChainStep = useProject((state) => state.removeChainStep)
  const moveChainStep = useProject((state) => state.moveChainStep)
  const updateChain = useProject((state) => state.updateChain)
  const renameChain = useProject((state) => state.renameChain)

  if (!chainId) return null
  const chain = project.chains[chainId]
  if (!chain) return null

  const slotIds = Object.keys(project.slots)
  const total = chainTimeline(project, chainId).loop

  return (
    <section className="chain-editor">
      <header className="editor-head">
        <h2>
          chain
          <CommittedInput
            className="id-input"
            value={chainId}
            onCommit={(next) => {
              if (!renameChain(chainId, next)) return false
              setEditingChain(next)
              return true
            }}
            ariaLabel="Chain id"
          />
        </h2>
        <label className="field">
          <span>track</span>
          <input
            type="number"
            min={1}
            max={project.meta.trackCount}
            value={chain.track}
            onChange={(event) => updateChain(chainId, { track: Number(event.target.value) })}
          />
        </label>
        <span className="hint">{total} cycles total</span>
        <div className="spacer" />
        <button onClick={() => setEditingChain(null)}>close</button>
      </header>

      <table className="steps">
        <thead>
          <tr>
            <th>#</th>
            <th>slot</th>
            <th>repeat</th>
            <th>transpose</th>
            <th>gain</th>
            <th>cycles</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {chain.steps.map((step, index) => {
            const slot = project.slots[step.slot]
            return (
              <tr key={index}>
                <td className="num">{index}</td>
                <td>
                  <select value={step.slot} onChange={(event) => updateChainStep(chainId, index, { slot: event.target.value })}>
                    {slotIds.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                  <button className="mini" onClick={() => setEditing(step.slot)} title="Edit this slot's code">
                    ✎
                  </button>
                </td>
                <td>
                  <Stepper
                    value={step.repeat}
                    min={1}
                    max={64}
                    onChange={(repeat) => updateChainStep(chainId, index, { repeat })}
                    label={`Repeat for step ${index}`}
                  />
                </td>
                <td>
                  <Stepper
                    value={step.transpose}
                    min={-48}
                    max={48}
                    onChange={(transpose) => updateChainStep(chainId, index, { transpose })}
                    label={`Transpose for step ${index}`}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className="tiny"
                    step={0.05}
                    min={-1}
                    max={1}
                    value={step.gainOffset}
                    onChange={(event) => updateChainStep(chainId, index, { gainOffset: Number(event.target.value) })}
                    aria-label={`Gain offset for step ${index}`}
                  />
                </td>
                <td className="num">{slot ? (slotCycles(slot) * step.repeat).toFixed(2) : '—'}</td>
                <td className="row-actions">
                  <button className="mini" onClick={() => moveChainStep(chainId, index, index - 1)} disabled={index === 0}>
                    ↑
                  </button>
                  <button
                    className="mini"
                    onClick={() => moveChainStep(chainId, index, index + 1)}
                    disabled={index === chain.steps.length - 1}
                  >
                    ↓
                  </button>
                  <button className="mini" onClick={() => removeChainStep(chainId, index)} aria-label={`Remove step ${index}`}>
                    ×
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="editor-actions">
        <button
          disabled={slotIds.length === 0}
          onClick={() =>
            addChainStep(chainId, {
              slot: chain.steps[chain.steps.length - 1]?.slot ?? slotIds[0],
              repeat: 1,
              transpose: 0,
              gainOffset: 0,
            })
          }
        >
          + step
        </button>
        {slotIds.length === 0 && <span className="hint">make a slot first</span>}
      </div>
    </section>
  )
}

function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  label: string
}) {
  const clamp = (next: number) => Math.max(min, Math.min(max, next))
  return (
    <span className="stepper">
      <button className="mini" onClick={() => onChange(clamp(value - 1))} aria-label={`${label} down`}>
        −
      </button>
      <input
        type="number"
        className="tiny"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(clamp(Number(event.target.value)))}
        aria-label={label}
      />
      <button className="mini" onClick={() => onChange(clamp(value + 1))} aria-label={`${label} up`}>
        +
      </button>
    </span>
  )
}
