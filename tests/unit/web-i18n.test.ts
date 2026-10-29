import { describe, it, expect } from "vitest";
import { DICTIONARIES, LANGS, detectLang, translate } from "../../apps/web/lib/i18n.js";
import { CHAT_MODEL_OPTIONS } from "../../apps/web/lib/providers.js";
import { renderMarkdown } from "../../apps/web/lib/markdown.js";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("UI dictionaries (apps/web/lib/i18n.ts)", () => {
  it("have identical keys in English and Turkish", () => {
    expect(Object.keys(DICTIONARIES.en).sort()).toEqual(Object.keys(DICTIONARIES.tr).sort());
  });

  it("use the same placeholders and no empty texts in every language", () => {
    for (const key of Object.keys(DICTIONARIES.tr) as Array<keyof typeof DICTIONARIES.tr>) {
      for (const lang of LANGS) {
        expect(DICTIONARIES[lang][key].trim(), `${lang} ${key}`).not.toBe("");
        expect(placeholders(DICTIONARIES[lang][key]), `${lang} ${key}`).toEqual(placeholders(DICTIONARIES.tr[key]));
      }
    }
  });

  it("keep the dropped butler role-play out of the UI", () => {
    for (const lang of LANGS) {
      for (const text of Object.values(DICTIONARIES[lang])) {
        expect(text).not.toMatch(/efendim|hizmetinizde|\bsir\b|at your service|butler/i);
      }
    }
  });

  it("fills placeholders and leaves unknown ones alone", () => {
    expect(translate("en", "memory.count", { count: 3 })).toBe("3 entries");
    expect(translate("tr", "memory.count", { count: 3 })).toBe("3 kayıt");
    expect(translate("en", "settings.intro")).toContain("{chain}");
  });

  it("translates every model option of the selector", () => {
    for (const option of CHAT_MODEL_OPTIONS) {
      for (const lang of LANGS) {
        expect(option.badge[lang], option.id).toBeTruthy();
        expect(option.description[lang], option.id).toBeTruthy();
      }
    }
  });

  it("labels the markdown copy buttons in the UI language, quote-free for the onclick string", () => {
    const code = "```js\nx\n```";
    expect(renderMarkdown(code, null, "en")).toContain("Copy</button>");
    expect(renderMarkdown(code, null, "tr")).toContain("Kopyala</button>");
    for (const lang of LANGS) {
      for (const key of ["markdown.copy", "markdown.copied", "markdown.quote"] as const) {
        expect(DICTIONARIES[lang][key]).not.toMatch(/['"\\<>&]/);
      }
    }
  });
});

describe("detectLang", () => {
  it("prefers the saved choice", () => {
    expect(detectLang("tr", ["en-US"])).toBe("tr");
    expect(detectLang("en", ["tr-TR"])).toBe("en");
  });

  it("falls back to the browser language: tr* is Turkish, anything else English", () => {
    expect(detectLang(null, ["tr-TR", "en-US"])).toBe("tr");
    expect(detectLang(null, ["tr"])).toBe("tr");
    expect(detectLang(undefined, ["en-TR", "tr-TR"])).toBe("en");
    expect(detectLang(null, ["de-DE"])).toBe("en");
    expect(detectLang(null, ["trk"])).toBe("en");
    expect(detectLang("fr", [])).toBe("en");
  });
});
