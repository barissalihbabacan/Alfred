import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getNotificationPermissionState,
  saveFcmTokenToBackend,
  removeFcmTokenFromBackend,
  sendTestPushNotification,
  requestPushPermissionAndToken
} from "../../apps/web/lib/notifications.js";
import * as apiModule from "../../apps/web/lib/api.js";

describe("Web Notifications client (apps/web/lib/notifications.ts)", () => {
  const originalNotification = globalThis.Notification;
  const originalWindow = (globalThis as unknown as { window?: unknown }).window;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalNotification) {
      globalThis.Notification = originalNotification;
    } else {
      // @ts-expect-error cleanup
      delete globalThis.Notification;
    }

    if (originalWindow !== undefined) {
      (globalThis as unknown as { window?: unknown }).window = originalWindow;
    } else {
      delete (globalThis as unknown as { window?: unknown }).window;
    }
  });

  it("returns 'unsupported' when Notification API does not exist", () => {
    // @ts-expect-error simulation
    delete globalThis.Notification;
    expect(getNotificationPermissionState()).toBe("unsupported");
  });

  it("returns current permission state when Notification API exists", () => {
    (globalThis as unknown as { window: unknown }).window = globalThis;
    // @ts-expect-error mock Notification
    globalThis.Notification = {
      permission: "granted"
    };
    expect(getNotificationPermissionState()).toBe("granted");
  });

  it("handles requestPushPermissionAndToken when Notification is unsupported", async () => {
    // @ts-expect-error simulation
    delete globalThis.Notification;
    const res = await requestPushPermissionAndToken();
    expect(res.token).toBeNull();
    expect(res.error).toBe("Tarayıcınız bildirimleri desteklemiyor.");
  });

  it("handles requestPushPermissionAndToken when user denies permission", async () => {
    (globalThis as unknown as { window: unknown }).window = globalThis;
    (globalThis as unknown as { Notification: unknown }).Notification = {
      requestPermission: vi.fn(async () => "denied" as NotificationPermission),
      permission: "denied"
    };
    const res = await requestPushPermissionAndToken();
    expect(res.token).toBeNull();
    expect(res.error).toBe("Bildirim izni verilmedi.");
  });

  it("calls apiFetch with POST /notifications/fcm-token in saveFcmTokenToBackend", async () => {
    const apiFetchSpy = vi.spyOn(apiModule, "apiFetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    await saveFcmTokenToBackend("sample-fcm-token-123");

    expect(apiFetchSpy).toHaveBeenCalledTimes(1);
    const [path, init] = apiFetchSpy.mock.calls[0];
    expect(path).toBe("/notifications/fcm-token");
    expect(init?.method).toBe("POST");
    expect(init?.body).toContain("sample-fcm-token-123");
  });

  it("calls apiFetch with DELETE /notifications/fcm-token in removeFcmTokenFromBackend", async () => {
    const apiFetchSpy = vi.spyOn(apiModule, "apiFetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    await removeFcmTokenFromBackend("sample-fcm-token-123");

    expect(apiFetchSpy).toHaveBeenCalledTimes(1);
    const [path, init] = apiFetchSpy.mock.calls[0];
    expect(path).toBe("/notifications/fcm-token");
    expect(init?.method).toBe("DELETE");
    expect(init?.body).toContain("sample-fcm-token-123");
  });

  it("calls apiFetch with POST /notifications/test in sendTestPushNotification", async () => {
    const apiFetchSpy = vi.spyOn(apiModule, "apiFetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, message: "1 cihaza test bildirimi başarıyla gönderildi." }), { status: 200 })
    );

    const res = await sendTestPushNotification();

    expect(apiFetchSpy).toHaveBeenCalledTimes(1);
    const [path, init] = apiFetchSpy.mock.calls[0];
    expect(path).toBe("/notifications/test");
    expect(init?.method).toBe("POST");
    expect(res.success).toBe(true);
    expect(res.message).toBe("1 cihaza test bildirimi başarıyla gönderildi.");
  });
});
