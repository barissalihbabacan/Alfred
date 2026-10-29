"use client";

import React from "react";
import { AuthProvider, useAuth } from "../lib/AuthContext";
import LoginScreen from "../components/LoginScreen";
import VoiceChatPlayground from "../components/VoiceChatPlayground";
import { useI18n } from "../lib/use-i18n";

function AuthenticatedApp() {
  const { user, loading } = useAuth();
  const { t } = useI18n();

  // Initial authentication check
  if (loading) {
    return (
      <div className="min-h-screen-safe flex flex-col items-center justify-center gap-5 bg-butler-bg leading-[normal]">
        <div className="h-14 w-14 animate-spin-bounce rounded-full border-[3px] border-butler-border border-t-gold" />
        <div className="text-center">
          <div className="mb-1 text-[15px] font-semibold tracking-[0.06em] text-gold-light">
            Alfred
          </div>
          <div className="text-[12px] text-butler-text-muted">
            {t("app.checkingSession")}
          </div>
        </div>
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
