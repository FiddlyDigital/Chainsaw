import type { CodeEditorHandle } from './CodeEditor'

/**
 * The symbol row that sits between the editor and the on-screen keyboard.
 *
 * A phone keyboard puts every character a Strudel pattern is made of behind a
 * layout switch: `s("bd*4, hh*8").gain(0.8)` costs eight round trips to the
 * symbol page and back. These are the characters that are not on the letter
 * page, in roughly the order a pattern needs them, plus the one action worth
 * having within thumb reach — hearing what you just typed.
 *
 * Brackets insert as pairs with the caret between them, and `→` steps over the
 * closer, because a phone has no arrow keys and placing a caret by tapping at
 * it is a coin toss.
 */

interface Key {
  label: string
  /** What to type. Defaults to the label. */
  text?: string
  /** Characters to walk the caret back over afterwards. */
  back?: number
  title: string
}

const KEYS: Key[] = [
  { label: '"', text: '""', back: 1, title: 'A sound or note name' },
  { label: '(', text: '()', back: 1, title: 'Call' },
  { label: '.', title: 'Chain another function' },
  { label: '→', title: 'Step the caret past the next character' },
  { label: '*', title: 'Speed a step up' },
  { label: '/', title: 'Slow a step down' },
  { label: '~', title: 'A rest' },
  { label: ',', title: 'Stack, played at the same time' },
  { label: '[', text: '[]', back: 1, title: 'Subdivide a step' },
  { label: '<', text: '<>', back: 1, title: 'Alternate, one per cycle' },
  { label: '!', title: 'Replicate a step' },
  { label: '@', title: 'Stretch a step over several' },
  { label: ':', title: 'Pick a sample from the bank' },
  { label: '?', title: 'Drop a step at random' },
  { label: '-', title: 'Minus, or a note name' },
]

export interface PatternKeysProps {
  editor: React.RefObject<CodeEditorHandle | null>
  /** Evaluate or commit — whichever this editor calls it. */
  onRun: () => void
  runLabel: string
}

export function PatternKeys({ editor, onRun, runLabel }: PatternKeysProps) {
  return (
    <div className="pattern-keys">
      <div className="pattern-keys-scroll">
        {KEYS.map((key) => (
          <button
            key={key.label}
            className="pattern-key"
            title={key.title}
            aria-label={key.title}
            // The editor must not lose focus, or the keyboard closes between
            // every symbol and the caret is gone by the time we insert.
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              if (key.label === '→') editor.current?.skip()
              else editor.current?.insert(key.text ?? key.label, key.back)
            }}
          >
            {key.label}
          </button>
        ))}
      </div>
      <button className="pattern-run" onPointerDown={(event) => event.preventDefault()} onClick={onRun}>
        {runLabel}
      </button>
    </div>
  )
}
