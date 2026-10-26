import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { MainShell } from '../src/renderer/cindy/MainShell'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root')

createRoot(root).render(
  <StrictMode>
    <MainShell />
  </StrictMode>,
)
