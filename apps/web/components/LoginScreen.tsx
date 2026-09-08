"use client";

import React, { useState } from "react";
import { useAuth } from "../lib/AuthContext";

export default function LoginScreen() {
  const { signInGoogle, error, clearError } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleGoogleSignIn = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await signInGoogle();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "var(--bg-primary)",
      backgroundImage: `
        radial-gradient(circle at 50% 25%, rgba(197, 160, 89, 0.12) 0%, transparent 60%),
        radial-gradient(circle at 80% 80%, rgba(30, 41, 61, 0.25) 0%, transparent 50%)
      `,
      padding: "24px 16px",
      position: "relative",
      overflow: "hidden"
    }}>
      {/* Decorative background grid lines */}
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundImage: `
          linear-gradient(rgba(39, 53, 79, 0.12) 1px, transparent 1px),
          linear-gradient(90deg, rgba(39, 53, 79, 0.12) 1px, transparent 1px)
        `,
        backgroundSize: "48px 48px",
        pointerEvents: "none"
      }} />

      {/* Main Login Card */}
      <div style={{
        position: "relative",
        zIndex: 1,
        width: "100%",
        maxWidth: "460px",
        backgroundColor: "rgba(18, 24, 36, 0.85)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid rgba(197, 160, 89, 0.28)",
        borderRadius: "16px",
        boxShadow: "0 24px 64px rgba(0, 0, 0, 0.6), 0 0 32px rgba(197, 160, 89, 0.08)",
        padding: "40px 32px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center"
      }}>
        
        {/* Butler Crest / Emblem */}
        <div style={{
          width: "72px",
          height: "72px",
          borderRadius: "50%",
          backgroundColor: "rgba(197, 160, 89, 0.1)",
          border: "1.5px solid var(--accent-gold)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "20px",
          boxShadow: "0 0 20px rgba(197, 160, 89, 0.25)"
        }}>
          {/* Stylized Butler / Crown Icon */}
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent-gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>

        {/* Security Badge */}
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "4px 12px",
          borderRadius: "20px",
          backgroundColor: "rgba(197, 160, 89, 0.12)",
          border: "1px solid rgba(197, 160, 89, 0.3)",
          color: "var(--accent-gold-light)",
          fontSize: "11px",
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginBottom: "14px"
        }}>
          <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "var(--accent-gold)", display: "inline-block" }} />
          Güvenli Yönetici Portalı
        </div>

        <h1 style={{
          fontSize: "26px",
          fontWeight: 700,
          color: "var(--text-primary)",
          letterSpacing: "-0.02em",
          marginBottom: "8px"
        }}>
          B.U.T.L.E.R. Alfred
        </h1>
        <p style={{
          fontSize: "13px",
          color: "var(--text-secondary)",
          lineHeight: "1.5",
          marginBottom: "28px"
        }}>
          Kişisel yapay zeka asistanınıza ve sesli etkileşim sistemine erişmek için lütfen kimliğinizi doğrulayın.
        </p>

        {/* User-Friendly Error Alert Banner */}
        {error && (
          <div
            role="alert"
            style={{
              width: "100%",
              marginBottom: "24px",
              padding: "14px 16px",
              backgroundColor: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.35)",
              borderRadius: "10px",
              textAlign: "left",
              display: "flex",
              alignItems: "flex-start",
              gap: "12px",
              animation: "fadeIn 0.2s ease-out"
            }}
          >
            {/* Warning / Error Icon */}
            <div style={{ flexShrink: 0, marginTop: "2px" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                color: "#fca5a5",
                fontWeight: 600,
                fontSize: "13px",
                marginBottom: "3px"
              }}>
                {error.title}
              </div>
              <div style={{
                color: "#e2e8f0",
                fontSize: "12px",
                lineHeight: "1.45"
              }}>
                {error.message}
              </div>
              {error.code === "auth/operation-not-allowed" && (
                <div style={{
                  marginTop: "10px",
                  padding: "10px 12px",
                  backgroundColor: "rgba(0, 0, 0, 0.35)",
                  border: "1px solid rgba(197, 160, 89, 0.3)",
                  borderRadius: "8px",
                  fontSize: "11px",
                  lineHeight: "1.5",
                  color: "#e2e8f0"
                }}>
                  <div style={{ fontWeight: 600, color: "var(--accent-gold-light)", marginBottom: "4px" }}>
                    ⚙️ Çözüm Adımları (1 Dakika):
                  </div>
                  <ol style={{ paddingLeft: "18px", margin: 0, color: "#cbd5e1" }}>
                    <li><strong>Firebase Console &gt; Authentication &gt; Sign-in method</strong> sekmesini açın.</li>
                    <li><strong>Google</strong> seçeneğine tıklayıp <strong>Enable (Etkinleştir)</strong> yapın.</li>
                    <li>Proje destek e-postasını seçip <strong>Save (Kaydet)</strong> butonuna tıklayın.</li>
                  </ol>
                  <a
                    href="https://console.firebase.google.com/project/butler-alfred/authentication/providers"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      marginTop: "8px",
                      color: "var(--accent-gold)",
                      textDecoration: "underline",
                      fontWeight: 600,
                      fontSize: "11px"
                    }}
                  >
                    <span>Firebase Console Sağlayıcılar Sayfasına Git</span>
                    <span>↗</span>
                  </a>
                </div>
              )}
              {error.code && error.code !== "unknown_error" && (
                <div style={{
                  marginTop: "6px",
                  fontSize: "10px",
                  color: "#94a3b8",
                  fontFamily: "monospace"
                }}>
                  Hata Kodu: {error.code}
                </div>
              )}
            </div>

            <button
              onClick={clearError}
              aria-label="Kapat"
              style={{
                background: "transparent",
                border: "none",
                color: "#94a3b8",
                cursor: "pointer",
                padding: "2px",
                lineHeight: 1,
                fontSize: "14px"
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#ffffff")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#94a3b8")}
            >
              ✕
            </button>
          </div>
        )}

        {/* Primary Action: Google Sign-In Button */}
        <button
          onClick={handleGoogleSignIn}
          disabled={isSubmitting}
          style={{
            width: "100%",
            padding: "14px 20px",
            backgroundColor: "#ffffff",
            color: "#1f2937",
            border: "none",
            borderRadius: "10px",
            fontSize: "15px",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
            boxShadow: "0 4px 14px rgba(0, 0, 0, 0.35)",
            transition: "all 0.2s ease",
            opacity: isSubmitting ? 0.75 : 1,
            cursor: isSubmitting ? "not-allowed" : "pointer"
          }}
          onMouseEnter={(e) => {
            if (!isSubmitting) {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow = "0 6px 20px rgba(197, 160, 89, 0.35)";
            }
          }}
          onMouseLeave={(e) => {
            if (!isSubmitting) {
              e.currentTarget.style.transform = "none";
              e.currentTarget.style.boxShadow = "0 4px 14px rgba(0, 0, 0, 0.35)";
            }
          }}
        >
          {isSubmitting ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#374151" }}>
              <div style={{
                width: "18px",
                height: "18px",
                border: "2px solid #9ca3af",
                borderTopColor: "var(--accent-gold)",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite"
              }} />
              <span>Giriş Yapılıyor...</span>
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

        {/* Security / Privacy Assurance */}
        <div style={{
          marginTop: "28px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          color: "var(--text-muted)",
          fontSize: "11px",
          lineHeight: 1.4
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>256-Bit Uçtan Uca Şifrelemeli Yönetici Oturumu</span>
        </div>

      </div>

      <style jsx global>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
