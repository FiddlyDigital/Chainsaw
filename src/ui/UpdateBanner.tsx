import { useEffect, useState } from 'react'
import { applyUpdate, onUpdateAvailable } from '../pwa'

/**
 * Offers a waiting build to the performer.
 *
 * Applying an update reloads the page, so it is never done automatically —
 * mid-set that would stop the music. But the alternative failure is worse and
 * quieter: without this, a new build installs, waits, and is never mentioned,
 * so reloading appears to do nothing and the app looks stuck on an old version
 * forever.
 *
 * Dismissable, because "not now" is a real answer in the middle of a set. The
 * worker keeps waiting either way, so it is offered again on the next load.
 */
export function UpdateBanner() {
  const [ready, setReady] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => onUpdateAvailable(setReady), [])

  if (!ready || dismissed) return null

  return (
    <div className="update-banner" role="status">
      <span>a new version of Chainsaw is ready</span>
      <button className="update-apply" onClick={applyUpdate} title="Reload to the new version">
        reload
      </button>
      <button className="mini" onClick={() => setDismissed(true)} aria-label="Not now">
        ×
      </button>
    </div>
  )
}
