import { describe, it, expect } from "vitest";
import { NO_EXIT_STATUS_CODE, toExecResult } from "../../src/alfred/execution-plane/ssh/ssh2-client.js";

describe("toExecResult (ssh2 exec channel close)", () => {
  it("passes a real exit status through", () => {
    expect(toExecResult([Buffer.from("ok\n")], [], 0)).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
    expect(toExecResult([], [Buffer.from("nope")], 2)).toEqual({ stdout: "", stderr: "nope", exitCode: 2 });
  });

  it("never reports success for a command killed by a signal", () => {
    const r = toExecResult([Buffer.from("partial listing")], [], null, "SIGKILL");
    expect(r.exitCode).toBe(NO_EXIT_STATUS_CODE);
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).toBe("partial listing");
    expect(r.stderr).toBe("[ssh] Remote command terminated by signal SIGKILL.");
  });

  it("never reports success for a channel closed without an exit status", () => {
    const r = toExecResult([], [Buffer.from("warning")], undefined);
    expect(r).toEqual({ stdout: "", stderr: "warning\n[ssh] Remote command closed without an exit status.", exitCode: NO_EXIT_STATUS_CODE });
  });

  it("decodes a UTF-8 character split across two packets", () => {
    const bytes = Buffer.from("Şirket Ödevler", "utf8");
    // Split inside the two-byte "Ş".
    expect(toExecResult([bytes.subarray(0, 1), bytes.subarray(1)], [], 0).stdout).toBe("Şirket Ödevler");
  });
});
