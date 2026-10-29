import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alfred — Yönetici Yapay Zeka Asistanı",
  description: "Kişisel Yapay Zeka ve Yönetici Asistanı",
  manifest: "/manifest.json",
  applicationName: "Alfred",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Alfred",
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#212121",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="tr" style={{ backgroundColor: "#212121", colorScheme: "dark" }}>
      <head>
        {/* Loaded at runtime (not next/font) so the static build needs no network. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ backgroundColor: "#212121" }}>{children}</body>
    </html>
  );
}
