import { expect, test, type Page } from '@playwright/test'

/**
 * The narrow layout, driven at a phone's size with touch input.
 *
 * The grid is the screen here: it is the song, and a phone has room for one
 * thing. The project panel and the editor come over it as sheets and go away
 * again. The interesting property is not that it looks right — it is that
 * nothing ends up unreachable: the grid never disappears, a sheet can always
 * be got rid of, and every gesture the desktop does with a hover or a keyboard
 * shortcut is available some other way.
 */

const PHONE = { width: 390, height: 844 }

test.use({ viewport: PHONE, hasTouch: true, isMobile: true })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear())
})

/** How far the widest thing on the page sticks out past the viewport. */
async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

const dockButton = (page: Page, name: 'project' | 'editor') =>
  page.locator('.dock button').nth(['project', 'editor'].indexOf(name))

test('keeps the grid on screen and brings the panels over it', async ({ page }) => {
  await page.goto('.')

  // Nothing over it to start with: the set is what you see.
  await expect(page.locator('.dock')).toBeVisible()
  await expect(page.locator('.grid')).toBeVisible()
  await expect(page.locator('.project-panel')).toBeHidden()
  await expect(page.locator('.editor-panel')).toBeHidden()

  await dockButton(page, 'project').tap()
  await expect(page.locator('.project-panel')).toBeVisible()
  // The point of the whole arrangement: the grid is still there behind it.
  await expect(page.locator('.grid')).toBeVisible()
  await expect(page.locator('.grid .cell').first()).toBeVisible()

  // One panel at a time, or the second would be behind the first.
  await dockButton(page, 'editor').tap()
  await expect(page.locator('.editor-panel')).toBeVisible()
  await expect(page.locator('.project-panel')).toBeHidden()
})

test('a sheet goes away three ways: the dock, the handle and the grid behind it', async ({ page }) => {
  await page.goto('.')

  // The button that opened it closes it again.
  await dockButton(page, 'project').tap()
  await expect(page.locator('.project-panel')).toBeVisible()
  await dockButton(page, 'project').tap()
  await expect(page.locator('.project-panel')).toBeHidden()

  // The grab handle, which is where a thumb goes to pull a sheet down.
  await dockButton(page, 'project').tap()
  await page.locator('.sheet-project .sheet-handle').tap()
  await expect(page.locator('.project-panel')).toBeHidden()

  // And tapping the grid behind it, which is the gesture people try first —
  // and the fastest way back to the clips.
  await dockButton(page, 'editor').tap()
  await expect(page.locator('.editor-panel')).toBeVisible()
  // Aimed near the top, where the grid is actually showing. The scrim spans
  // the whole body deliberately — that is what swallows a stray tap while the
  // sheet is still travelling — but the sheet then sits on top of most of it
  // and takes its own taps. So the centre, where a tap lands by default, is a
  // point no thumb can reach either, and aiming there was a race: it only
  // worked if the tap beat the sheet to the middle of the screen.
  await page.locator('.scrim').tap({ position: { x: 40, y: 20 } })
  await expect(page.locator('.editor-panel')).toBeHidden()
})

test('a closed sheet is out of reach of the keyboard and the screen reader', async ({ page }) => {
  await page.goto('.')

  // `visibility: hidden` rather than merely off-screen, so a closed panel is
  // not something you can tab into or something that gets read out.
  await expect(page.locator('.project-panel')).toBeHidden()
  await expect(page.locator('.sheet-project .sheet-handle')).toBeHidden()
  await expect(page.getByPlaceholder('search')).toBeHidden()
})

test('nothing overflows sideways, with any panel open', async ({ page }) => {
  await page.goto('.')
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  await dockButton(page, 'project').tap()
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  await dockButton(page, 'editor').tap()
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  // …including with the transport's tray of controls open.
  await page.locator('.transport-toggle').tap()
  await expect(page.getByLabel('tracks')).toBeVisible()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
})

test('the transport keeps play and position; the rest folds into a tray', async ({ page }) => {
  await page.goto('.')

  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  await expect(page.locator('.counter-bar')).toBeVisible()
  // Everything else starts collapsed, so the transport is one row deep.
  await expect(page.getByRole('button', { name: 'save as' })).toBeHidden()
  await expect(page.getByLabel('tracks')).toBeHidden()

  await page.locator('.transport-toggle').tap()
  await expect(page.getByRole('button', { name: 'save as' })).toBeVisible()
  await expect(page.getByLabel('Master volume')).toBeVisible()

  await page.locator('.transport-toggle').tap()
  await expect(page.getByRole('button', { name: 'save as' })).toBeHidden()
})

