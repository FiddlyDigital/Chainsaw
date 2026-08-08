import { chainTimeline } from '../audio/timeline'
import { slotCycles } from '../audio/timing'
import { useProject } from '../store/project'
import { useRuntime } from '../store/runtime'
import { CommittedInput } from './CommittedInput'
import { NumberField } from './NumberField'

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
          <NumberField
            min={1}
            max={project.meta.trackCount}
            integer
            value={chain.track}
            onCommit={(track) => updateChain(chainId, { track })}
          />
        </label>
        <span className="hint">{total} cycles total</span>
        <div className="spacer" />
        <button onClick={() => setEditingChain(null)}>close</button>
      </header>

      {/* Seven columns of steppers do not fit a phone; scroll them sideways
          rather than letting the table push the whole layout wide. */}
      <div className="steps-scroll">
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
                    <select
                      value={step.slot}
                      onChange={(event) => updateChainStep(chainId, index, { slot: event.target.value })}
                    >
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
                    <NumberField
                      className="tiny"
                      step={0.05}
                      min={-1}
                      max={1}
                      value={step.gainOffset}
                      onCommit={(gainOffset) => updateChainStep(chainId, index, { gainOffset })}
                      ariaLabel={`Gain offset for step ${index}`}
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
                    <button
                      className="mini"
                      onClick={() => removeChainStep(chainId, index)}
                      aria-label={`Remove step ${index}`}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

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
      <NumberField className="tiny" min={min} max={max} integer value={value} onCommit={onChange} ariaLabel={label} />
      <button className="mini" onClick={() => onChange(clamp(value + 1))} aria-label={`${label} up`}>
        +
      </button>
    </span>
  )
}
