/**
 * Tailwind CSS (tailwind.config.ts) + vendor prefixes, run by Next.js on app/globals.css.
 *
 * No explicit config path: Next 16 builds with Turbopack, which evaluates this
 * file with apps/web as the working directory (where Tailwind finds
 * tailwind.config.ts on its own) but with a wrong `import.meta.url`, so a path
 * derived from it does not resolve.
 */
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};

export default config;
