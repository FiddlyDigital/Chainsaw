import { useEffect, useRef, useState } from 'react'

/**
 * A text field that commits on blur or Enter rather than on every keystroke.
 *
 * Everything it is used for — renaming a slot, a chain, a scene, the project —
 * is a store mutation that rewrites references, pushes an undo entry and
 * re-resolves the running pattern. Typing "KICK" into a live-bound field would
 * do all of that four times over, and reject the empty string on the way. This
 * holds the text locally until the edit is finished.
 *
 * `onCommit` returns whether the change was accepted; a rejected one snaps back
 * to the value that is really in the document.
 */
export interface CommittedInputProps {
  value: string
  onCommit: (next: string) => boolean
  className?: string
  ariaLabel: string
  title?: string
}

export function CommittedInput({ value, onCommit, className, ariaLabel, title }: CommittedInputProps) {
  const [draft, setDraft] = useState(value)
  const editing = useRef(false)

  // Adopt an external change (undo, a file load) unless the field is being
  // typed into, where clobbering the caret would be worse.
  useEffect(() => {
    if (!editing.current) setDraft(value)
  }, [value])

  const commit = () => {
    editing.current = false
    if (draft === value) return
    if (!onCommit(draft)) setDraft(value)
  }

  return (
    <input
      className={className}
      value={draft}
      title={title}
      aria-label={ariaLabel}
      onFocus={() => {
        editing.current = true
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
          event.currentTarget.blur()
        }
        if (event.key === 'Escape') {
          editing.current = false
          setDraft(value)
          event.currentTarget.blur()
        }
      }}
    />
  )
}
