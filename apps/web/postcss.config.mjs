import { URL, fileURLToPath } from "node:url";

/** Tailwind CSS (tailwind.config.ts) + vendor prefixes, run by Next.js on app/globals.css. */
const config = {
  plugins: {
    // Explicit path: `next dev apps/web` runs from the repository root.
    tailwindcss: { config: fileURLToPath(new URL("./tailwind.config.ts", import.meta.url)) },
    autoprefixer: {}
  }
};

export default config;
