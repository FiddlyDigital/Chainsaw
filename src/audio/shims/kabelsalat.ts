/**
 * Stub for `@kabelsalat/web`.
 *
 * `@strudel/core`'s `repl.mjs` imports `SalatRepl` at module load so that its
 * REPL can compile kabelsalat DSP code. The published `@kabelsalat/web` bundle
 * is an IIFE that assigns to a global — it exposes no ESM or CJS named exports,
 * so importing anything from `@strudel/core` fails outright under Vite, Vitest
 * and Node alike.
 *
 * Chainsaw never calls Strudel's `repl()`: the scheduler layer drives `Cyclist`
 * directly so it can quantize pattern swaps to bar boundaries (see
 * `audio/engine.ts`). Aliasing the package to this stub unblocks the import and
 * keeps the unused DSP compiler out of the bundle.
 */
export class SalatRepl {
  evaluate(): never {
    throw new Error('kabelsalat DSP is not bundled in Chainsaw')
  }
}

export default { SalatRepl }
