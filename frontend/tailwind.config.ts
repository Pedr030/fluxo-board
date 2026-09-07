import type { Config } from "tailwindcss";

// Paleta e tipografia da identidade visual do Fluxo — ver docs/identidade-visual.html
// (guia completo, com uso de cada token) e PROJECT_SPEC.md seção 9.
//
// surface/ink/canvas usam variáveis CSS (definidas em globals.css, com um
// valor pra :root e outro pra .dark) em vez de hex fixo — é isso que faz o
// dark mode funcionar em toda a UI sem precisar duplicar `dark:` em cada
// className que já usa esses tokens. O formato `rgb(var(--x) / <alpha-value>)`
// é o jeito documentado do Tailwind de deixar opacidade (`bg-surface/70`)
// funcionar mesmo com a cor vindo de variável.
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#dae7ff",
          300: "#93b4ff",
          500: "#3b6fed", // primária
          600: "#2e56c9",
          700: "#23409c",
        },
        flow: {
          100: "#d3f5f0",
          400: "#2dd4c8",
          500: "#14b8a6", // secundária (teal) — presença/tempo real
          600: "#0f8f81",
        },
        accent: {
          500: "#f97316", // laranja "Signal" — só pra colaborador ativo agora, com moderação
        },
        surface: {
          DEFAULT: "rgb(var(--color-surface) / <alpha-value>)",
          muted: "rgb(var(--color-canvas) / <alpha-value>)", // "Canvas" do guia
          border: "rgb(var(--color-line) / <alpha-value>)", // "Line" do guia
        },
        ink: {
          DEFAULT: "rgb(var(--color-ink) / <alpha-value>)", // texto principal
          soft: "rgb(var(--color-ink-soft) / <alpha-value>)", // texto secundário/legendas
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-unbounded)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "10px",
        list: "14px",
      },
      boxShadow: {
        card: "var(--shadow-card)",
      },
    },
  },
  plugins: [],
};

export default config;
