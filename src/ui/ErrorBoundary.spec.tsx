import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

/**
 * React logs every caught render error to the console itself, on top of what
 * the boundary logs. Silenced so a passing run stays readable — and restored,
 * so a genuine error in another test still shows.
 */
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

function Boom({ throwing }: { throwing: boolean }) {
  if (throwing) throw new Error('slot D1 has no colour')
  return <p>the grid</p>
}

describe('ErrorBoundary', () => {
  it('is invisible while nothing is wrong', () => {
    render(
      <ErrorBoundary where="grid">
        <Boom throwing={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('the grid')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('names what stopped drawing, and why', () => {
    render(
      <ErrorBoundary where="grid">
        <Boom throwing />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('the grid stopped drawing')
    // The message is the only clue anyone gets without a console open.
    expect(screen.getByRole('alert')).toHaveTextContent('slot D1 has no colour')
  })

  it('says the set is still running, because it is', () => {
    render(
      <ErrorBoundary where="grid">
        <Boom throwing />
      </ErrorBoundary>,
    )
    // The Engine is not in the React tree, so a render failure is not a stop.
    expect(screen.getByRole('alert')).toHaveTextContent(/audio runs outside the interface/i)
    expect(screen.getByRole('button', { name: 'stop the audio' })).toBeInTheDocument()
  })

  it('redraws when the cause has gone away', async () => {
    function Flaky() {
      const [throwing, setThrowing] = useState(true)
      return (
        <>
          <button onClick={() => setThrowing(false)}>fix it</button>
          <ErrorBoundary where="grid">
            <Boom throwing={throwing} />
          </ErrorBoundary>
        </>
      )
    }
    render(<Flaky />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'fix it' }))
    await userEvent.click(screen.getByRole('button', { name: 'try again' }))

    expect(screen.getByText('the grid')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the failure to the pane it happened in', () => {
    render(
      <div>
        <p>transport</p>
        <ErrorBoundary where="editor">
          <Boom throwing />
        </ErrorBoundary>
        <ErrorBoundary where="grid">
          <Boom throwing={false} />
        </ErrorBoundary>
      </div>,
    )

    expect(screen.getByText('transport')).toBeInTheDocument()
    expect(screen.getByText('the grid')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('the editor stopped drawing')
  })
})
