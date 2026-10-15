/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        panel: 'var(--panel)',
        border: 'var(--border)',
        text: 'var(--text)',
        muted: 'var(--muted)',
        primary: 'var(--primary)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)'
      }
    }
  },
  plugins: []
}
