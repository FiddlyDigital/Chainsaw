import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { registerServiceWorker } from './pwa'
import './styles.css'

const host = document.getElementById('root')
if (!host) throw new Error('missing #root')

createRoot(host).render(
  <StrictMode>
    {/* The panes have their own boundaries; this one is for everything above
        them — the transport, the notice, the app shell itself. */}
    <ErrorBoundary where="app">
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

registerServiceWorker()
