/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b1018', panel: '#111824', panel2: '#162030', line: '#223047', ink: '#e6edf6', mute: '#8da0b8',
        accent: '#2fb7d8', accent2: '#3b82f6', ok: '#34d399', warn: '#fbbf24', bad: '#f87171', info: '#a78bfa',
      },
      fontFamily: { sans: ['"Segoe UI"', 'Inter', 'system-ui', 'sans-serif'], mono: ['"Cascadia Code"', 'Consolas', 'monospace'] },
    },
  },
  plugins: [],
};
