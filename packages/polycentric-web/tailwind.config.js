/** @type {import('tailwindcss').Config} */
const path = require('path');
import mainconfig from "@polycentric/polycentric-react/tailwind.config.js"

module.exports = {
  content: [
    "./src/renderer/index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    path.join(path.dirname(require.resolve('@polycentric/polycentric-react')), '**/*.{js,ts,jsx,tsx}'),
  ],
  theme: {
    ...mainconfig.theme,
    extend: {},
  },
  plugins: [
    ...mainconfig.plugins,
  ],
}