import '@testing-library/jest-dom/vitest'

// jsdom has no Web Audio and no rAF pacing worth simulating. Tests that reach
// the Engine stub these; the pure layers (timeline, timing, patterns, store)
// need neither.
if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16) as unknown as number) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = ((handle: number) => clearTimeout(handle)) as typeof cancelAnimationFrame
}
