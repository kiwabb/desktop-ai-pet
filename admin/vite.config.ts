import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    proxy: { '/admin': { target: 'http://127.0.0.1:18081', changeOrigin: false } },
  },
})