test('opening something for editing brings its panel over the grid', async ({ page }) => {
  await page.goto('.')

  await dockButton(page, 'project').tap()
  await page.locator('.project-panel .entry', { hasText: 'A1' }).first().tap()

  // A slot swaps the project sheet for the editor…
  await expect(page.locator('.editor-panel')).toBeVisible()
  await expect(page.locator('.editor-head')).toContainText('slot')
  await expect(page.locator('.project-panel')).toBeHidden()
  // …and CodeMirror measured itself on the way out of hiding, rather than
  // coming up as a zero-height box.
  const editor = page.locator('.code-editor .cm-content')
  expect((await editor.boundingBox())?.height ?? 0).toBeGreaterThan(20)
  // The dock says what is open, so it is still findable once it is closed.
  await expect(dockButton(page, 'editor')).toContainText('slot A1')

  // …a chain gets the grid to itself: its editor lives there, so a sheet over
  // the grid would be in front of it.
  await dockButton(page, 'project').tap()
  await page.locator('.project-panel .entry', { hasText: 'DRUMS_A' }).first().tap()
  await expect(page.locator('.chain-editor')).toBeVisible()
  await expect(page.locator('.project-panel')).toBeHidden()
})

test('a scene fires from touch, and a cell can be reassigned', async ({ page }) => {
  await page.goto('.')
  await page.getByRole('button', { name: 'Play' }).tap()

  await page.locator('.grid tbody tr').nth(1).locator('.scene-trigger').tap()
  await expect(page.locator('.pill.live')).toContainText('verse')
  await expect(page.locator('.grid .cell.playing')).not.toHaveCount(0)

  // The assign control is a real target on touch, not a hover-revealed sliver.
  const cell = page.locator('.grid tbody tr').nth(0).locator('.cell-wrap').nth(1)
  await cell.locator('.cell-assign').selectOption('B1')
  await expect(cell.locator('.cell-name')).toHaveText('B1')

  // Firing that one cell takes the scene off, since it is no longer the scene.
  await cell.locator('.cell').tap()
  await expect(page.locator('.pill.live')).not.toContainText('verse')
})

test('a cell opens its editor from the grid, and the sheet comes up with it', async ({ page }) => {
  await page.goto('.')

  // A double tap works here where it is unreliable on a desktop, because the
  // transport does not change height on a phone: the controls that would wrap
  // it are already folded into the tray.
  const before = await page.locator('.transport').boundingBox()
  await page.locator('.grid tbody tr').first().locator('button.cell').first().dblclick()

  await expect(page.locator('.editor-head')).toContainText('slot')
  await expect(page.locator('.sheet-editor')).toHaveClass(/open/)
  expect((await page.locator('.transport').boundingBox())?.height).toBe(before?.height)
})

