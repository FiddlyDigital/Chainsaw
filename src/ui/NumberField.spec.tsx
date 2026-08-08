import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NumberField } from './NumberField'

/**
 * The field driven the way the app drives it: bound to a value someone else
 * owns, by a store that **rejects** anything outside the bounds and re-renders
 * the old value straight back. That rejection is the whole mechanism being
 * tested — a harness that accepts every value it is handed passes with or
 * without the guard, which is what makes it worth writing out here.
 */
function Bound({
  initial,
  onCommit,
  ...rest
}: {
  initial: number
  onCommit: (n: number) => void
  min: number
  max: number
  integer?: boolean
}) {
  const [value, setValue] = useState(initial)
  return (
    <NumberField
      {...rest}
      value={value}
      ariaLabel="tempo"
      onCommit={(next) => {
        onCommit(next)
        if (next < rest.min || next > rest.max) return // as the store would
        if (rest.integer && !Number.isInteger(next)) return
        setValue(next)
      }}
    />
  )
}

describe('NumberField', () => {
  it('accepts a value whose first digit is out of range', async () => {
    // The whole point. Bounded at 20, "90" arrives as "9" first; anything that
    // pushes that at the store gets it rejected and the keystroke overwritten.
    const commit = vi.fn()
    render(<Bound initial={120} onCommit={commit} min={20} max={400} />)
    const field = screen.getByLabelText('tempo')

    await userEvent.clear(field)
    await userEvent.type(field, '90')

    expect(field).toHaveValue(90)
    expect(commit).toHaveBeenLastCalledWith(90)
  })

  it('says nothing while the field is empty', async () => {
    const commit = vi.fn()
    render(<Bound initial={120} onCommit={commit} min={20} max={400} />)

    await userEvent.clear(screen.getByLabelText('tempo'))

    // Not 0, and not an error either: a field halfway through being retyped is
    // not a mistake to report.
    expect(commit).not.toHaveBeenCalled()
  })

  it('puts the real value back when the field is left invalid', async () => {
    const commit = vi.fn()
    render(
      <>
        <Bound initial={120} onCommit={commit} min={20} max={400} />
        <button>elsewhere</button>
      </>,
    )
    const field = screen.getByLabelText('tempo')

    await userEvent.clear(field)
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }))

    expect(field).toHaveValue(120)
    expect(commit).not.toHaveBeenCalled()
  })

  it('refuses a fraction where the document wants an integer', async () => {
    const commit = vi.fn()
    render(<Bound initial={8} onCommit={commit} min={1} max={32} integer />)

    await userEvent.clear(screen.getByLabelText('tempo'))
    await userEvent.type(screen.getByLabelText('tempo'), '2.5')

    // "2" on the way through is a whole number and commits; "2.5" does not.
    expect(commit).toHaveBeenLastCalledWith(2)
  })

  it('adopts a change made somewhere else while it is not being typed into', () => {
    const { rerender } = render(<NumberField value={120} onCommit={vi.fn()} min={20} max={400} ariaLabel="tempo" />)
    rerender(<NumberField value={140} onCommit={vi.fn()} min={20} max={400} ariaLabel="tempo" />)

    // An undo or a file load has to reach a field nobody is holding.
    expect(screen.getByLabelText('tempo')).toHaveValue(140)
  })
})
