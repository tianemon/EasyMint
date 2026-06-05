/** @type {import('tailwindcss').Config} */
export default {
  content: ["./app/renderer/src/**/*.{ts,tsx}"],

  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "var(--color-surface)",
          alt: "var(--color-surface-alt)",
          hover: "var(--color-surface-hover)",
          elevated: "var(--color-surface-elevated)",
        },
        border: {
          DEFAULT: "var(--color-border)",
          light: "var(--color-border-light)",
          strong: "var(--color-border-strong)",
        },
        text: {
          primary: "var(--color-text-primary)",
          secondary: "var(--color-text-secondary)",
          inverse: "var(--color-text-inverse)",
          muted: "var(--color-text-muted)",
        },
        accent: {
          DEFAULT: "var(--color-accent)",
          hover: "var(--color-accent-hover)",
          light: "var(--color-accent-light)",
          subtle: "var(--color-accent-subtle)",
          bg: "var(--color-accent-bg)",
          soft: "var(--color-accent-soft)",
          border: "var(--color-accent-border)",
          "border-light": "var(--color-accent-border-light)",
          "border-strong": "var(--color-accent-border-strong)",
        },
        danger: {
          DEFAULT: "var(--color-danger)",
          bg: "var(--color-danger-bg)",
          border: "var(--color-danger-border)",
        },
        success: {
          DEFAULT: "var(--color-success)",
          bg: "var(--color-success-bg)",
          border: "var(--color-success-border)",
        },
        warning: {
          DEFAULT: "var(--color-warning)",
          bg: "var(--color-warning-bg)",
          border: "var(--color-warning-border)",
        },
        info: {
          DEFAULT: "var(--color-info)",
          bg: "var(--color-info-bg)",
        },
        dot: {
          gray: "var(--color-dot-gray)",
          green: "var(--color-dot-green)",
          amber: "var(--color-dot-amber)",
          red: "var(--color-dot-red)",
          blue: "var(--color-dot-blue)",
        },
        editor: {
          bg: "var(--color-editor-bg)",
          gutter: "var(--color-editor-gutter-bg)",
          highlight: "var(--color-editor-line-highlight)",
        },
        terminal: {
          bg: "var(--color-terminal-bg)",
          text: "var(--color-terminal-text)",
        },
        tooltip: {
          bg: "var(--color-tooltip-bg)",
          text: "var(--color-tooltip-text)",
        },
        overlay: "rgba(0,0,0,0.5)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "Roboto", "sans-serif"],
        mono: ["ui-monospace", "'SF Mono'", "'JetBrains Mono'", "Menlo", "monospace"],
      },
      transitionTimingFunction: {
        "mint-ease": "cubic-bezier(0.4, 0, 0.2, 1)",
      },
    },
  },
  plugins: [],
};
