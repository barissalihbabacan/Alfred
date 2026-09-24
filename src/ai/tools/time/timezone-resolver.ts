/**
 * B.U.T.L.E.R. Alfred — Timezone Resolver
 * Resolves a city name or IANA zone to an IANA timezone identifier.
 *
 * Shared with functions/index.js (bundled via esbuild): this is exactly the
 * resolution production's get_current_time tool uses. Keep it pure (no I/O,
 * no imports with side effects).
 *
 * Every input the original production resolver handled still resolves to the
 * same zone (pinned by tests/unit/functions-time-tool-contract.test.ts); the
 * later steps only add matches where it returned nothing.
 */

/**
 * Cities (and Turkish exonyms) looked up before the Intl scan, keyed by the
 * normalized input: diacritics folded (İ/ı -> i, ş -> s, ü -> u, ...),
 * lower-cased, "," and "." removed, whitespace collapsed.
 */
export const CITY_TIMEZONE_ALIASES: Readonly<Record<string, string>> = {
  // --- original production table -------------------------------------------
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
  "gmt": "Etc/GMT",

  // --- Turkey -----------------------------------------------------------------
  "turkiye": "Europe/Istanbul",
  "turkey": "Europe/Istanbul",
  "bursa": "Europe/Istanbul",
  "antalya": "Europe/Istanbul",
  "adana": "Europe/Istanbul",
  "konya": "Europe/Istanbul",
  "gaziantep": "Europe/Istanbul",
  "kayseri": "Europe/Istanbul",
  "eskisehir": "Europe/Istanbul",
  "trabzon": "Europe/Istanbul",
  "samsun": "Europe/Istanbul",
  "diyarbakir": "Europe/Istanbul",
  "sanliurfa": "Europe/Istanbul",
  "mersin": "Europe/Istanbul",
  "kocaeli": "Europe/Istanbul",
  "izmit": "Europe/Istanbul",
  "bodrum": "Europe/Istanbul",
  "mugla": "Europe/Istanbul",
  "canakkale": "Europe/Istanbul",
  "edirne": "Europe/Istanbul",
  "erzurum": "Europe/Istanbul",
  "van": "Europe/Istanbul",
  "kadikoy": "Europe/Istanbul",
  "besiktas": "Europe/Istanbul",
  "uskudar": "Europe/Istanbul",

  // --- Turkish names for foreign cities ----------------------------------------
  "londra": "Europe/London",
  "munih": "Europe/Berlin",
  "moskova": "Europe/Moscow",
  "roma": "Europe/Rome",
  "viyana": "Europe/Vienna",
  "atina": "Europe/Athens",
  "kahire": "Africa/Cairo",
  "pekin": "Asia/Shanghai",
  "bruksel": "Europe/Brussels",
  "lizbon": "Europe/Lisbon",
  "prag": "Europe/Prague",
  "varsova": "Europe/Warsaw",
  "kopenhag": "Europe/Copenhagen",
  "cenevre": "Europe/Zurich",
  "zurih": "Europe/Zurich",
  "yeni delhi": "Asia/Kolkata",
  "baku": "Asia/Baku",
  "tiflis": "Asia/Tbilisi",
  "tahran": "Asia/Tehran",
  "sidney": "Australia/Sydney",
  "budapeste": "Europe/Budapest",
  "bukres": "Europe/Bucharest",
  "sofya": "Europe/Sofia",
  "belgrad": "Europe/Belgrade",
  "riyad": "Asia/Riyadh",
  "seul": "Asia/Seoul",
  "singapur": "Asia/Singapore",
  "meksiko": "America/Mexico_City",
  "bagdat": "Asia/Baghdad",
  "kudus": "Asia/Jerusalem",
  "lefkosa": "Asia/Nicosia",
  "almanya": "Europe/Berlin",
  "ingiltere": "Europe/London",
  "fransa": "Europe/Paris",
  "japonya": "Asia/Tokyo",
  "amerika": "America/New_York",

  // --- major cities not reachable through an IANA zone name ----------------
  "munich": "Europe/Berlin",
  "munchen": "Europe/Berlin",
  "wien": "Europe/Vienna",
  "moskva": "Europe/Moscow",
  "hamburg": "Europe/Berlin",
  "cologne": "Europe/Berlin",
  "koln": "Europe/Berlin",
  "geneva": "Europe/Zurich",
  "milan": "Europe/Rome",
  "barcelona": "Europe/Madrid",
  "lyon": "Europe/Paris",
  "brussels": "Europe/Brussels",
  "st petersburg": "Europe/Moscow",
  "saint petersburg": "Europe/Moscow",
  "mumbai": "Asia/Kolkata",
  "delhi": "Asia/Kolkata",
  "new delhi": "Asia/Kolkata",
  "bangalore": "Asia/Kolkata",
  "bengaluru": "Asia/Kolkata",
  "hyderabad": "Asia/Kolkata",
  "chennai": "Asia/Kolkata",
  "abu dhabi": "Asia/Dubai",
  "hangzhou": "Asia/Shanghai",
  "shenzhen": "Asia/Shanghai",
  "guangzhou": "Asia/Shanghai",
  "hong kong": "Asia/Hong_Kong",
  "miami": "America/New_York",
  "atlanta": "America/New_York",
  "philadelphia": "America/New_York",
  "nyc": "America/New_York",
  "new york city": "America/New_York",
  "houston": "America/Chicago",
  "dallas": "America/Chicago",
  "austin": "America/Chicago",
  "san diego": "America/Los_Angeles",
  "las vegas": "America/Los_Angeles",
  "san jose": "America/Los_Angeles",
  "portland": "America/Los_Angeles",
  "salt lake city": "America/Denver",
  "rio": "America/Sao_Paulo",
  "rio de janeiro": "America/Sao_Paulo",
  "ottawa": "America/Toronto",
  "montreal": "America/Toronto",
  "calgary": "America/Edmonton",
  "canberra": "Australia/Sydney",
  "wellington": "Pacific/Auckland",
  "cape town": "Africa/Johannesburg"
};

