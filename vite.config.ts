import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

const isElectron = process.env.ELECTRON === '1'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Only build Electron entrypoints when ELECTRON=1 is set; otherwise run web-only.
    isElectron && electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              // Keep native module external to preserve __filename/require context
              external: ['better-sqlite3'],
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
      },
      renderer: process.env.NODE_ENV === 'test'
        ? undefined
        : {},
    }),
  ].filter(Boolean),
})
