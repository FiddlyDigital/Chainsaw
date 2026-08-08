/**
 * The last thing between a render bug and a dead screen.
 *
 * React unmounts the whole tree when a render throws, which on stage means the
 * app vanishes. The audio does not: the Engine and the scheduler live outside
 * React entirely, so whatever was playing when the render failed is still
 * playing. That is the fact this component exists to act on — it keeps the
 * failure to the part that broke, says the set is still running, and offers the
 * two things worth having at that moment: stop the sound, or reload.
 *
 * Boundaries are placed per pane as well as around the app, so a broken editor
 * costs the editor rather than the transport.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useRuntime } from '../store/runtime'

export interface ErrorBoundaryProps {
  children: ReactNode
  /** What this boundary is protecting, named for the message. */
  where: string
  /** Rendered instead of the default panel, for a boundary inside a small box. */
  compact?: boolean
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The stack is the only copy of where this came from — the UI shows the
    // message, but a component stack is what makes it findable.
    console.error(`[chainsaw ${this.props.where}]`, error, info.componentStack)
  }

  private retry = () => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <section className={`crash ${this.props.compact ? 'compact' : ''}`} role="alert">
        <h2>the {this.props.where} stopped drawing</h2>
        <p className="crash-message">{error.message || String(error)}</p>
        <p className="hint">
          The audio runs outside the interface, so anything that was playing still is. Try again to redraw this part; reload if
          it keeps failing.
        </p>
        <div className="crash-actions">
          <button onClick={this.retry}>try again</button>
          <button
            onClick={() => {
              // Not through the boundary's own tree, which is the part that is
              // broken: the store is reachable whatever React is doing.
              useRuntime.getState().stop()
            }}
          >
            stop the audio
          </button>
          <button onClick={() => window.location.reload()}>reload</button>
        </div>
      </section>
    )
  }
}
