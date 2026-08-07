import { expect, test, type Page } from '@playwright/test'

/**
 * MIDI clock out, driven against a stubbed output port.
 *
 * There is no virtual MIDI device in a headless browser, so the port is
 * replaced with one that records what it was sent. That still exercises
 * everything that can be wrong on this path — the picker, the store, the
 * engine's transport hooks, and the bytes themselves — and it is the only way
 * to assert that pressing play actually puts a Start on the wire.
 */

const CLOCK = 0xf8
const START = 0xfa
const CONTINUE = 0xfb
const STOP = 0xfc
const SONG_POSITION = 0xf2

/** Replace Web MIDI with a single fake output that records every send. */
async function stubMidi(page: Page) {
  await page.addInitScript(() => {
    const sent: number[][] = []
    ;(window as unknown as { __midiSent: number[][] }).__midiSent = sent
    const output = {
      id: 'fake-out',
      name: 'Fake Output',
      send: (data: number[] | Uint8Array) => void sent.push([...data]),
    }
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      writable: true,
      value: async () => ({
        outputs: new Map([[output.id, output]]),
        addEventListener() {},
        removeEventListener() {},
      }),
    })
  })
}

const sent = (page: Page) => page.evaluate(() => (window as unknown as { __midiSent: number[][] }).__midiSent)
const statuses = async (page: Page) => (await sent(page)).map((message) => message[0])

async function clearSent(page: Page) {
  await page.evaluate(() => void ((window as unknown as { __midiSent: number[][] }).__midiSent.length = 0))
}

/** Pick the stubbed output from the transport's MIDI selector. */
async function selectFakeOutput(page: Page) {
  const picker = page.getByTitle('Send MIDI clock, start/stop and song position to this output')
  await picker.selectOption('__enable__')
  await expect(picker.locator('option', { hasText: 'Fake Output' })).toHaveCount(1)
  await picker.selectOption({ label: 'Fake Output' })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear())
  await stubMidi(page)
})

test('sends nothing until an output is chosen', async ({ page }) => {
  await page.goto('.')
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  await page.waitForTimeout(600)

  // Playing with the clock off is silent on the wire.
  expect(await sent(page)).toEqual([])
})

test('starts, clocks and stops with the transport', async ({ page }) => {
  await page.goto('.')
  await selectFakeOutput(page)
  await clearSent(page)

  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()

  // From the top of the song it is a bare Start, not a Continue.
  await expect.poll(() => statuses(page), { timeout: 5_000 }).toContain(START)
  expect((await statuses(page))[0]).toBe(START)

  // …followed by a steady stream of clock ticks.
  await expect
    .poll(async () => (await statuses(page)).filter((status) => status === CLOCK).length, { timeout: 5_000 })
    .toBeGreaterThan(24)

  await page.getByRole('button', { name: 'Pause' }).click()
  await expect.poll(() => statuses(page), { timeout: 5_000 }).toContain(STOP)

  // Nothing keeps ticking after the stop.
  const afterStop = (await statuses(page)).length
  await page.waitForTimeout(400)
  expect((await statuses(page)).length).toBe(afterStop)
})

test('clocks at 24 per quarter note, at the project tempo', async ({ page }) => {
  await page.goto('.')
  await selectFakeOutput(page)

  // The demo runs at 120bpm: two quarter notes a second, 48 clock ticks.
  await page.getByRole('button', { name: 'Play' }).click()
  await expect.poll(() => statuses(page), { timeout: 5_000 }).toContain(CLOCK)

  const count = async () => (await statuses(page)).filter((status) => status === CLOCK).length
  const before = await count()
  await page.waitForTimeout(2_000)
  const rate = ((await count()) - before) / 2

  // Wide enough for scheduling jitter and the queue-ahead window, tight enough
  // that being out by a factor of two — the way this goes wrong — fails.
  expect(rate).toBeGreaterThan(36)
  expect(rate).toBeLessThan(62)
})

test('resumes mid-song with a song position and a continue', async ({ page }) => {
  await page.goto('.')
  await selectFakeOutput(page)

  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: 'Pause' }).click()
  await clearSent(page)

  await page.getByRole('button', { name: 'Play' }).click()
  await expect.poll(() => statuses(page), { timeout: 5_000 }).toContain(CONTINUE)

  const messages = await sent(page)
  const position = messages.find((message) => message[0] === SONG_POSITION)
  // A receiver told to Continue without being told where would play from bar 1.
  expect(position).toBeDefined()
  expect(messages.indexOf(position!)).toBeLessThan(messages.findIndex((m) => m[0] === CONTINUE))
  // Two 7-bit data bytes.
  expect(position!.slice(1)).toHaveLength(2)
  expect(position!.slice(1).every((byte) => byte >= 0 && byte <= 0x7f)).toBe(true)
  expect(statuses(page)).resolves.not.toContain(START)
})

test('stopping from the top sends Start again, not Continue', async ({ page }) => {
  await page.goto('.')
  await selectFakeOutput(page)

  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: 'Stop' }).click()
  await clearSent(page)

  await page.getByRole('button', { name: 'Play' }).click()
  await expect.poll(() => statuses(page), { timeout: 5_000 }).toContain(START)
  expect(await statuses(page)).not.toContain(CONTINUE)
})

test('turning the output back off stops the clock without stopping the audio', async ({ page }) => {
  await page.goto('.')
  await selectFakeOutput(page)
  await page.getByRole('button', { name: 'Play' }).click()
  await expect.poll(() => statuses(page), { timeout: 5_000 }).toContain(CLOCK)

  await page.getByTitle('Send MIDI clock, start/stop and song position to this output').selectOption('')
  await clearSent(page)
  await page.waitForTimeout(400)

  expect(await sent(page)).toEqual([])
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
})
