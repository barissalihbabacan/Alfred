"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch, ensureOk } from "../../../../lib/api";
import { getFirebaseAuth, subscribeAuthState } from "../../../../lib/auth";

function GoogleAuthCallbackContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    let exchanged = false;
    const code = searchParams.get("code");
    const error = searchParams.get("error");

    if (error) {
      setStatus("error");
      setErrorMessage(`Google yetkilendirme hatası: ${error}`);
      return;
    }

    if (!code) {
      setStatus("error");
      setErrorMessage("Yetkilendirme kodu (code) bulunamadı.");
      return;
    }

    const runExchange = async () => {
      if (exchanged || cancelled) return;
      exchanged = true;

      try {
        const redirectUri = window.location.origin + "/auth/google/callback";
        const res = await apiFetch("/auth/google/callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, redirectUri })
        });
        await ensureOk(res);
        if (cancelled) return;
        setStatus("success");
        setTimeout(() => {
          window.location.href = "/";
        }, 1200);
      } catch (err: unknown) {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage((err as Error)?.message || "Google hesabı bağlanırken bir hata oluştu.");
      }
    };

    // Firebase Auth oturumu sayfa ilk yuklendiginde asenkron olarak geri yuklenir.
    // Oturum hazir oldugunda code takasini baslatiyoruz.
    const unsub = subscribeAuthState((user) => {
      if (cancelled || exchanged) return;
      if (user) {
        void runExchange();
      }
    });

    // Oturum 6 saniye icinde bulunamazsa hata goster.
    const timer = setTimeout(() => {
      if (cancelled || exchanged) return;
      const auth = getFirebaseAuth();
      if (!auth.currentUser) {
        setStatus("error");
        setErrorMessage("Butler Alfred oturumunuz bulunamadı. Lütfen önce uygulamaya giriş yapın.");
      }
    }, 6000);

    return () => {
      cancelled = true;
      unsub();
      clearTimeout(timer);
    };
  }, [searchParams]);

  return (
    <div className="w-full max-w-[400px] rounded-2xl border border-white/10 bg-chat-modal p-6 text-center shadow-[0_20px_50px_rgba(0,0,0,0.6)] backdrop-blur-md">
      {status === "processing" && (
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin-bounce rounded-full border-[3px] border-white/20 border-t-gold" />
          <h2 className="text-[16px] font-semibold text-gold-light">Google Hesabı Doğrulanıyor</h2>
          <p className="text-[12.5px] text-chat-muted">
            Takvim ve Görev izinleri kaydediliyor, lütfen bekleyin…
          </p>
        </div>
      )}

      {status === "success" && (
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="text-[16px] font-semibold text-emerald-300">Bağlantı Başarılı!</h2>
          <p className="text-[12.5px] text-chat-muted">
            Google Takvim ve Görevler başarıyla bağlandı. Yönlendiriliyorsunuz…
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/20 text-red-400">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 className="text-[16px] font-semibold text-red-300">Bağlantı Kurulamadı</h2>
          <p className="text-[12px] text-red-200/80">{errorMessage}</p>
          <button
            onClick={() => { window.location.href = "/"; }}
            className="mt-2 cursor-pointer rounded-xl border border-white/12 bg-white/5 px-4 py-2 text-[13px] text-chat-text hover:bg-white/10"
          >
            Ana Sayfaya Dön
          </button>
        </div>
      )}
    </div>
  );
}

export default function GoogleAuthCallbackPage() {
  return (
    <div className="min-h-screen-safe flex flex-col items-center justify-center bg-butler-bg p-4 text-chat-text">
      <Suspense
        fallback={
          <div className="w-full max-w-[400px] rounded-2xl border border-white/10 bg-chat-modal p-6 text-center shadow-[0_20px_50px_rgba(0,0,0,0.6)] backdrop-blur-md">
            <div className="flex flex-col items-center gap-4">
              <div className="h-10 w-10 animate-spin-bounce rounded-full border-[3px] border-white/20 border-t-gold" />
              <h2 className="text-[16px] font-semibold text-gold-light">Yükleniyor…</h2>
            </div>
          </div>
        }
      >
        <GoogleAuthCallbackContent />
      </Suspense>
    </div>
  );
}
