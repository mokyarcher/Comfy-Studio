/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        panel: 'var(--panel)',
        'panel-elevated': 'var(--panel-elevated)',
        border: 'var(--border)',
        text: 'var(--text)',
        muted: 'var(--muted)',
        primary: 'var(--primary)',
        'primary-hover': 'var(--primary-hover)',
        accent: 'var(--accent)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)'
      },
      boxShadow: {
        glow: '0 0 24px color-mix(in srgb, var(--primary) 35%, transparent)'
      }
    }
  },
  plugins: []
}
