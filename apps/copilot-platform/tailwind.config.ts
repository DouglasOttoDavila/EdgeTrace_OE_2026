import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-plus-jakarta)", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      boxShadow: {
        glass: "0 22px 55px -30px rgba(2, 6, 23, 0.95)",
        innerGlow: "inset 0 1px 1px rgba(255, 255, 255, 0.12)"
      }
    }
  },
  plugins: []
};

export default config;
