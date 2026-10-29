import type { NextConfig } from "next";

/**
 * apps/web statik bir export olarak derlenir (`next build` -> apps/web/out) ve
 * Firebase Hosting tarafindan sunulur. Sunucu tarafi calisma zamani yoktur:
 * /api/** istekleri firebase.json'daki rewrite ile `api` Cloud Function'ina
 * (functions/index.js) gider.
 *
 * `next dev` sirasinda ayni /api/** yollari ALFRED_API_ORIGIN'e proxy'lenir,
 * boylece yerel gelistirmede de istekler ayni origin'den gider (CORS ve DELETE
 * preflight sorunu olmaz). Varsayilan hedef Functions emulator'udur (proje
 * NEXT_PUBLIC_FIREBASE_PROJECT_ID'den, yoksa `demo-alfred`); canli backend'e
 * baglanmak icin ALFRED_API_ORIGIN=https://<proje-id>.web.app/api verilebilir.
 */
const isDev = process.env.NODE_ENV === "development";

const emulatorProjectId = (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim() || "demo-alfred";

const apiOrigin = (
  process.env.ALFRED_API_ORIGIN || `http://127.0.0.1:5001/${emulatorProjectId}/us-central1/api`
).replace(/\/+$/, "");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(isDev
    ? {
        async rewrites() {
          return [{ source: "/api/:path*", destination: `${apiOrigin}/:path*` }];
        },
      }
    : {
        output: "export",
        images: { unoptimized: true },
      }),
};

export default nextConfig;
