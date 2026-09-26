import { describe, it, expect } from "vitest";
import { GetCurrentTimeTool } from "../../src/ai/tools/time/get-current-time.tool.js";
import { GET_CURRENT_TIME_TOOL_DEFINITION, type CurrentTimeResult } from "../../src/ai/tools/time/current-time.js";
import { CITY_TIMEZONE_ALIASES, isZoneInCountry, resolveTimezone } from "../../src/ai/tools/time/timezone-resolver.js";
import { PermissionLevel } from "../../src/alfred/control-plane/permission-system/types.js";

describe("GetCurrentTimeTool & TimezoneResolver Suite", () => {
  const timeTool = new GetCurrentTimeTool();

  describe("resolveTimezone", () => {
    it("resolves major world capitals and hub cities", () => {
      expect(resolveTimezone("London")?.timezone).toBe("Europe/London");
      expect(resolveTimezone("Tokyo")?.timezone).toBe("Asia/Tokyo");
      expect(resolveTimezone("Istanbul")?.timezone).toBe("Europe/Istanbul");
      expect(resolveTimezone("New York")?.timezone).toBe("America/New_York");
      expect(resolveTimezone("Paris")?.timezone).toBe("Europe/Paris");
      expect(resolveTimezone("Berlin")?.timezone).toBe("Europe/Berlin");
      expect(resolveTimezone("Sydney")?.timezone).toBe("Australia/Sydney");
    });

    it("resolves cities that share regional timezones via the alias table", () => {
      expect(resolveTimezone("San Francisco")?.timezone).toBe("America/Los_Angeles");
      expect(resolveTimezone("Seattle")?.timezone).toBe("America/Los_Angeles");
      expect(resolveTimezone("Ankara")?.timezone).toBe("Europe/Istanbul");
      expect(resolveTimezone("Izmir")?.timezone).toBe("Europe/Istanbul");
      expect(resolveTimezone("Frankfurt")?.timezone).toBe("Europe/Berlin");
      expect(resolveTimezone("Manchester")?.timezone).toBe("Europe/London");
      expect(resolveTimezone("Beijing")?.timezone).toBe("Asia/Shanghai");
    });

    it("handles case-insensitivity and whitespace normalization", () => {
      expect(resolveTimezone("  lOnDoN  ")?.timezone).toBe("Europe/London");
      expect(resolveTimezone("new   york")?.timezone).toBe("America/New_York");
      expect(resolveTimezone("SAN FRANCISCO")?.timezone).toBe("America/Los_Angeles");
    });

    it("resolves IANA identifiers, zone city segments and UTC/GMT", () => {
      expect(resolveTimezone("UTC")?.timezone).toBe("UTC");
      expect(resolveTimezone("GMT")?.timezone).toBe("Etc/GMT");
      expect(resolveTimezone("Europe/London")?.timezone).toBe("Europe/London");
      expect(resolveTimezone("Asia/Tokyo")?.timezone).toBe("Asia/Tokyo");
      expect(resolveTimezone("Sao Paulo")?.timezone).toBe("America/Sao_Paulo");
    });

    it("returns null for non-existent or invalid locations", () => {
      expect(resolveTimezone("Atlantis")).toBeNull();
      expect(resolveTimezone("Narnia")).toBeNull();
      expect(resolveTimezone("")).toBeNull();
      expect(resolveTimezone(undefined)).toBeNull();
      expect(resolveTimezone(42)).toBeNull();
    });

    it("does not answer with a same-named city in another country", () => {
      for (const input of [
        "London, Canada", "Birmingham, USA", "Sydney, Canada", "Perth, UK", "Cordoba, Spain",
        "Cordoba Spain", "Santiago, Spain", "Merida, Spain", "London Kanada", "Paris, Texas"
      ]) {
        expect(resolveTimezone(input), input).toBeNull();
      }
    });

    it("still resolves a city followed by its own country", () => {
      const cases: Array<[string, string]> = [
        ["London, UK", "Europe/London"], ["Istanbul Turkey", "Europe/Istanbul"], ["İstanbul, Türkiye", "Europe/Istanbul"],
        ["New York, USA", "America/New_York"], ["Seattle, ABD", "America/Los_Angeles"], ["Toronto, Canada", "America/Toronto"],
        ["Sydney, Australia", "Australia/Sydney"], ["Berlin, Almanya", "Europe/Berlin"], ["Paris France", "Europe/Paris"],
        ["Madrid, Spain", "Europe/Madrid"], ["Tokyo, Japan", "Asia/Tokyo"], ["Beijing, China", "Asia/Shanghai"],
        ["Moscow, Russia", "Europe/Moscow"], ["Sao Paulo, Brazil", "America/Sao_Paulo"], ["Zurich, Switzerland", "Europe/Zurich"],
        ["Dubai, UAE", "Asia/Dubai"], ["Rome, Italy", "Europe/Rome"], ["Amsterdam, Netherlands", "Europe/Amsterdam"]
      ];
      for (const [input, zone] of cases) expect(resolveTimezone(input)?.timezone, input).toBe(zone);
    });

    it("with a country, answers either the city's own zone inside that country or nothing", () => {
      const countries = ["UK", "USA", "Canada", "Australia", "Spain", "Germany", "Turkey", "Japan", "Brazil", "Russia"];
      const codes: Record<string, string> = { UK: "gb", USA: "us", Canada: "ca", Australia: "au", Spain: "es", Germany: "de", Turkey: "tr", Japan: "jp", Brazil: "br", Russia: "ru" };
      for (const [city, zone] of Object.entries(CITY_TIMEZONE_ALIASES)) {
        for (const country of countries) {
          const result = resolveTimezone(`${city}, ${country}`);
          if (isZoneInCountry(zone, codes[country])) expect(result?.timezone, `${city}, ${country}`).toBe(zone);
          else if (result) expect(isZoneInCountry(result.timezone, codes[country]), `${city}, ${country} -> ${result.timezone}`).toBe(true);
        }
      }
    }, 60_000);
  });

  describe("GetCurrentTimeTool Definition & Validation", () => {
    it("declares standard properties, READ_ONLY permission, and production's schema", () => {
      expect(timeTool.name).toBe("get_current_time");
      expect(timeTool.permissionLevel).toBe(PermissionLevel.READ_ONLY);
      expect(timeTool.description).toContain("local time");

      const def = timeTool.getDefinition();
      expect(def).toEqual(GET_CURRENT_TIME_TOOL_DEFINITION);
      expect(def.function.parameters.required).toEqual(["cities"]);
    });

    it("passes the city through untouched, as production does", () => {
      expect(timeTool.validateArgs({ city: "London" })).toEqual({ valid: true, parsedArgs: { city: "London" } });
      expect(timeTool.validateArgs({ city: "  London " }).parsedArgs?.city).toBe("  London ");
      expect(timeTool.validateArgs({}).parsedArgs?.city).toBeUndefined();
      expect(timeTool.validateArgs("London")).toEqual({ valid: true, parsedArgs: { city: undefined } });
    });
  });

  describe("GetCurrentTimeTool Execution", () => {
    it("returns structured time details for London", async () => {
      // The legacy { city } form returns a single result, not { results }.
      const result = (await timeTool.execute({ city: "London" })) as CurrentTimeResult;
      expect(Object.keys(result).sort()).toEqual(["city", "date", "localTime", "time24", "timezone", "utcOffset"]);
      expect(result.city).toBe("London");
      expect(result.timezone).toBe("Europe/London");
      expect(result.localTime).toMatch(/\d{1,2}:\d{2}\s+(AM|PM)/i);
      expect(result.time24).toMatch(/\d{2}:\d{2}/);
      expect(result.date).toBeDefined();
      expect(result.utcOffset).toMatch(/^GMT/);
    });

    it("returns structured time details for Tokyo", async () => {
      const result = (await timeTool.execute({ city: "Tokyo" })) as CurrentTimeResult;
      expect(result.city).toBe("Tokyo");
      expect(result.timezone).toBe("Asia/Tokyo");
      expect(result.utcOffset).toBe("GMT+9");
    });

    it("throws production's error text for an unresolvable city", async () => {
      await expect(timeTool.execute({ city: "Gondor" })).rejects.toThrow(
        "Unable to identify a valid timezone for city 'Gondor'."
      );
      await expect(timeTool.execute({})).rejects.toThrow(
        "Unable to identify a valid timezone for city 'undefined'."
      );
    });
  });
});
