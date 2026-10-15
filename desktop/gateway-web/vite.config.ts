import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  server: {
    port: 5174,
    proxy: {
      '/v1': {
        target: process.env.VITE_DEV_API_PROXY || 'http://127.0.0.1:8000',
        changeOrigin: true
      },
      '/health': {
        target: process.env.VITE_DEV_API_PROXY || 'http://127.0.0.1:8000',
        changeOrigin: true
      }
    }
  }
})
