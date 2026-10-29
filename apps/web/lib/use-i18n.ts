"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  DEFAULT_LANG,
  getLang,
  setLang,
  subscribeLang,
  translate,
  type Lang,
  type MessageKey
} from "./i18n";

const getServerLang = (): Lang => DEFAULT_LANG;

/**
 * The page's UI language and a `t()` bound to it. Hydration renders
 * DEFAULT_LANG (what the static export was prerendered in), then the saved or
 * browser language; a `setLang()` anywhere re-renders every user. Also keeps
 * `<html lang>` and the tab title in that language.
 */
export function useI18n() {
  const lang = useSyncExternalStore(subscribeLang, getLang, getServerLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = translate(lang, "app.title");
  }, [lang]);

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang]
  );

  return { lang, setLang, t };
}