/**
 * Trailing country names dropped when the full input does not resolve
 * ("Istanbul Turkey", "Paris France"). Normalized form.
 */
const TRAILING_COUNTRIES = [
  "turkiye", "turkey", "tr",
  "united kingdom", "uk", "england", "scotland", "great britain", "ingiltere",
  "united states", "usa", "us", "america", "abd",
  "germany", "almanya", "deutschland",
  "france", "fransa",
  "italy", "italya", "spain", "ispanya", "netherlands", "hollanda",
  "japan", "japonya", "china", "cin", "india", "hindistan",
  "canada", "kanada", "australia", "avustralya", "brazil", "brezilya",
  "russia", "rusya", "switzerland", "isvicre", "uae", "bae"
];

export interface ResolvedTimezone {
  timezone: string;
  /** The caller's input, trimmed (not the normalized form). */
  matchedCity: string;
}

/**
 * Folds diacritics so Turkish and accented spellings match the ASCII tables:
 * "İstanbul" -> "istanbul" (JS lower-cases İ to "i" + U+0307), "Eskişehir" ->
 * "eskisehir", "München" -> "munchen", "São Paulo" -> "sao paulo".
 */
function foldDiacritics(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i");
}

function normalize(s: string): string {
  return foldDiacritics(s.trim()).replace(/[,.]/g, "").replace(/\s+/g, " ").trim();
}

/** Aliases, then the Intl zone-name scan — the original production lookup. */
function lookup(cleaned: string): string | undefined {
  if (!cleaned) return undefined;
  if (Object.prototype.hasOwnProperty.call(CITY_TIMEZONE_ALIASES, cleaned)) {
    return CITY_TIMEZONE_ALIASES[cleaned];
  }
  try {
    const underscored = "/" + cleaned.replace(/\s+/g, "_");
    for (const z of Intl.supportedValuesOf("timeZone")) {
      const lower = z.toLowerCase();
      if (lower === cleaned || lower.endsWith(underscored)) return z;
    }
  } catch {
    // Intl.supportedValuesOf unavailable: aliases only.
  }
  return undefined;
}

/**
 * A zone name Intl accepts directly (e.g. "US/Eastern"), canonicalized. Only
 * "Area/Location" names: bare abbreviations like "EST" canonicalize to
 * surprising zones (America/Panama) and are better left unresolved.
 */
function intlCanonical(input: string): string | undefined {
  const candidate = input.trim().replace(/\s+/g, "_");
  if (!candidate.includes("/")) return undefined;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: candidate }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function accepted(tz: string | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves a city or zone name, trying in order until one yields a zone that
 * `Intl.DateTimeFormat` accepts:
 * 1. the full normalized input against CITY_TIMEZONE_ALIASES, then against
 *    `Intl.supportedValuesOf("timeZone")` (exact lower-cased name, or ending
 *    with "/" + input with spaces as underscores: "sao paulo" ->
 *    America/Sao_Paulo) — the original production behaviour;
 * 2. the text before the first comma, when a known country follows it
 *    ("London, UK" -> "london"; "Paris, Texas" stays unresolved);
 * 3. the text before a Turkish case-suffix apostrophe ("İstanbul'da" -> "istanbul");
 * 4. the input with a trailing country name removed ("Paris France" -> "paris");
 * 5. an "Area/Location" name Intl itself accepts, canonicalized
 *    ("US/Eastern" -> "America/New_York").
 * Non-string or empty input returns null.
 */
export function resolveTimezone(cityOrZone: unknown): ResolvedTimezone | null {
  if (!cityOrZone || typeof cityOrZone !== "string") return null;
  const raw = cityOrZone.trim();
  const cleaned = normalize(raw);

  const candidates: string[] = [cleaned];
  // "London, UK" -> "london", but only when what follows the comma is a known
  // country: "Paris, Texas" must not become Europe/Paris.
  const commaAt = raw.indexOf(",");
  if (commaAt > 0 && TRAILING_COUNTRIES.includes(normalize(raw.slice(commaAt + 1)))) {
    candidates.push(normalize(raw.slice(0, commaAt)));
  }
  const beforeApostrophe = normalize(raw.split(/['’]/)[0] ?? "");
  if (beforeApostrophe !== cleaned) candidates.push(beforeApostrophe);
  for (const country of TRAILING_COUNTRIES) {
    if (cleaned.endsWith(" " + country)) {
      candidates.push(cleaned.slice(0, -(country.length + 1)).trim());
    }
  }

  for (const candidate of candidates) {
    const tz = lookup(candidate);
    if (accepted(tz)) return { timezone: tz, matchedCity: raw };
  }

  const direct = intlCanonical(raw);
  if (accepted(direct)) return { timezone: direct, matchedCity: raw };
  return null;
}
