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
