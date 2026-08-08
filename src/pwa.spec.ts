import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyUpdate, checkForUpdate, hasUpdate, onUpdateAvailable, registerServiceWorker, resetForTests } from './pwa'

/**
 * The update handshake, against a fake `navigator.serviceWorker`.
 *
 * Every failure mode here is silent in a browser: an update that installs and
 * is never announced looks exactly like a deploy that never happened, and an
 * update announced on a first install sends someone to reload a page that is
 * already current. Neither shows up as an error anywhere.
 */

class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installing'
  readonly messages: unknown[] = []

  postMessage(data: unknown) {
    this.messages.push(data)
  }

  install() {
    this.state = 'installed'
    this.dispatchEvent(new Event('statechange'))
  }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null
  waiting: FakeWorker | null = null
  readonly update = vi.fn(() => Promise.resolve())

  /** A new build arrives: the browser finds it and installs it. */
  deploy(): FakeWorker {
    const worker = new FakeWorker()
    this.installing = worker
    this.dispatchEvent(new Event('updatefound'))
    worker.install()
    return worker
  }
}

class FakeContainer extends EventTarget {
  controller: object | null = { id: 'existing' }
  registration = new FakeRegistration()
  readonly register = vi.fn(() => Promise.resolve(this.registration as unknown as ServiceWorkerRegistration))
}

let container: FakeContainer
let originalLocation: PropertyDescriptor | undefined

/**
 * Replace `location.reload` while keeping `href`, which registration resolves
 * the worker's URL against.
 */
function stubReload(): ReturnType<typeof vi.fn> {
  const reload = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: 'https://example.invalid/chainsaw/', reload },
  })
  return reload
}

/** Register, and let the `load` listener and the registration promise settle. */
async function boot() {
  registerServiceWorker()
  window.dispatchEvent(new Event('load'))
  await vi.waitFor(() => expect(container.register).toHaveBeenCalled())
  await Promise.resolve()
}

beforeEach(() => {
  originalLocation ??= Object.getOwnPropertyDescriptor(window, 'location')
  resetForTests()
  container = new FakeContainer()
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, writable: true, value: container })
  vi.stubEnv('DEV', false)
})

afterEach(() => {
  if (originalLocation) Object.defineProperty(window, 'location', originalLocation)
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('noticing a new build', () => {
  it('announces a worker that installs while another one controls the page', async () => {
    await boot()
    const listener = vi.fn()
    onUpdateAvailable(listener)
    expect(listener).toHaveBeenLastCalledWith(false)

    container.registration.deploy()

    expect(listener).toHaveBeenLastCalledWith(true)
    expect(hasUpdate()).toBe(true)
  })

  it('announces one that was already waiting when the page loaded', async () => {
    container.registration.waiting = new FakeWorker()
    await boot()
    expect(hasUpdate()).toBe(true)
  })

  it('says nothing on a first install, when no worker controls the page yet', async () => {
    container.controller = null
    await boot()
    const listener = vi.fn()
    onUpdateAvailable(listener)

    container.registration.deploy()

    // There is nothing to update *from*; offering a reload here would send
    // someone to refresh a page that is already current.
    expect(listener).toHaveBeenCalledExactlyOnceWith(false)
    expect(hasUpdate()).toBe(false)
  })

  it('tells a listener the state as soon as it subscribes', async () => {
    container.registration.waiting = new FakeWorker()
    await boot()
    const listener = vi.fn()
    onUpdateAvailable(listener)
    expect(listener).toHaveBeenCalledWith(true)
  })

  it('stops telling a listener that has unsubscribed', async () => {
    await boot()
    const listener = vi.fn()
    onUpdateAvailable(listener)()
    container.registration.deploy()
    expect(listener).toHaveBeenCalledTimes(1) // the immediate one, and no more
  })
})

describe('looking for a new build', () => {
  it('checks when the tab becomes visible again', async () => {
    await boot()
    container.registration.update.mockClear()

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(container.registration.update).toHaveBeenCalled()
  })

  it('does not check when the tab is hidden', async () => {
    await boot()
    container.registration.update.mockClear()

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(container.registration.update).not.toHaveBeenCalled()
  })

  it('checks on coming back online', async () => {
    await boot()
    container.registration.update.mockClear()
    window.dispatchEvent(new Event('online'))
    expect(container.registration.update).toHaveBeenCalled()
  })

  it('survives a check that fails because there is no network', async () => {
    await boot()
    container.registration.update.mockRejectedValueOnce(new Error('offline'))
    expect(() => checkForUpdate()).not.toThrow()
  })

  it('does nothing before registration has resolved', () => {
    expect(() => checkForUpdate()).not.toThrow()
  })
})

describe('applying an update', () => {
  it('asks the waiting worker to take over, and reloads once it has', async () => {
    const reload = stubReload()

    await boot()
    const worker = container.registration.deploy()
    applyUpdate()

    // The worker is asked to skip waiting, but nothing reloads yet: reload
    // before it has taken over and the old worker serves the old cache again.
    expect(worker.messages).toEqual(['SKIP_WAITING'])
    expect(reload).not.toHaveBeenCalled()

    container.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads only once, however many times control changes hands', async () => {
    const reload = stubReload()

    await boot()
    container.registration.deploy()
    applyUpdate()
    container.dispatchEvent(new Event('controllerchange'))
    container.dispatchEvent(new Event('controllerchange'))

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does nothing when there is no update waiting', async () => {
    await boot()
    expect(() => applyUpdate()).not.toThrow()
  })
})
