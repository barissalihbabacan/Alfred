import type { Config } from "tailwindcss";

/**
 * Alfred'in tasarim dili. Renkler, onceki inline stillerde tekrar eden hex
 * degerlerinden cikarildi; saydam tonlar icin opaklik eki kullanilir
 * (`bg-gold/15` = rgba(197, 160, 89, 0.15), `border-white/10` ...).
 */
const config: Config = {
  // Yollar bu dosyaya gore cozulur; `next dev apps/web` kok dizinden calisir.
  content: {
    relative: true,
    files: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"]
  },
  theme: {
    extend: {
      // Telefon kirilimi. components/VoiceChatPlayground.tsx icindeki MOBILE_QUERY ile ayni olmali.
      screens: {
        mobile: { max: "768px" },
        touch: { raw: "(hover: none)" }
      },
      colors: {
        // Sohbet ekrani (koyu gri tema)
        chat: {
          bg: "#212121",
          sidebar: "#171717",
          surface: "#2f2f2f",
          modal: "#262626",
          active: "#2a2a2a",
          code: "#141414",
          "code-header": "#1e1e1e",
          text: "#ececec",
          muted: "#b4b4b4",
          subtle: "#8e8e8e",
          faint: "#737373",
          ink: "#121212"
        },
        // Giris ve yukleme ekrani (lacivert tema, globals.css :root degiskenleri)
        butler: {
          bg: "var(--bg-primary)",
          secondary: "var(--bg-secondary)",
          card: "var(--bg-card)",
          "card-hover": "var(--bg-card-hover)",
          border: "var(--border-subtle)",
          text: "var(--text-primary)",
          "text-secondary": "var(--text-secondary)",
          "text-muted": "var(--text-muted)"
        },
        gold: {
          DEFAULT: "#c5a059",
          light: "#e6c887",
          bright: "#d8b26e",
          dark: "#a47e33",
          deep: "#8c6d32"
        },
        danger: "#ef4444",
        success: "#10b981",
        status: {
          thinking: "#3b82f6"
        }
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "\"Segoe UI\"", "Roboto", "sans-serif"],
        mono: ["\"JetBrains Mono\"", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
      },
      keyframes: {
        "alfred-pulse": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.5", transform: "scale(1.1)" }
        },
        "dot-bounce": {
          "0%, 80%, 100%": { transform: "scale(0.6)", opacity: "0.35" },
          "40%": { transform: "scale(1.1)", opacity: "1" }
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" }
        },
        "copy-pop": {
          "0%": { transform: "scale(0.85)", opacity: "0" },
          "50%": { transform: "scale(1.12)" },
          "100%": { transform: "scale(1)", opacity: "1" }
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(-4px)" },
          to: { opacity: "1", transform: "translateY(0)" }
        }
      },
      animation: {
        "alfred-pulse": "alfred-pulse 1.2s infinite",
        "alfred-pulse-fast": "alfred-pulse 1s infinite",
        "dot-bounce": "dot-bounce 1.4s infinite ease-in-out both",
        shimmer: "shimmer 1.8s infinite ease-in-out",
        "copy-pop": "copy-pop 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards",
        "fade-in": "fade-in 0.2s ease-out",
        "spin-fast": "spin 0.8s linear infinite",
        "spin-bounce": "spin 1s cubic-bezier(0.68, -0.55, 0.27, 1.55) infinite"
      },
      transitionTimingFunction: {
        drawer: "cubic-bezier(0.4, 0, 0.2, 1)"
      }
    }
  },
  plugins: []
};

export default config;
