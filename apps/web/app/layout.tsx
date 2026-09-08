import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "B.U.T.L.E.R. Alfred — Voice & Chat Playground",
  description: "Barış's Unified Task, Logic, Execution & Reasoning — Interaction Playground",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head />
      <body>{children}</body>
    </html>
  );
}
