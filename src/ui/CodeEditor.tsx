/**
 * The CodeMirror 6 editor used by both the scratch pad and the slot editor.
 *
 * Strudel patterns are JavaScript expressions, so the stock JS language mode
 * gives correct highlighting without pulling in Strudel's own editor package
 * (which brings a second REPL along with it — Chainsaw already has one).
 */
import { javascript } from '@codemirror/lang-javascript'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, placeholder as placeholderExt } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { tags } from '@lezer/highlight'
import { useEffect, useRef } from 'react'

const highlight = HighlightStyle.define([
  { tag: tags.string, color: '#9ae6b4' },
  { tag: tags.number, color: '#f6ad55' },
  { tag: tags.propertyName, color: '#90cdf4' },
  { tag: tags.function(tags.variableName), color: '#d6bcfa' },
  { tag: tags.variableName, color: '#e2e8f0' },
  { tag: tags.comment, color: '#718096', fontStyle: 'italic' },
  { tag: tags.operator, color: '#a0aec0' },
  { tag: tags.punctuation, color: '#a0aec0' },
  { tag: tags.keyword, color: '#f687b3' },
])

const theme = EditorView.theme(
  {
    '&': { fontSize: '13px', backgroundColor: 'transparent', height: '100%' },
    '.cm-content': { fontFamily: 'var(--mono)', caretColor: '#f0f0f0', padding: '8px 0' },
    '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: '#4a5568' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-cursor': { borderLeftColor: '#f0f0f0' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { overflow: 'auto', lineHeight: '1.55' },
    '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(120,150,255,0.3)' },
  },
  { dark: true },
)

export interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  /** Ctrl/Cmd+Enter. Receives the current text so it never races React state. */
  onEvaluate: (value: string) => void
  placeholder?: string
  ariaLabel: string
}

export function CodeEditor({ value, onChange, onEvaluate, placeholder, ariaLabel }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(null)
  // Kept in refs so the editor is created once and never loses undo history.
  const change = useRef(onChange)
  const evaluate = useRef(onEvaluate)
  useEffect(() => {
    change.current = onChange
    evaluate.current = onEvaluate
  }, [onChange, onEvaluate])

  useEffect(() => {
    if (!host.current) return
    const instance = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([
            {
              key: 'Mod-Enter',
              preventDefault: true,
              run: (target) => {
                evaluate.current(target.state.doc.toString())
                return true
              },
            },
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          javascript(),
          syntaxHighlighting(highlight),
          theme,
          EditorView.lineWrapping,
          placeholder ? placeholderExt(placeholder) : [],
          EditorView.updateListener.of((update) => {
            if (update.docChanged) change.current(update.state.doc.toString())
          }),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
        ],
      }),
    })
    view.current = instance
    return () => {
      instance.destroy()
      view.current = null
    }
    // The editor owns its document after creation; `value` is synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ariaLabel, placeholder])

  // Adopt an externally changed document (switching slots, undo, loading a file)
  // without disturbing the cursor when the text already matches.
  useEffect(() => {
    const instance = view.current
    if (!instance) return
    const current = instance.state.doc.toString()
    if (current === value) return
    instance.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  return <div className="code-editor" ref={host} />
}
