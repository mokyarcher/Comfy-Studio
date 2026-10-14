// @ts-check
import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import mdx from '@astrojs/mdx'

const site = process.env.SITE_URL || 'https://comfy-studio.sharex.team'
const base = process.env.BASE_PATH || '/'

// https://astro.build/config
export default defineConfig({
  site,
  base,
  integrations: [react(), mdx()],
  vite: {
    plugins: [tailwindcss()]
  }
})
