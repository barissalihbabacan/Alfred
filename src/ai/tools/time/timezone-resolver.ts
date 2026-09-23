/**
 * B.U.T.L.E.R. Alfred — Timezone Resolver
 * Dynamically resolves cities and geographical locations to official IANA timezone identifiers.
 * Leverages native ECMAScript Intl API and curated alias tables for comprehensive global coverage.
 */

// Major world metropolitan cities and regions that share timezone with other canonical IANA hubs
const CITY_TIMEZONE_ALIASES: Record<string, string> = {
  // United States & Canada
  "san francisco": "America/Los_Angeles",
  "san jose": "America/Los_Angeles",
  "san diego": "America/Los_Angeles",
  "seattle": "America/Los_Angeles",
  "las vegas": "America/Los_Angeles",
  "portland": "America/Los_Angeles",
  "washington": "America/New_York",
  "washington dc": "America/New_York",
  "dc": "America/New_York",
  "boston": "America/New_York",
  "miami": "America/New_York",
  "atlanta": "America/New_York",
  "philadelphia": "America/New_York",
  "pittsburgh": "America/New_York",
  "dallas": "America/Chicago",
  "houston": "America/Chicago",
  "austin": "America/Chicago",
  "minneapolis": "America/Chicago",
  "denver": "America/Denver",
  "phoenix": "America/Phoenix",
  "salt lake city": "America/Denver",
  "montreal": "America/Toronto",
  "ottawa": "America/Toronto",
  "calgary": "America/Edmonton",

  // United Kingdom & Ireland
  "manchester": "Europe/London",
  "birmingham": "Europe/London",
  "edinburgh": "Europe/London",
  "glasgow": "Europe/London",
  "belfast": "Europe/Belfast",

  // Turkey
  "ankara": "Europe/Istanbul",
  "izmir": "Europe/Istanbul",
  "bursa": "Europe/Istanbul",
  "antalya": "Europe/Istanbul",
  "adana": "Europe/Istanbul",

  // Europe
  "frankfurt": "Europe/Berlin",
  "munich": "Europe/Berlin",
  "hamburg": "Europe/Berlin",
  "cologne": "Europe/Berlin",
  "milan": "Europe/Rome",
  "naples": "Europe/Rome",
  "barcelona": "Europe/Madrid",
  "valencia": "Europe/Madrid",
  "seville": "Europe/Madrid",
  "lyon": "Europe/Paris",
  "marseille": "Europe/Paris",
  "geneva": "Europe/Zurich",
  "basel": "Europe/Zurich",
  "rotterdam": "Europe/Amsterdam",
  "the hague": "Europe/Amsterdam",
  "antwerp": "Europe/Brussels",
  "krakow": "Europe/Warsaw",
  "porto": "Europe/Lisbon",

  // Asia & Middle East
  "beijing": "Asia/Shanghai",
  "guangzhou": "Asia/Shanghai",
  "shenzhen": "Asia/Shanghai",
  "kyoto": "Asia/Tokyo",
  "osaka": "Asia/Tokyo",
  "yokohama": "Asia/Tokyo",
  "mumbai": "Asia/Kolkata",
  "delhi": "Asia/Kolkata",
  "new delhi": "Asia/Kolkata",
  "bangalore": "Asia/Kolkata",
  "bengaluru": "Asia/Kolkata",
  "hyderabad": "Asia/Kolkata",
  "chennai": "Asia/Kolkata",
  "abu dhabi": "Asia/Dubai",
  "tel aviv": "Asia/Jerusalem",
  "riyadh": "Asia/Riyadh",

  // Australia & New Zealand
  "canberra": "Australia/Sydney",
  "brisbane": "Australia/Brisbane",
  "perth": "Australia/Perth",
  "adelaide": "Australia/Adelaide",
  "wellington": "Pacific/Auckland",
  "christchurch": "Pacific/Auckland",

  // South America
  "rio de janeiro": "America/Sao_Paulo",
  "rio": "America/Sao_Paulo",
  "brasilia": "America/Sao_Paulo",
  "medellin": "America/Bogota",

  // Africa
  "cape town": "Africa/Johannesburg",
  "alexandria": "Africa/Cairo"
};

