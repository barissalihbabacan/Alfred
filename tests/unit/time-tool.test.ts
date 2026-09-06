import { describe, it, expect } from "vitest";
import { GetCurrentTimeTool } from "../../src/ai/tools/time/get-current-time.tool.js";
import { timezoneResolver } from "../../src/ai/tools/time/timezone-resolver.js";
import { PermissionLevel } from "../../src/alfred/control-plane/permission-system/types.js";

describe("GetCurrentTimeTool & TimezoneResolver Suite", () => {
  const timeTool = new GetCurrentTimeTool();

  describe("TimezoneResolver", () => {
    it("resolves major world capitals and hub cities", () => {
      expect(timezoneResolver.resolve("London")?.timezone).toBe("Europe/London");
      expect(timezoneResolver.resolve("Tokyo")?.timezone).toBe("Asia/Tokyo");
      expect(timezoneResolver.resolve("Istanbul")?.timezone).toBe("Europe/Istanbul");
      expect(timezoneResolver.resolve("New York")?.timezone).toBe("America/New_York");
      expect(timezoneResolver.resolve("Paris")?.timezone).toBe("Europe/Paris");
      expect(timezoneResolver.resolve("Berlin")?.timezone).toBe("Europe/Berlin");
      expect(timezoneResolver.resolve("Sydney")?.timezone).toBe("Australia/Sydney");
    });

    it("resolves cities that share regional timezones via alias index", () => {
      expect(timezoneResolver.resolve("San Francisco")?.timezone).toBe("America/Los_Angeles");
      expect(timezoneResolver.resolve("Seattle")?.timezone).toBe("America/Los_Angeles");
      expect(timezoneResolver.resolve("Ankara")?.timezone).toBe("Europe/Istanbul");
      expect(timezoneResolver.resolve("Izmir")?.timezone).toBe("Europe/Istanbul");
      expect(timezoneResolver.resolve("Frankfurt")?.timezone).toBe("Europe/Berlin");
      expect(timezoneResolver.resolve("Manchester")?.timezone).toBe("Europe/London");
      expect(timezoneResolver.resolve("Beijing")?.timezone).toBe("Asia/Shanghai");
    });

    it("handles case-insensitivity and whitespace normalization", () => {
      expect(timezoneResolver.resolve("  lOnDoN  ")?.timezone).toBe("Europe/London");
      expect(timezoneResolver.resolve("new   york")?.timezone).toBe("America/New_York");
      expect(timezoneResolver.resolve("SAN FRANCISCO")?.timezone).toBe("America/Los_Angeles");
    });

    it("resolves direct IANA identifiers and UTC/GMT", () => {
      expect(timezoneResolver.resolve("UTC")?.timezone).toBe("UTC");
      expect(timezoneResolver.resolve("Europe/London")?.timezone).toBe("Europe/London");
      expect(timezoneResolver.resolve("Asia/Tokyo")?.timezone).toBe("Asia/Tokyo");
    });

    it("returns null for non-existent or invalid locations", () => {
      expect(timezoneResolver.resolve("Atlantis")).toBeNull();
      expect(timezoneResolver.resolve("Narnia")).toBeNull();
      expect(timezoneResolver.resolve("")).toBeNull();
    });
  });

  describe("GetCurrentTimeTool Definition & Validation", () => {
    it("declares standard properties, READ_ONLY permission, and valid schema", () => {
      expect(timeTool.name).toBe("get_current_time");
      expect(timeTool.permissionLevel).toBe(PermissionLevel.READ_ONLY);
      expect(timeTool.description).toContain("local time");

      const def = timeTool.getDefinition();
      expect(def.type).toBe("function");
      expect(def.function.name).toBe("get_current_time");
      expect(def.function.parameters.type).toBe("object");
      expect(def.function.parameters.properties.city).toBeDefined();
      expect(def.function.parameters.required).toEqual(["city"]);
    });

    it("validates valid arguments correctly", () => {
      const valid = timeTool.validateArgs({ city: "London" });
      expect(valid.valid).toBe(true);
      expect(valid.parsedArgs?.city).toBe("London");
    });

    it("rejects missing or empty city argument", () => {
      const empty = timeTool.validateArgs({ city: "   " });
      expect(empty.valid).toBe(false);
      expect(empty.error).toContain("city");

      const missing = timeTool.validateArgs({});
      expect(missing.valid).toBe(false);

      const nonObj = timeTool.validateArgs("London");
      expect(nonObj.valid).toBe(false);
    });
  });

  describe("GetCurrentTimeTool Execution", () => {
    it("returns structured time details for London", async () => {
      const result = await timeTool.execute({ city: "London" });
      expect(result.city).toBe("London");
      expect(result.timezone).toBe("Europe/London");
      expect(result.localTime).toMatch(/\d{1,2}:\d{2}\s+(AM|PM)/i);
      expect(result.time24).toMatch(/\d{2}:\d{2}/);
      expect(result.date).toBeDefined();
      expect(result.dayOfWeek).toBeDefined();
      expect(result.utcOffset).toBeDefined();
      expect(typeof result.isDaytime).toBe("boolean");
    });

    it("returns structured time details for Tokyo", async () => {
      const result = await timeTool.execute({ city: "Tokyo" });
      expect(result.city).toBe("Tokyo");
      expect(result.timezone).toBe("Asia/Tokyo");
      expect(result.localTime).toBeDefined();
    });

    it("throws a clear error for an unresolvable city", async () => {
      await expect(timeTool.execute({ city: "Gondor" })).rejects.toThrow(
        /Unable to identify a valid timezone for city 'Gondor'/
      );
    });
  });
});
