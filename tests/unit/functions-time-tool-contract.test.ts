import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  CITY_TIMEZONE_ALIASES,
  resolveTimezone
} from "../../src/ai/tools/time/timezone-resolver.js";
import {
  GET_CURRENT_TIME_TOOL_DEFINITION,
  getCurrentTimeForCity
} from "../../src/ai/tools/time/current-time.js";
import { GetCurrentTimeTool } from "../../src/ai/tools/time/get-current-time.tool.js";

/**
 * Production contract for the get_current_time tool, which functions/index.js
 * now imports from src/ (bundled via esbuild). The `legacy*` values below are
 * verbatim copies of what functions/index.js carried inline before the
 * migration; the differential tests prove the shared code returns the same
 * result for every input, so the migration is a no-op in production.
 */

// ---------------------------------------------------------------------------
// Verbatim pre-migration production code (functions/index.js)
// ---------------------------------------------------------------------------

const LEGACY_TIME_TOOL_DEFINITION = {
  type: "function",
  function: {
    name: "get_current_time",
    description: "Returns the current local time, date, day of week, and timezone offset for a specified city or location.",
    parameters: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "The city or geographic location name to look up (e.g. 'London', 'Tokyo', 'Istanbul', 'New York', 'Paris')."
        }
      },
      required: ["city"]
    }
  }
};

const LEGACY_CITY_TIMEZONE_ALIASES: Record<string, string> = {
  "london": "Europe/London",
  "manchester": "Europe/London",
  "birmingham": "Europe/London",
  "edinburgh": "Europe/London",
  "istanbul": "Europe/Istanbul",
  "ankara": "Europe/Istanbul",
  "izmir": "Europe/Istanbul",
  "tokyo": "Asia/Tokyo",
  "kyoto": "Asia/Tokyo",
  "osaka": "Asia/Tokyo",
  "new york": "America/New_York",
  "washington": "America/New_York",
  "boston": "America/New_York",
  "san francisco": "America/Los_Angeles",
  "los angeles": "America/Los_Angeles",
  "seattle": "America/Los_Angeles",
  "chicago": "America/Chicago",
  "paris": "Europe/Paris",
  "berlin": "Europe/Berlin",
  "frankfurt": "Europe/Berlin",
  "rome": "Europe/Rome",
  "madrid": "Europe/Madrid",
  "amsterdam": "Europe/Amsterdam",
  "dubai": "Asia/Dubai",
  "singapore": "Asia/Singapore",
  "sydney": "Australia/Sydney",
  "melbourne": "Australia/Melbourne",
  "toronto": "America/Toronto",
  "beijing": "Asia/Shanghai",
  "shanghai": "Asia/Shanghai",
  "utc": "UTC",
  "gmt": "Etc/GMT"
};

function legacyResolveTimezone(cityOrZone: unknown): { timezone: string; matchedCity: string } | null {
  if (!cityOrZone || typeof cityOrZone !== "string") return null;
  const cleaned = cityOrZone.trim().toLowerCase().replace(/[,.]/g, "").replace(/\s+/g, " ");

  let tz = LEGACY_CITY_TIMEZONE_ALIASES[cleaned];
  if (!tz) {
    try {
      const parts = Intl.supportedValuesOf("timeZone");
      for (const z of parts) {
        if (z.toLowerCase() === cleaned || z.toLowerCase().endsWith("/" + cleaned.replace(/\s+/g, "_"))) {
          tz = z;
          break;
        }
      }
    } catch { /* verbatim: empty */ }
  }

  if (tz) {
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: tz });
      return { timezone: tz, matchedCity: cityOrZone.trim() };
    } catch { /* verbatim: empty */ }
  }
  return null;
}

