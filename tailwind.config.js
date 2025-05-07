/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      backgroundColor: {
        dark: '#121212',
        surface: '#1E1E1E',
      },
      colors: {
        primary: '#BB86FC',
        secondary: '#03DAC6',
        accent: '#CF6679',
      },
      textColor: {
        dark: '#E1E1E1',
        light: '#FFFFFF',
      },
    },
  },
  plugins: [],
}
