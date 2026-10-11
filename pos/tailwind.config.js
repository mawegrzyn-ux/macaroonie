/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink:   '#1f2a44',
        page:  '#eef1f6',
        line:  '#d5dbe5',
        muted: '#64708a',
        brand: { DEFAULT: '#2f5bd3', dark: '#2449ad', soft: '#e6edfc' },
        ok:    { DEFAULT: '#15803d', soft: '#dcfce7' },
        warn:  { DEFAULT: '#b45309', soft: '#fef3c7' },
        bad:   { DEFAULT: '#b91c1c', soft: '#fee2e2' },
        held:  { DEFAULT: '#7c3aed', soft: '#ede9fe' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
}