export interface ResolvedTimezone {
  timezone: string;
  matchedCity: string;
}

class TimezoneResolver {
  private cityToIanaMap = new Map<string, string>();

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    // 1. Index all standard IANA timezones supported natively by the runtime
    try {
      const supportedZones = Intl.supportedValuesOf("timeZone");
      for (const zone of supportedZones) {
        // Full lowercased zone e.g. "europe/london"
        this.cityToIanaMap.set(zone.toLowerCase(), zone);

        // Extract city portion (last segment after slash)
        const parts = zone.split("/");
        const cityPart = parts[parts.length - 1];
        if (cityPart) {
          // e.g. "New_York" -> "new york" and "new_york"
          const normalizedWithUnderscore = cityPart.toLowerCase();
          const normalizedWithSpace = cityPart.toLowerCase().replace(/_/g, " ");

          // Store city part if not already claimed by a higher-priority match
          if (!this.cityToIanaMap.has(normalizedWithSpace)) {
            this.cityToIanaMap.set(normalizedWithSpace, zone);
          }
          if (!this.cityToIanaMap.has(normalizedWithUnderscore)) {
            this.cityToIanaMap.set(normalizedWithUnderscore, zone);
          }
        }
      }
    } catch {
      // Fallback if Intl.supportedValuesOf is not supported
    }

    // 2. Add aliases for secondary major cities
    for (const [alias, zone] of Object.entries(CITY_TIMEZONE_ALIASES)) {
      this.cityToIanaMap.set(alias.toLowerCase(), zone);
    }

    // 3. Add standard UTC/GMT variants
    this.cityToIanaMap.set("utc", "UTC");
    this.cityToIanaMap.set("gmt", "Etc/GMT");
    this.cityToIanaMap.set("zulu", "UTC");
  }

  /**
   * Normalizes a city or timezone input string.
   */
  private normalize(input: string): string {
    return input
      .trim()
      .toLowerCase()
      .replace(/[,.]/g, "")
      .replace(/\s+/g, " ");
  }

  /**
   * Resolves a city name or timezone string into a valid IANA timezone.
   * Returns null if the city cannot be resolved to a valid timezone.
   */
  public resolve(cityOrZone: string): ResolvedTimezone | null {
    if (!cityOrZone || typeof cityOrZone !== "string") {
      return null;
    }

    const cleaned = this.normalize(cityOrZone);
    if (!cleaned) {
      return null;
    }

    // 1. Direct map lookup
    let targetZone = this.cityToIanaMap.get(cleaned);

    // 2. Try stripping prefixes or suffixes (e.g. "city of london" -> "london", "london uk" -> "london")
    if (!targetZone) {
      const stripped = cleaned
        .replace(/^(city of|the city of)\s+/i, "")
        .replace(/\s+(city|town|metropolitan area)$/i, "")
        .trim();
      targetZone = this.cityToIanaMap.get(stripped);
    }

    // 3. Try splitting comma (e.g. "London, UK" -> "london")
    if (!targetZone && cleaned.includes(" ")) {
      const firstWord = cleaned.split(" ")[0];
      if (this.cityToIanaMap.has(firstWord)) {
        targetZone = this.cityToIanaMap.get(firstWord);
      }
    }

    // 4. Validate resolved timezone with Intl
    if (targetZone) {
      if (this.isValidIana(targetZone)) {
        return {
          timezone: targetZone,
          matchedCity: cityOrZone.trim()
        };
      }
    }

    // 5. Check if input itself is a valid IANA timezone string directly
    if (this.isValidIana(cityOrZone.trim())) {
      return {
        timezone: cityOrZone.trim(),
        matchedCity: cityOrZone.trim()
      };
    }

    return null;
  }

  /**
   * Validates whether a given timezone string is accepted by Intl.DateTimeFormat.
   */
  public isValidIana(timeZone: string): boolean {
    try {
      new Intl.DateTimeFormat(undefined, { timeZone });
      return true;
    } catch {
      return false;
    }
  }
}

export const timezoneResolver = new TimezoneResolver();