test('every control is big enough to hit', async ({ page }) => {
  await page.goto('.')
  await page.locator('.transport-toggle').tap()

  // 28px is below the usual 44px guidance, but this is a tracker: the whole
  // point is dense. It is the floor at which a target stops being a coin toss.
  //
  // A checkbox inside a label is measured by its label, because the text
  // toggles it too and that is the area a thumb actually has to find.
  const tooSmall = await page.evaluate(() =>
    [...document.querySelectorAll('button, a, select, input[type="checkbox"]')]
      .map((element) => ({ element, target: element.closest('label') ?? element }))
      .map(({ element, target }) => ({ element, box: target.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.height > 0)
      .filter(({ box }) => box.height < 28 || box.width < 18)
      .map(({ element, box }) => `${element.className || element.tagName} ${Math.round(box.width)}×${Math.round(box.height)}`),
  )
  expect(tooSmall).toEqual([])
})

test('what is playing stays visible with a panel over it', async ({ page }) => {
  await page.goto('.')
  await expect(page.locator('.pill.live')).toHaveCount(0)

  // Play starts a scene. The transport is above the sheets, not behind them,
  // so this is readable whatever is open — which is why the dock no longer
  // carries a marker of its own for it.
  await page.getByRole('button', { name: 'Play' }).tap()
  await expect(page.locator('.pill.live')).toContainText('intro')

  await dockButton(page, 'editor').tap()
  await expect(page.locator('.editor-panel')).toBeVisible()
  await expect(page.locator('.pill.live')).toContainText('intro')

  // And it is still the way to stop everything from wherever you are.
  await page.locator('.pill.live').tap()
  await expect(page.locator('.pill.live')).toHaveCount(0)
})

test('the dock flags a pattern that failed, behind a panel that is not open', async ({ page }) => {
  await page.goto('.')
  await expect(page.locator('.dock-mark.bad')).toHaveCount(0)

  // Playing, because a slot is only compiled when something is asking to hear
  // it — an unplaced slot has nothing to fail at.
  await page.getByRole('button', { name: 'Play' }).tap()

  // A slot rather than the scratch pad: a slot is part of the song, so its
  // failure is the engine's to report, and it is the one you need telling
  // about from behind a closed panel.
  await dockButton(page, 'project').tap()
  await page.locator('.project-panel .entry', { hasText: 'A1' }).first().tap()
  const editor = page.locator('.code-editor .cm-content')
  await editor.tap()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('s("bd*4"')
  await page.locator('.editor-head').getByRole('button', { name: 'commit' }).tap()
  await expect(page.locator('.editor-panel .inline-error')).toBeVisible()

  await dockButton(page, 'editor').tap()
  await expect(page.locator('.editor-panel')).toBeHidden()
  await expect(page.locator('.dock-mark.bad')).toBeVisible()
})

test('a pattern can be typed without ever leaving the letter keyboard', async ({ page }) => {
  await page.goto('.')
  await dockButton(page, 'editor').tap()

  const editor = page.locator('.code-editor .cm-content')
  await editor.tap()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')

  // Every character here that is not a letter or a digit comes from the row.
  const key = (label: string) =>
    page.locator('.pattern-key', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first()

  await page.keyboard.type('s')
  await key('(').tap()
  await key('"').tap()
  await page.keyboard.type('bd')
  await key('*').tap()
  await page.keyboard.type('4')
  // Both brackets came in as pairs with the caret inside them; `→` is how a
  // device with no arrow keys gets back out past the closers.
  await key('→').tap()
  await key('→').tap()
  await key('.').tap()
  await page.keyboard.type('gain')
  await key('(').tap()
  await page.keyboard.type('0.5')
  await expect(editor).toHaveText('s("bd*4").gain(0.5)')

  // And the run button is in reach of the same thumb, putting the pattern in
  // the mix — without starting the song, which stays where it was.
  await page.locator('.pattern-run').tap()
  await expect(page.locator('.pill.scratch')).toHaveText('scratch')
  // The transport's own button, not the symbol row's "play" beside it.
  await expect(page.locator('.transport .play')).toHaveAttribute('aria-label', 'Play')
  await expect(page.locator('.inline-error')).toHaveCount(0)
})

test.describe('a phone on its side', () => {
  // Not `isMobile`: Chromium's mobile emulation resolves `100dvh` to half the
  // viewport in landscape, which is an artefact of the emulation rather than
  // anything a real device does, and it would squash the layout under test.
  test.use({ viewport: { width: 844, height: 390 }, isMobile: false, hasTouch: true })

  test('brings the panels in from the side, and leaves the grid playable', async ({ page }) => {
    await page.goto('.')
    await page.getByRole('button', { name: 'Play' }).click()

    await page.locator('.dock button').first().click()
    const project = page.locator('.sheet-project')
    await expect(project).toBeVisible()

    // Full height and about half the width, on the side it sits on when the
    // screen is wide enough for three columns. Polled, because it is still
    // travelling when it first becomes visible.
    const body = await page.locator('.body').boundingBox()
    await expect.poll(async () => Math.round((await project.boundingBox())?.x ?? -1)).toBe(Math.round(body?.x ?? 0))
    const sheet = await project.boundingBox()
    expect(sheet?.height).toBeCloseTo(body?.height ?? 0, 0)
    expect(sheet?.width).toBeLessThan((body?.width ?? 0) * 0.7)

    // No scrim over the grid: there is enough of it left to be worth using,
    // and a set is launched from it while the editor is open.
    await expect(page.locator('.scrim')).toBeHidden()
    await page.locator('.grid tbody tr').nth(1).locator('.scene-trigger').click()
    await expect(page.locator('.pill.live')).toContainText('verse')
    await expect(project).toBeVisible()

    // The handle is on the edge it slides back out towards, and still closes it.
    await page.locator('.sheet-project .sheet-handle').click()
    await expect(project).toBeHidden()
  })
})

test.describe('the wide layout', () => {
  test.use({ viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false })

  test('keeps all three columns, no dock, no sheets and no symbol row', async ({ page }) => {
    await page.goto('.')

    await expect(page.locator('.dock')).toBeHidden()
    // A sheet is `display: contents` up here: no handle, no scrim, no drawer.
    await expect(page.locator('.sheet-handle').first()).toBeHidden()
    await expect(page.locator('.scrim')).toBeHidden()
    await expect(page.locator('.project-panel')).toBeVisible()
    await expect(page.locator('.stage')).toBeVisible()
    await expect(page.locator('.editor-panel')).toBeVisible()
    // The tray is `display: contents` here, so its contents are simply in the bar.
    await expect(page.getByRole('button', { name: 'save as' })).toBeVisible()
    await expect(page.locator('.transport-toggle')).toBeHidden()
    // A keyboard needs no help typing brackets.
    await expect(page.locator('.pattern-keys')).toHaveCount(0)
  })
})
