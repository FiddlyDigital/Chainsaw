/// <reference types="vite/client" />

// Strudel ships no type declarations. Its surface is used through the thin
// wrappers in `src/audio/`, which give the parts Chainsaw depends on real
// types (see `StrudelPattern` in `audio/patterns.ts`).
declare module '@strudel/core'
declare module '@strudel/core/*'
declare module '@strudel/mini'
declare module '@strudel/tonal'
declare module '@strudel/transpiler'
declare module '@strudel/webaudio'
