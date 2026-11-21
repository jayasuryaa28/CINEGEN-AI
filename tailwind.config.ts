import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        cine: {
          dark: "#08090C",
          charcoal: "#0F1117",
          panel: "#161922",
          border: "#232735",
          accent: "#00E5FF",
          accentGlow: "rgba(0, 229, 255, 0.2)",
          electric: "#0072FF",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
