/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}', './public/index.html'],
  plugins: [],
  // Cairo sans-serif font
  // Inria serif font
  theme: {
    fontFamily: {
      sans: ['Cairo', 'sans-serif'],
      serif: ['Inria Serif', 'serif'],
    },
  },
};
