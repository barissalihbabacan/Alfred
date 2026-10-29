"use client";

import React from "react";
import { LANGS, LANG_NAMES } from "../lib/i18n";
import { useI18n } from "../lib/use-i18n";

/** Compact EN | TR switch for the interface language. */
export default function LanguageToggle({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div
      role="group"
      aria-label={t("lang.switchTo")}
      className={`inline-flex items-center gap-0.5 rounded-full border border-white/12 bg-black/25 p-0.5 ${className ?? ""}`}
    >
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          title={LANG_NAMES[code]}
          className={
            lang === code
              ? "cursor-pointer rounded-full border-none bg-gold/20 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-gold"
              : "cursor-pointer rounded-full border-none bg-transparent px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-chat-subtle hover:text-chat-text"
          }
        >
          {code}
        </button>
      ))}
    </div>
  );
}
