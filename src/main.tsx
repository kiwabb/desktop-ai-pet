import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import { installMotionDiagnostics } from './lib/motion-diagnostics'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.DEV || import.meta.env.MODE === 'motion-diagnostic') {
  void installMotionDiagnostics()
}
