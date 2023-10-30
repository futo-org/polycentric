/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    fontFamily:{
      sans: ['Public Sans', "-apple-system", "system-ui", "Segoe UI Adjusted", "Segoe UI", "Liberation Sans", 'sans-serif'],
      mono: ['Fragment Mono', 'monospace']
    },
    extend: {
      animation: {
        'reverse-spin': 'reverse-spin 1s linear infinite'
      },
      keyframes: {
        'reverse-spin': {
          from: {
            transform: 'rotate(360deg)'
          },
        }
      }
    }
  },
  darkMode: 'media',
}
