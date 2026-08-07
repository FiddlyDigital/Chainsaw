import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * These drive the built app in a real browser with a real AudioContext.
 *
 * The strongest available signal that sound is actually being made headlessly
 * is that the transport advances while superdough reports nothing: a sound it
 * cannot resolve throws `sound X not found`, and a bad pattern logs an eval
 * error. So every test collects console errors and asserts they stay empty.
 */
function watchConsole(page: Page): string[] {
  const problems: string[] = []
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error' || /not found|error/i.test(message.text())) {
      problems.push(message.text())
    }
  })
  page.on('pageerror', (error) => problems.push(String(error)))
  return problems
}

/** The transport's cycle readout, as a number. */
async function cycle(page: Page): Promise<number> {
  const text = await page.locator('.counter-cycle').textContent()
  return Number((text ?? '').replace('cyc', '').trim())
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear())
})

test('boots on the demo project with its grid and arrangement', async ({ page }) => {
  const problems = watchConsole(page)
  await page.goto('.')

  await expect(page.locator('.transport')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  // Demo slots and chains are listed in the project panel.
  await expect(page.locator('.project-panel')).toContainText('A1')
  await expect(page.locator('.project-panel')).toContainText('DRUMS_A')
  // Three scenes across eight tracks.
  await expect(page.locator('.grid tbody tr')).toHaveCount(3)
  await expect(page.locator('.grid thead .track-head')).toHaveCount(8)

  expect(problems).toEqual([])
})

test('plays: the transport advances and no sound fails to resolve', async ({ page }) => {
  const problems = watchConsole(page)
  await page.goto('.')

  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()

  // The audio context is live, not suspended.
  await expect(page.locator('.tabs')).not.toContainText('press play to start audio')

  const first = await cycle(page)
  await expect.poll(() => cycle(page), { timeout: 10_000 }).toBeGreaterThan(first + 1)

  await page.getByRole('button', { name: 'Pause' }).click()
  expect(problems).toEqual([])
})

test('triggering a scene overrides the arrangement, and Esc gives it back', async ({ page }) => {
  const problems = watchConsole(page)
  await page.goto('.')
  await page.getByRole('button', { name: 'Play' }).click()

  // Scene names live in editable inputs, so select by row: the demo's scenes
  // are intro, drop, break.
  const drop = page.locator('.grid tbody tr').nth(1)
  await expect(drop.getByLabel('Scene 2 name')).toHaveValue('drop')
  await drop.locator('.scene-trigger').click()
  await expect(page.locator('.pill.live')).toContainText('drop')
  // The overridden tracks are marked in the arrangement too.
  await page.locator('.tabs').getByRole('button', { name: 'arrangement' }).click()
  await expect(page.locator('.track-row.overridden')).not.toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(page.locator('.pill.live')).toHaveCount(0)
  await expect(page.locator('.track-row.overridden')).toHaveCount(0)

  expect(problems).toEqual([])
})

test('a live code edit reaches playback without stopping the transport', async ({ page }) => {
  const problems = watchConsole(page)
  await page.goto('.')
  await page.getByRole('button', { name: 'Play' }).click()

  await page.locator('.project-panel .entry', { hasText: 'A1' }).first().click()
  await expect(page.locator('.editor-head')).toContainText('slot')

  const editor = page.locator('.code-editor .cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('s("bd*8").gain(0.7)')
  await page.keyboard.press('ControlOrMeta+Enter')

  // The change is queued for a boundary rather than applied mid-bar…
  await expect(page.locator('.pill.pending')).toBeVisible()
  // …and the transport never stops.
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  // …and it lands.
  await expect(page.locator('.pill.pending')).toHaveCount(0, { timeout: 15_000 })
  await expect(page.locator('.project-panel')).toContainText('s("bd*8").gain(0.7)')

  expect(problems).toEqual([])
})

test('the scratch pad evaluates and starts playing, like the stock REPL', async ({ page }) => {
  const problems = watchConsole(page)
  await page.goto('.')

  const editor = page.locator('.code-editor .cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('s("hh*4").gain(0.5)')
  await page.keyboard.press('ControlOrMeta+Enter')

  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  await expect(page.locator('.inline-error')).toHaveCount(0)
  expect(problems).toEqual([])
})

test('the scratch pad plays alongside the tracks, and can be muted or soloed', async ({ page }) => {
  const problems = watchConsole(page)
  await page.goto('.')
  await page.getByRole('button', { name: 'Play' }).click()

  // Fire a scene so there is something for the scratch to play against.
  await page.locator('.grid tbody tr').nth(1).locator('.scene-trigger').click()
  await expect(page.locator('.pill.live')).toContainText('drop')

  const editor = page.locator('.code-editor .cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('s("cp*2").gain(0.4)')
  await page.keyboard.press('ControlOrMeta+Enter')

  // Both layers are in the mix: the scratch is announced and the scene it is
  // playing over is still live. Neither displaced the other.
  await expect(page.locator('.pill.scratch')).toHaveText('scratch')
  await expect(page.locator('.pill.live')).toContainText('drop')
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()

  // The pill says "scratch solo" too, so reach for the strip, not the readout.
  const strip = page.locator('.editor-panel .editor-head')
  const solo = strip.getByRole('button', { name: 'solo' })
  const mute = strip.getByRole('button', { name: 'mute' })

  // Soloing takes the tracks out without disturbing the scene…
  await solo.click()
  await expect(page.locator('.pill.scratch')).toHaveText('scratch solo')
  await expect(page.locator('.pill.live')).toContainText('drop')
  // …and comes back off.
  await solo.click()
  await expect(page.locator('.pill.scratch')).toHaveText('scratch')

  // Muting keeps the pattern; the transport never stops for any of it.
  await mute.click()
  await expect(page.locator('.pill.scratch')).toHaveCount(0)
  await mute.click()
  await expect(page.locator('.pill.scratch')).toHaveText('scratch')

  // The transport's pill is the way out from anywhere else in the app.
  await page.locator('.pill.scratch').click()
  await expect(page.locator('.pill.scratch')).toHaveCount(0)

  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  const first = await cycle(page)
  await expect.poll(() => cycle(page), { timeout: 10_000 }).toBeGreaterThan(first + 1)
  expect(problems).toEqual([])
})

test('tracks can be muted and soloed, and it survives a save', async ({ page }) => {
  const problems = watchConsole(page)
  await page.goto('.')
  await page.getByRole('button', { name: 'Play' }).click()

  const head = page.locator('.grid thead .track-head')
  await head.nth(0).getByRole('button', { name: 'Mute track 1' }).click()
  await expect(head.nth(0).getByRole('button', { name: 'Unmute track 1' })).toHaveClass(/muted/)

  // Soloing another track is a separate state; the mute stays put.
  await head.nth(2).getByRole('button', { name: 'Solo track 3' }).click()
  await expect(head.nth(2).getByRole('button', { name: 'Unsolo track 3' })).toHaveClass(/soloed/)
  await expect(head.nth(0).getByRole('button', { name: 'Unmute track 1' })).toHaveClass(/muted/)

  // The arrangement lists the same tracks and shows the same state.
  await page.locator('.tabs').getByRole('button', { name: 'arrangement' }).click()
  await expect(page.locator('.track-row').nth(0).getByRole('button', { name: 'Unmute track 1' })).toHaveClass(/muted/)
  await expect(page.locator('.track-row').nth(2).getByRole('button', { name: 'Unsolo track 3' })).toHaveClass(/soloed/)

  // None of it stopped the transport.
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  const first = await cycle(page)
  await expect.poll(() => cycle(page), { timeout: 10_000 }).toBeGreaterThan(first + 1)

  // It is document state, not runtime state, so it is in what gets persisted.
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('chainsaw.autosave.v1') ?? '{}').tracks), {
      timeout: 5_000,
    })
    .toEqual({ '1': { muted: true }, '3': { soloed: true } })

  expect(problems).toEqual([])
})

test('bad code is reported inline and does not take the transport down', async ({ page }) => {
  await page.goto('.')
  await page.getByRole('button', { name: 'Play' }).click()

  const editor = page.locator('.code-editor .cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('s("bd"')
  await page.keyboard.press('ControlOrMeta+Enter')

  await expect(page.locator('.editor-panel .inline-error')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
})

test('an overlapping placement is refused with a message, not silently dropped', async ({ page }) => {
  await page.goto('.')
  await page.locator('.tabs').getByRole('button', { name: 'arrangement' }).click()

  // Track 5 is empty in the demo, and DRUMS_A is four cycles — four bars at 26px
  // each. Place it at bar 5 (x=110), then again at bar 3 (x=60, still empty
  // lane) so the second runs from bar 3 to bar 7 and collides with the first.
  await page.locator('.chip', { hasText: 'DRUMS_A' }).click()
  const lane = page.locator('.track-row').nth(4).locator('.lane')
  await lane.click({ position: { x: 110, y: 10 } })
  await expect(lane.locator('.block')).toHaveCount(1)

  await lane.click({ position: { x: 60, y: 10 } })

  await expect(page.locator('.arrangement .inline-error')).toContainText('overlap')
  // Rejected whole: the first placement is untouched and no second appeared.
  await expect(lane.locator('.block')).toHaveCount(1)
})

test('the grid and the arrangement follow the track count', async ({ page }) => {
  await page.goto('.')
  await expect(page.locator('.grid thead .track-head')).toHaveCount(8)

  await page.getByLabel('tracks').fill('16')
  await expect(page.locator('.grid thead .track-head')).toHaveCount(16)
  await page.locator('.tabs').getByRole('button', { name: 'arrangement' }).click()
  await expect(page.locator('.track-row')).toHaveCount(16)

  // Shrinking discards data above the bound, so it asks first.
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByLabel('tracks').fill('2')
  await expect(page.locator('.track-row')).toHaveCount(2)
})

test('the project round-trips through a save', async ({ page }) => {
  // Exercise the download fallback — the path Firefox and Safari take, and the
  // only one a headless browser can complete, since the File System Access
  // picker needs a human.
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker
  })
  await page.goto('.')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'save as' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('first-light.chainsaw.json')

  const stream = await file.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const saved = JSON.parse(Buffer.concat(chunks).toString())
  expect(saved.meta.name).toBe('first light')
  expect(Object.keys(saved.slots)).toContain('A1')
  expect(saved.arrangement.tracks['1']).toHaveLength(2)
})

test('installs a service worker and still runs with the network cut', async ({ page, context }) => {
  await page.goto('.')
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 20_000 })

  await context.setOffline(true)
  await page.reload()

  await expect(page.locator('.transport')).toBeVisible()
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()

  const first = await cycle(page)
  await expect.poll(() => cycle(page), { timeout: 10_000 }).toBeGreaterThan(first + 1)
  await context.setOffline(false)
})
