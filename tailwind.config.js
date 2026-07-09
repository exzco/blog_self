/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./template/**/*.html'],
  theme: {
    extend: {
      colors: {
        zinc: {
          50: '#fafafa',
          100: '#f4f4f5',
          200: '#e4e4e7',
          300: '#d4d4d8',
          400: '#a1a1aa',
          500: '#71717a',
          800: '#27272a',
          900: '#18181b',
          950: '#09090b',
        }
      },
      borderRadius: { md: '6px' }
    }
  },
  plugins: [],
}
