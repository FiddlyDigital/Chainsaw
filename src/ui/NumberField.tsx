import { useEffect, useRef, useState } from 'react'
import { parseNumberField } from './number'

/**
 * A number field that only ever hands the store a number the store will take.
 *
 * The obvious version — `value={bpm}` with `onChange={setBpm(Number(...))}` —
 * is broken for any value whose *prefix* is out of range, which is most of
 * them. Typing 90 into a field bounded at 20 sends 9 first; the store rejects
 * it, React re-renders the old value straight back over the keystroke, and the
 * field is unusable for exactly the values it was bounded to allow. Clearing it
 * is worse: an empty string reads as 0, and every keystroke raises an error the
 * performer did not make.
 *
 * So the draft lives here as text. It is committed only when it parses inside
 * the bounds, and a draft that never becomes valid snaps back when the field is
 * left — the same contract as `CommittedInput`, for the same reason.
 */
export interface NumberFieldProps {
  value: number
  onCommit: (next: number) => void
  min: number
  max: number
  /** Reject a fractional draft, for the fields the schema types as integers. */
  integer?: boolean
  step?: number
  className?: string
  ariaLabel?: string
  title?: string
}

export function NumberField({ value, onCommit, min, max, integer, step, className, ariaLabel, title }: NumberFieldProps) {
  const [draft, setDraft] = useState(String(value))
  const editing = useRef(false)

  // An undo, a file load or a rejected sibling edit changes the real value;
  // adopt it unless the field is being typed into.
  useEffect(() => {
    if (!editing.current) setDraft(String(value))
  }, [value])

  const revert = () => {
    editing.current = false
    setDraft(String(value))
  }

  return (
    <input
      type="number"
      className={className}
      value={draft}
      min={min}
      max={max}
      step={step}
      title={title}
      aria-label={ariaLabel}
      onFocus={() => {
        editing.current = true
      }}
      onChange={(event) => {
        setDraft(event.target.value)
        // Committed as it is typed, so holding the stepper still feels live —
        // but only once what has been typed is a number this field may hold.
        const next = parseNumberField(event.target.value, min, max, integer)
        if (next !== null && next !== value) onCommit(next)
      }}
      onBlur={revert}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          revert()
          event.currentTarget.blur()
        }
      }}
    />
  )
}
