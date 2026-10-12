/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        'bg-deep': 'var(--bg-deep)',
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
      fontFamily: {
        sans: ['var(--font)'],
        mono: ['var(--mono)']
      },
      borderRadius: {
        panel: 'var(--radius)'
      },
      boxShadow: {
        panel: 'var(--shadow)',
        glow: '0 0 24px rgba(139, 92, 246, 0.25)'
      }
    }
  },
  plugins: []
}
