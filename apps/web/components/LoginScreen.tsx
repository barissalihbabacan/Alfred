"use client";

import React, { useState } from "react";
import { useAuth } from "../lib/AuthContext";

export default function LoginScreen() {
  const { signInGoogle, signInGoogleRedirect, error, clearError } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  // Google butonunun hover kalkisi; eski onMouseEnter/Leave mantigi aynen
  // (gonderim surerken giris/cikis yok sayilir).
  const [isLifted, setIsLifted] = useState(false);

  const handleGoogleSignIn = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await signInGoogle();
    } finally {
      setIsSubmitting(false);
    }
  };

  // Safari / acilir pencere engeli icin dogrudan yonlendirmeli giris. Basarili
  // olursa sayfa Google'a gider; donuste oturum onAuthStateChanged ile gelir.
  const handleRedirectSignIn = async () => {
    if (isSubmitting || isRedirecting) return;
    setIsRedirecting(true);
    try {
      await signInGoogleRedirect();
    } finally {
      setIsRedirecting(false);
    }
  };

  const busy = isSubmitting || isRedirecting;

  return (
    <div className="min-h-screen-safe relative flex items-center justify-center overflow-hidden bg-butler-bg bg-[radial-gradient(circle_at_50%_25%,rgba(197,160,89,0.12)_0%,transparent_60%),radial-gradient(circle_at_80%_80%,rgba(30,41,61,0.25)_0%,transparent_50%)] px-4 py-6 leading-[normal]">
      {/* Decorative background grid lines */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(39,53,79,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(39,53,79,0.12)_1px,transparent_1px)] bg-size-[48px_48px]" />

      {/* Main Login Card */}
      <div className="relative z-1 flex w-full max-w-[460px] flex-col items-center rounded-2xl border border-gold/[0.28] bg-[rgba(18,24,36,0.85)] px-8 py-10 text-center shadow-[0_24px_64px_rgba(0,0,0,0.6),0_0_32px_rgba(197,160,89,0.08)] backdrop-blur-lg">
        
        {/* Butler Crest / Emblem */}
        <div className="mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-full border-[1.5px] border-gold bg-gold/10 shadow-[0_0_20px_rgba(197,160,89,0.25)]">
          {/* Stylized Butler / Crown Icon */}
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="stroke-gold" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>

        {/* Security Badge */}
        <div className="mb-3.5 inline-flex items-center gap-1.5 rounded-[20px] border border-gold/30 bg-gold/12 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-gold-light">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold" />
          Güvenli Yönetici Portalı
        </div>

        <h1 className="mb-2 text-[26px] font-bold tracking-[-0.02em] text-butler-text">
          B.U.T.L.E.R. Alfred
        </h1>
        <p className="mb-7 text-[13px] leading-normal text-butler-text-secondary">
          Kişisel yapay zeka asistanınıza ve sesli etkileşim sistemine erişmek için lütfen kimliğinizi doğrulayın.
        </p>

        {/* User-Friendly Error Alert Banner */}
        {error && (
          <div
            role="alert"
            className="mb-6 flex w-full animate-fade-in items-start gap-3 rounded-[10px] border border-danger/35 bg-danger/10 px-4 py-3.5 text-left"
          >
            {/* Warning / Error Icon */}
            <div className="mt-0.5 shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>

            <div className="min-w-0 flex-1">
              <div className="mb-[3px] text-[13px] font-semibold text-red-300">
                {error.title}
              </div>
              <div className="text-[12px] leading-[1.45] text-slate-200">
                {error.message}
              </div>
              {error.code === "auth/operation-not-allowed" && (
                <div className="mt-2.5 rounded-lg border border-gold/30 bg-black/35 px-3 py-2.5 text-[11px] leading-normal text-slate-200">
                  <div className="mb-1 font-semibold text-gold-light">
                    ⚙️ Çözüm Adımları (1 Dakika):
                  </div>
                  <ol className="m-0 list-decimal pl-[18px] text-slate-300">
                    <li><strong>Firebase Console &gt; Authentication &gt; Sign-in method</strong> sekmesini açın.</li>
                    <li><strong>Google</strong> seçeneğine tıklayıp <strong>Enable (Etkinleştir)</strong> yapın.</li>
                    <li>Proje destek e-postasını seçip <strong>Save (Kaydet)</strong> butonuna tıklayın.</li>
                  </ol>
                  <a
                    href="https://console.firebase.google.com/project/butler-alfred/authentication/providers"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-gold underline"
                  >
                    <span>Firebase Console Sağlayıcılar Sayfasına Git</span>
                    <span>↗</span>
                  </a>
                </div>
              )}
              {error.serverDetails && (
                <div className="mt-2 break-all rounded-md bg-black/40 px-2 py-1.5 font-[monospace] text-[11px] text-slate-300">
                  Sunucu Yanıtı: {error.serverDetails}
                </div>
              )}
              {error.code && error.code !== "unknown_error" && (
                <div className="mt-1.5 font-[monospace] text-[10px] text-slate-400">
                  Hata Kodu: {error.code}
                </div>
              )}
            </div>

            <button
              onClick={clearError}
              aria-label="Kapat"
              className="cursor-pointer border-none bg-transparent p-0.5 text-[14px] leading-none text-slate-400 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}

        {/* Primary Action: Google Sign-In Button */}
        <button
          onClick={handleGoogleSignIn}
          disabled={busy}
          className={`flex w-full items-center justify-center gap-3 rounded-[10px] border-none bg-white px-5 py-3.5 text-[15px] font-semibold text-gray-800 transition-all duration-200 ease-[ease] ${
            isLifted ? "-translate-y-px shadow-[0_6px_20px_rgba(197,160,89,0.35)]" : "shadow-[0_4px_14px_rgba(0,0,0,0.35)]"
          } ${busy ? "cursor-not-allowed opacity-75" : "cursor-pointer opacity-100"}`}
          onMouseEnter={() => {
            if (!isSubmitting) setIsLifted(true);
          }}
          onMouseLeave={() => {
            if (!isSubmitting) setIsLifted(false);
          }}
        >
          {busy ? (
            <div className="flex items-center gap-2 text-gray-700">
              <div className="h-[18px] w-[18px] animate-spin-fast rounded-full border-2 border-gray-400 border-t-gold" />
              <span>{isRedirecting ? "Google'a Yönlendiriliyor..." : "Giriş Yapılıyor..."}</span>
            </div>
          ) : (
            <>
              {/* Google Brand Colored SVG Icon */}
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Google ile Giriş Yap</span>
            </>
          )}
        </button>

        {/* Secondary Action: direct redirect sign-in (Safari / pop-up blockers) */}
        <button
          onClick={handleRedirectSignIn}
          disabled={busy}
          title="Safari veya tarayıcı engeli varsa doğrudan sayfayı yönlendirerek giriş yapın"
          className={`mt-3.5 border-none bg-transparent px-1.5 py-px text-[12px] leading-[1.45] text-butler-text-secondary underline underline-offset-[3px] ${
            busy ? "cursor-not-allowed opacity-50" : "cursor-pointer opacity-100"
          }`}
        >
          Safari veya açılır pencere engeli yaşıyorsanız: <strong>Doğrudan Yönlendirme ile Giriş</strong>
        </button>

        {/* Security / Privacy Assurance */}
        <div className="mt-7 flex items-center gap-2 text-[11px] leading-[1.4] text-butler-text-muted">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>256-Bit Uçtan Uca Şifrelemeli Yönetici Oturumu</span>
        </div>

      </div>
    </div>
  );
}