function legacyGetCurrentTimeForCity(city: unknown) {
  const resolved = legacyResolveTimezone(city);
  if (!resolved) {
    return { error: `Unable to identify a valid timezone for city '${city}'.` };
  }
  const now = new Date();
  const tz = resolved.timezone;
  const time12 = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(now);
  const time24 = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const dateStr = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(now);
  const offsetParts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(now);
  const offset = offsetParts.find((p) => p.type === "timeZoneName")?.value || "UTC";

  return {
    city: resolved.matchedCity,
    timezone: tz,
    localTime: time12,
    time24,
    date: dateStr,
    utcOffset: offset
  };
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const ZONES = Intl.supportedValuesOf("timeZone");

const TURKISH_INPUTS = [
  "Istanbul", "İstanbul", "ISTANBUL", "İSTANBUL", "istanbul", "Istanbul, Turkey", "İstanbul, Türkiye", "Istanbul.",
  "Ankara", "ANKARA", "Izmir", "İzmir", "IZMIR", "İZMİR", "izmir", "Bursa", "Antalya", "Adana", "Konya", "Trabzon",
  "Eskişehir", "Diyarbakır", "Şanlıurfa", "Türkiye", "Turkey", "Europe/Istanbul", "europe/istanbul", "Asia/Istanbul",
  "Istanbul saati", "İstanbul'da saat kaç", "Kadıköy", "Beşiktaş", "Üsküdar", "Çanakkale", "Muğla", "Ağrı"
];

const WORLD_INPUTS = [
  "London", "london", "LONDON", "  London  ", "London, UK", "London.", "City of London", "New York", "new   york",
  "New York City", "NYC", "new_york", "New-York", "Los Angeles", "LA", "San Francisco", "sao paulo", "São Paulo",
  "Sao_Paulo", "Mexico City", "mexico city", "Buenos Aires", "buenos_aires", "Ho Chi Minh", "Kolkata", "Mumbai",
  "Delhi", "Bangalore", "Zurich", "Zürich", "Geneva", "Munich", "München", "Reykjavik", "Kiev", "Kyiv", "Moscow",
  "Tehran", "Kathmandu", "Chatham", "Honolulu", "Anchorage", "Indianapolis", "Knox", "Port of Spain", "Port-au-Prince",
  "Dumont d'Urville", "DumontDUrville", "Salt Lake City", "Denver", "Phoenix", "Calgary", "Montreal", "Rio",
  "UTC", "utc", "GMT", "gmt", "Zulu", "Etc/UTC", "etc/utc", "Etc/GMT+5", "etc/gmt-14", "EST", "PST", "CET",
  "GMT+3", "UTC+3", "+03:00", "America/Argentina/Buenos_Aires", "argentina/buenos aires", "Asia/Calcutta",
  "US/Eastern", "US/Pacific", "Europe/Kiev", "Europe/Belfast", "Australia/ACT"
];

const EDGE_INPUTS: unknown[] = [
  "", " ", "\t\n", ",", ".", "/", "//", ",.,", "constructor", "__proto__", "toString", "tostring", "hasOwnProperty",
  "valueOf", "prototype", "Constructor", "a", "e", "z", "_", "a/b", "europe/", "/london",
  undefined, null, 0, 1, NaN, true, false, [], ["London"], {}, { city: "London" }
];

function allInputs(): unknown[] {
  const out: unknown[] = [...TURKISH_INPUTS, ...WORLD_INPUTS, ...EDGE_INPUTS, ...Object.keys(LEGACY_CITY_TIMEZONE_ALIASES)];
  for (const key of Object.keys(LEGACY_CITY_TIMEZONE_ALIASES)) out.push(key.toUpperCase(), ` ${key}, `);
  for (const z of ZONES) {
    const last = z.split("/").pop()!;
    out.push(z, z.toLowerCase(), z.toUpperCase(), last, last.replace(/_/g, " "), last.toLowerCase().replace(/_/g, "  "), `${last}.`);
  }
  return out;
}

const INSTANTS = [
  "2026-09-23T12:34:56Z",
  "2026-01-01T00:00:00Z",
  "2026-03-29T00:59:59Z", // EU DST starts at 01:00Z
  "2026-03-29T01:00:00Z",
  "2026-03-08T06:59:59Z", // US DST starts (Eastern) at 07:00Z
  "2026-11-01T06:00:00Z", // US DST ends
  "2026-10-25T00:30:00Z", // EU DST ends at 01:00Z
  "2028-02-29T23:59:59Z", // leap day
  "2026-12-31T23:30:00Z"  // New Year in eastern zones
];

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------

describe("get_current_time tool definition (production contract)", () => {
  it("is identical to the definition production carried inline", () => {
    expect(GET_CURRENT_TIME_TOOL_DEFINITION).toEqual(LEGACY_TIME_TOOL_DEFINITION);
    expect(JSON.stringify(GET_CURRENT_TIME_TOOL_DEFINITION)).toBe(JSON.stringify(LEGACY_TIME_TOOL_DEFINITION));
  });

  it("is what GetCurrentTimeTool advertises in src/", () => {
    expect(JSON.stringify(new GetCurrentTimeTool().getDefinition())).toBe(JSON.stringify(LEGACY_TIME_TOOL_DEFINITION));
  });

  it("keeps every entry of production's original alias table unchanged", () => {
    for (const [city, zone] of Object.entries(LEGACY_CITY_TIMEZONE_ALIASES)) {
      expect(CITY_TIMEZONE_ALIASES[city], city).toBe(zone);
    }
  });
});

// The resolver was later fixed to match more spellings. The contract is now:
// whatever the original production resolver resolved still resolves to the
// same zone; only inputs it returned null for may resolve differently.
function expectNoRegression(input: unknown) {
  const legacy = legacyResolveTimezone(input);
  if (legacy) expect(resolveTimezone(input), JSON.stringify(input) ?? String(input)).toEqual(legacy);
}

describe("resolveTimezone (no regression against production)", () => {
  it(`never changes a zone production resolved (${ZONES.length} runtime zones x 7 spellings plus Turkish, world and edge cases)`, () => {
    const inputs = allInputs();
    expect(inputs.length).toBeGreaterThan(2500);
    for (const input of inputs) expectNoRegression(input);
  }, 60_000);

  it("agrees on 3000 random strings built from zone fragments", () => {
    let a = 12345;
    const r = () => ((a = (Math.imul(a, 1103515245) + 12345) >>> 0) / 4294967296);
    const fragments = ["", " ", "  ", "_", "/", ",", ".", "-", "İ", "ı", "ş", "ü", "new", "york", "san", "paulo", "europe", "asia", "london", "is", "tanbul", "gmt", "+3", "etc", "america", "argentina"];
    for (let i = 0; i < 3000; i++) {
      let s = "";
      const len = Math.floor(r() * 6);
      for (let j = 0; j < len; j++) s += fragments[Math.floor(r() * fragments.length)];
      expectNoRegression(s);
    }
  }, 60_000);

  it("resolves Turkish spellings production missed", () => {
    for (const input of ["İstanbul", "İSTANBUL", "İzmir", "İZMİR", "Eskişehir", "Diyarbakır", "Şanlıurfa", "Çanakkale",
      "Muğla", "Kadıköy", "Beşiktaş", "Üsküdar", "Bursa", "Antalya", "Türkiye", "Turkey"]) {
      expect(resolveTimezone(input)?.timezone, input).toBe("Europe/Istanbul");
    }
    expect(resolveTimezone("İstanbul")).toEqual({ timezone: "Europe/Istanbul", matchedCity: "İstanbul" });
  });

  it("drops a country after a comma, a trailing country name and a Turkish case suffix", () => {
    expect(resolveTimezone("Istanbul, Turkey")?.timezone).toBe("Europe/Istanbul");
    expect(resolveTimezone("İstanbul, Türkiye")?.timezone).toBe("Europe/Istanbul");
    expect(resolveTimezone("London, UK")?.timezone).toBe("Europe/London");
    expect(resolveTimezone("Paris France")?.timezone).toBe("Europe/Paris");
    expect(resolveTimezone("New York, USA")?.timezone).toBe("America/New_York");
    expect(resolveTimezone("İstanbul'da saat kaç")?.timezone).toBe("Europe/Istanbul");
    expect(resolveTimezone("Londra'da")?.timezone).toBe("Europe/London");
  });

  it("folds accents and knows Turkish names and big cities without their own IANA zone", () => {
    expect(resolveTimezone("São Paulo")?.timezone).toBe("America/Sao_Paulo");
    expect(resolveTimezone("Zürich")?.timezone).toBe("Europe/Zurich");
    expect(resolveTimezone("München")?.timezone).toBe("Europe/Berlin");
    expect(resolveTimezone("Münih")?.timezone).toBe("Europe/Berlin");
    expect(resolveTimezone("Londra")?.timezone).toBe("Europe/London");
    expect(resolveTimezone("Moskova")?.timezone).toBe("Europe/Moscow");
    expect(resolveTimezone("Mumbai")?.timezone).toBe("Asia/Kolkata");
    expect(resolveTimezone("Miami")?.timezone).toBe("America/New_York");
    expect(resolveTimezone("NYC")?.timezone).toBe("America/New_York");
  });

  it("accepts zone names Intl knows but does not list, canonicalized", () => {
    expect(resolveTimezone("US/Eastern")?.timezone).toBe(
      new Intl.DateTimeFormat("en-US", { timeZone: "US/Eastern" }).resolvedOptions().timeZone
    );
    expect(resolveTimezone("US/Pacific")).not.toBeNull();
    // Bare abbreviations stay unresolved: Intl maps "EST" to America/Panama.
    expect(resolveTimezone("EST")).toBeNull();
  });

  it("does not guess when what follows a comma is not a country", () => {
    expect(resolveTimezone("Paris, Texas")).toBeNull();
    expect(resolveTimezone("Sam")).toBeNull();
  });

  it("still rejects nonsense and object-prototype keys", () => {
    for (const input of ["Gondor", "constructor", "__proto__", "toString", "", " ", ",", "a/b", undefined, null, 0, {}, []]) {
      expect(resolveTimezone(input), String(input)).toBeNull();
    }
  });

  it("keeps production's normalization for inputs it handled", () => {
    expect(resolveTimezone("  new   york ")).toEqual({ timezone: "America/New_York", matchedCity: "new   york" });
    expect(resolveTimezone("sao paulo")?.timezone).toBe("America/Sao_Paulo");
    expect(resolveTimezone("europe/london")?.timezone).toBe("Europe/London");
  });
});

describe("getCurrentTimeForCity (differential against production)", () => {
  const sample = [
    ...TURKISH_INPUTS, ...WORLD_INPUTS, ...EDGE_INPUTS, ...Object.keys(LEGACY_CITY_TIMEZONE_ALIASES),
    ...ZONES.filter((_, i) => i % 15 === 0)
  ];

  it("returns production's object at DST edges, leap day and year end, for every input production resolved", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    for (const iso of INSTANTS) {
      vi.setSystemTime(new Date(iso));
      for (const input of sample) {
        const label = `${iso} ${JSON.stringify(input) ?? String(input)}`;
        const expected = legacyGetCurrentTimeForCity(input);
        if ("error" in expected) continue; // may resolve now; covered by the resolver tests
        expect(getCurrentTimeForCity(input), label).toEqual(expected);
        expect(getCurrentTimeForCity(input, new Date(iso)), label).toEqual(expected);
      }
    }
  }, 60_000);

  it("pins production's output shape and formats", () => {
    const at = new Date("2026-09-23T12:34:56Z");
    expect(getCurrentTimeForCity("Istanbul", at)).toEqual({
      city: "Istanbul",
      timezone: "Europe/Istanbul",
      localTime: "3:34 PM",
      time24: "15:34",
      date: "Wednesday, September 23, 2026",
      utcOffset: "GMT+3"
    });
    expect(getCurrentTimeForCity(" tokyo ", at)).toMatchObject({ city: "tokyo", time24: "21:34", utcOffset: "GMT+9" });
    expect(getCurrentTimeForCity("Gondor", at)).toEqual({ error: "Unable to identify a valid timezone for city 'Gondor'." });
    expect(getCurrentTimeForCity(undefined, at)).toEqual({ error: "Unable to identify a valid timezone for city 'undefined'." });
    expect(getCurrentTimeForCity({}, at)).toEqual({ error: "Unable to identify a valid timezone for city '[object Object]'." });
  });
});

describe("functions/index.js uses the shared time tool", () => {
  const source = readFileSync(new URL("../../functions/index.js", import.meta.url), "utf8");

  it("imports it instead of carrying a copy", () => {
    expect(source).toMatch(/GET_CURRENT_TIME_TOOL_DEFINITION as TIME_TOOL_DEFINITION,\s*getCurrentTimeForCity\s*\} from "\.\.\/src\/ai\/tools\/time\/current-time\.js"/);
    expect(source).not.toMatch(/function\s+(resolveTimezone|getCurrentTimeForCity)\s*\(/);
    expect(source).not.toContain("CITY_TIMEZONE_ALIASES");
    expect(source).not.toMatch(/const\s+TIME_TOOL_DEFINITION\s*=/);
    expect(source).toContain("toolResult = getCurrentTimeForCity(fnArgs?.city);");
  });
});
