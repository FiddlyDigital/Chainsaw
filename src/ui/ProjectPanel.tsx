import { useCallback, useMemo, useState } from 'react'
import { referencesToChain, referencesToSlot } from '../audio/timeline'
import { nextId } from '../model/defaults'
import { useProject } from '../store/project'
import { useRuntime } from '../store/runtime'
import { CommittedInput } from './CommittedInput'

/**
 * Project panel (PRD §8.7): everything in the project, searchable, with a
 * reference check before anything is deleted.
 */
export function ProjectPanel() {
  const project = useProject((state) => state.project)
  const createSlot = useProject((state) => state.createSlot)
  const removeSlot = useProject((state) => state.removeSlot)
  const createChain = useProject((state) => state.createChain)
  const removeChain = useProject((state) => state.removeChain)
  const upsertInstrument = useProject((state) => state.upsertInstrument)
  const removeInstrument = useProject((state) => state.removeInstrument)
  const lastError = useProject((state) => state.lastError)
  const clearError = useProject((state) => state.clearError)

  const setEditing = useRuntime((state) => state.setEditing)
  const setEditingChain = useRuntime((state) => state.setEditingChain)

  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const matching = useCallback((ids: string[]) => ids.filter((id) => id.toLowerCase().includes(needle)).sort(), [needle])

  const slots = useMemo(() => matching(Object.keys(project.slots)), [project.slots, matching])
  const chains = useMemo(() => matching(Object.keys(project.chains)), [project.chains, matching])
  const instruments = useMemo(() => matching(Object.keys(project.instruments)), [project.instruments, matching])

  const deleteSlot = (id: string) => {
    const uses = referencesToSlot(project, id)
    const count = uses.chains.length + uses.scenes.length
    if (count > 0) {
      const where = [
        uses.chains.length ? `${uses.chains.length} chain${uses.chains.length === 1 ? '' : 's'}` : null,
        uses.scenes.length ? `${uses.scenes.length} scene${uses.scenes.length === 1 ? '' : 's'}` : null,
      ]
        .filter(Boolean)
        .join(' and ')
      if (!window.confirm(`Slot ${id} is used in ${where}. Delete anyway?`)) return
    }
    removeSlot(id)
  }

  const deleteChain = (id: string) => {
    const { scenes } = referencesToChain(project, id)
    if (scenes.length > 0) {
      const where = `${scenes.length} scene${scenes.length === 1 ? '' : 's'}`
      if (!window.confirm(`Chain ${id} is used in ${where}. Delete anyway?`)) return
    }
    removeChain(id)
  }

  return (
    <aside className="project-panel">
      <input
        className="search"
        placeholder="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Search project"
      />

      <Section
        title="slots"
        onAdd={() => {
          const id = nextId('A', [...Object.keys(project.slots), ...Object.keys(project.chains)])
          if (createSlot(id)) setEditing(id)
        }}
      >
        {slots.map((id) => {
          const slot = project.slots[id]
          return (
            <li key={id}>
              <button className="entry" onClick={() => setEditing(id)}>
                <span className="swatch" style={{ background: slot.color }} />
                <span className="entry-name">{id}</span>
                {slot.muted && <em>muted</em>}
                <code className="entry-code">{slot.code}</code>
              </button>
              <button className="mini" onClick={() => deleteSlot(id)} aria-label={`Delete slot ${id}`}>
                ×
              </button>
            </li>
          )
        })}
      </Section>

      <Section
        title="chains"
        onAdd={() => {
          const id = nextId('CH', [...Object.keys(project.slots), ...Object.keys(project.chains)])
          if (createChain(id, 1)) setEditingChain(id)
        }}
      >
        {chains.map((id) => (
          <li key={id}>
            <button className="entry" onClick={() => setEditingChain(id)}>
              <span className="entry-name">{id}</span>
              <em>track {project.chains[id].track}</em>
              <code className="entry-code">{project.chains[id].steps.map((step) => step.slot).join(' → ') || 'empty'}</code>
            </button>
            <button className="mini" onClick={() => deleteChain(id)} aria-label={`Delete chain ${id}`}>
              ×
            </button>
          </li>
        ))}
      </Section>

      <Section
        title="instruments"
        onAdd={() => {
          const id = window.prompt('New instrument id', nextId('inst', Object.keys(project.instruments)))
          if (id) upsertInstrument(id, { base: 'sound("triangle")' })
        }}
      >
        {instruments.map((id) => (
          <li key={id}>
            <label className="entry instrument">
              <span className="entry-name">{id}</span>
              <CommittedInput
                value={project.instruments[id].base}
                onCommit={(base) => upsertInstrument(id, { ...project.instruments[id], base })}
                ariaLabel={`Instrument ${id} base expression`}
              />
            </label>
            <button className="mini" onClick={() => removeInstrument(id)} aria-label={`Delete instrument ${id}`}>
              ×
            </button>
          </li>
        ))}
      </Section>

      {lastError && (
        <p className="inline-error" onClick={clearError} role="alert">
          {lastError}
        </p>
      )}
    </aside>
  )
}

function Section({ title, onAdd, children }: { title: string; onAdd: () => void; children: React.ReactNode }) {
  return (
    <section className="panel-section">
      <h3>
        {title}
        <button className="mini" onClick={onAdd} aria-label={`Add ${title.slice(0, -1)}`}>
          +
        </button>
      </h3>
      <ul>{children}</ul>
    </section>
  )
}
