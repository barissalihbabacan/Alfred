"use client";

import React from "react";
import { AuthProvider, useAuth } from "../lib/AuthContext";
import LoginScreen from "../components/LoginScreen";
import VoiceChatPlayground from "../components/VoiceChatPlayground";

function AuthenticatedApp() {
  const { user, loading } = useAuth();

  // Initial authentication check state with Butler theme
  if (loading) {
    return (
      <div
        className="alfred-screen"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "var(--bg-primary)",
          gap: "20px"
        }}
      >
        <div
          style={{
            width: "56px",
            height: "56px",
            borderRadius: "50%",
            border: "3px solid var(--border-subtle)",
            borderTopColor: "var(--accent-gold)",
            animation: "alfredSpin 1s cubic-bezier(0.68, -0.55, 0.27, 1.55) infinite"
          }}
        />
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: "15px",
              fontWeight: 600,
              color: "var(--accent-gold-light)",
              letterSpacing: "0.06em",
              marginBottom: "4px"
            }}
          >
            B.U.T.L.E.R. Alfred
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            Güvenlik Protokolü Doğrulanıyor...
          </div>
        </div>
        <style jsx global>{`
          @keyframes alfredSpin {
            to {
              transform: rotate(360deg);
            }
          }
        `}</style>
      </div>
    );
  }

  // If user is not authenticated, strictly lock down and display LoginScreen
  if (!user) {
    return <LoginScreen />;
  }

  // Authenticated and allowed: the chat UI (account info and sign-out live in
  // its sidebar footer / top bar). It only mounts now, so every API call it
  // makes already has an ID token available.
  return <VoiceChatPlayground />;
}

export default function HomePage() {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}
