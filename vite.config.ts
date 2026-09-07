import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    // Keep a single React copy — motion ships its own otherwise and hooks
    // (useContext inside motion components) blow up with a duplicate React.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: '127.0.0.1',
    port: 1421,
    strictPort: true,
  },
})
