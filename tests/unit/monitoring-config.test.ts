import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * scripts/monitoring/{metrics,policies}/*.json are applied to production by
 * scripts/monitoring/setup-alerts.sh. These checks keep them consistent with
 * each other and with the log events the code really emits, so renaming an
 * event (or a field an alert filters on) cannot silently disable an alert.
 */
const ROOT = join(__dirname, "..", "..");
const METRICS_DIR = join(ROOT, "scripts/monitoring/metrics");
const POLICIES_DIR = join(ROOT, "scripts/monitoring/policies");

type LogMetric = {
  description: string;
  filter: string;
  metricDescriptor: { metricKind: string; valueType: string; labels?: { key: string }[] };
  labelExtractors?: Record<string, string>;
};
type Policy = {
  displayName: string;
  severity: string;
  userLabels: Record<string, string>;
  notificationChannels?: string[];
  documentation: { content: string; subject?: string };
  alertStrategy: { autoClose: string };
  conditions: {
    conditionThreshold: {
      filter: string;
      comparison: string;
      thresholdValue: number;
      aggregations: { alignmentPeriod: string; perSeriesAligner: string }[];
    };
  }[];
};

function loadDir<T>(dir: string): Map<string, T> {
  const out = new Map<string, T>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    out.set(f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(dir, f), "utf8")) as T);
  }
  return out;
}

const metrics = loadDir<LogMetric>(METRICS_DIR);
const policies = loadDir<Policy>(POLICIES_DIR);
const emittingSources = [
  "functions/index.js",
  "functions/memory-persistence.js",
  "src/ai/providers/chat-fallback/chat-turn.ts"
].map((p) => readFileSync(join(ROOT, p), "utf8")).join("\n");

function userMetricOf(filter: string): string | null {
  return /metric\.type="logging\.googleapis\.com\/user\/([a-z0-9_]+)"/.exec(filter)?.[1] ?? null;
}

describe("monitoring definitions (scripts/monitoring)", () => {
  it("has the expected metrics and policies", () => {
    expect([...metrics.keys()]).toEqual([
      "alfred_app_check_rejections",
      "alfred_chat_failures",
      "alfred_container_startup_failures",
      "alfred_embedding_errors",
      "alfred_function_deploy_failures",
      "alfred_llm_stream_errors",
      "alfred_memory_extraction_failures",
      "alfred_provider_fallbacks",
      "alfred_rate_limit_giveups"
    ]);
    expect(policies.size).toBe(10);
  });

  it("defines every metric as a DELTA INT64 counter whose labels all have extractors", () => {
    for (const [name, m] of metrics) {
      expect(m.metricDescriptor.metricKind, name).toBe("DELTA");
      expect(m.metricDescriptor.valueType, name).toBe("INT64");
      expect(m.description.length, name).toBeGreaterThan(20);
      const keys = (m.metricDescriptor.labels ?? []).map((l) => l.key).sort();
      expect(Object.keys(m.labelExtractors ?? {}).sort(), name).toEqual(keys);
      for (const expr of Object.values(m.labelExtractors ?? {})) {
        expect(expr).toMatch(/^EXTRACT\((jsonPayload|resource\.labels)\.[a-z_]+\)$/);
      }
    }
  });

  it("only filters on log events the code actually emits", () => {
    for (const [name, m] of metrics) {
      const events = [...m.filter.matchAll(/jsonPayload\.event="([a-z_]+)"/g)].map((x) => x[1]);
      if (name === "alfred_container_startup_failures" || name === "alfred_function_deploy_failures") {
        expect(events, name).toEqual([]);
        continue;
      }
      expect(events.length, name).toBe(1);
      expect(emittingSources, `${name}: event ${events[0]}`).toMatch(new RegExp(`["']${events[0]}["']`));
    }
  });

  it("filters on the outcome values the code logs", () => {
    expect(metrics.get("alfred_chat_failures")!.filter).toContain('jsonPayload.outcome="error"');
    expect(emittingSources).toMatch(/logEvent\(outcome === "ok" \? "INFO" : "ERROR", "llm_request"/);
    expect(metrics.get("alfred_memory_extraction_failures")!.filter).toContain('("failed" OR "timeout")');
    expect(emittingSources).toMatch(/outcome: timedOut \? "timeout" : "failed"/);
    expect(metrics.get("alfred_app_check_rejections")!.filter).toContain("NOT jsonPayload.exempt=true");
    expect(emittingSources).toMatch(/outcome: "invalid", path, exempt: isAppCheckExempt\(path\)/);
    expect(metrics.get("alfred_rate_limit_giveups")!.filter).toContain('NOT jsonPayload.outcome="retry"');
    expect(emittingSources).toMatch(/outcome: decision\.retry \? "retry" : decision\.reason/);
  });

  it("points every policy at a defined metric (or Cloud Run's request_count) and uses every metric", () => {
    const used = new Set<string>();
    for (const [key, p] of policies) {
      for (const c of p.conditions) {
        const filter = c.conditionThreshold.filter;
        const metric = userMetricOf(filter);
        if (metric) {
          expect(metrics.has(metric), `${key} -> ${metric}`).toBe(true);
          used.add(metric);
        } else {
          expect(filter, key).toContain('metric.type="run.googleapis.com/request_count"');
          expect(filter, key).toContain('response_code_class="5xx"');
        }
      }
    }
    expect([...used].sort()).toEqual([...metrics.keys()]);
  });

  it("gives every policy a label, auto-close, severity, runbook and no hard-coded channel", () => {
    for (const [key, p] of policies) {
      expect(p.userLabels, key).toEqual({ managed_by: "alfred-setup-alerts", alfred_alert: key });
      expect(p.alertStrategy.autoClose, key).toMatch(/^\d+s$/);
      expect(["CRITICAL", "ERROR", "WARNING"], key).toContain(p.severity);
      expect(p.notificationChannels, key).toBeUndefined();
      expect(p.documentation.content, key).toContain("docs/OPERATIONS.md");
      for (const c of p.conditions) {
        expect(c.conditionThreshold.comparison, key).toBe("COMPARISON_GT");
        expect(c.conditionThreshold.aggregations[0].perSeriesAligner, key).toBe("ALIGN_SUM");
      }
    }
    expect(new Set([...policies.values()].map((p) => p.displayName)).size).toBe(policies.size);
  });

  it("alerts on the first final chat failure and on the first startup failure", () => {
    expect(policies.get("chat_failures")!.conditions[0].conditionThreshold.thresholdValue).toBe(0);
    expect(policies.get("container_startup_failures")!.conditions[0].conditionThreshold.thresholdValue).toBe(0);
  });
});
