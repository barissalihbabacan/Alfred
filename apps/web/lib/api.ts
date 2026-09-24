import type { User } from "firebase/auth";
import { getAppCheckToken } from "./firebase";
import { getFirebaseAuth } from "./auth";

/**
 * Tum backend cagrilari buradan gecer. Hedef, Firebase Hosting'in /api/**
 * rewrite'i ile ulasilan `api` Cloud Function'idir (functions/index.js).
 *
 * `/` ve `/health` disindaki her uc nokta `Authorization: Bearer <ID token>`
 * ister; kullanici kimligi sunucuda token'dan okunur. Bu yuzden oturum
 * acilmadan yapilan cagrilar sunucuya hic gitmeden reddedilir.
 */
export const API_BASE = "/api";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * `/chat` akisindaki bir `error` olayi. `code` sunucunun verdigi makine kodudur
 * (`"rate_limited"`: Groq sinirinda vazgecildi); `message` kullaniciya
 * gosterilecek kisa metindir, ham saglayici cevabi degildir.
 */
export class ChatStreamError extends Error {
  readonly code?: string;
  readonly retryAfterMs?: number;
  constructor(message: string, code?: string, retryAfterMs?: number) {
    super(message);
    this.name = "ChatStreamError";
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface ApiDeps {
  getUser: () => User | null;
  getAppCheckToken: () => Promise<string | null>;
  fetchImpl: typeof fetch;
}

const defaultDeps: ApiDeps = {
  getUser: () => getFirebaseAuth().currentUser,
  getAppCheckToken,
  fetchImpl: (...args) => fetch(...args)
};

export interface ApiRequestInit extends RequestInit {
  /** true ise ID token eklenmez (yalnizca /health gibi acik uc noktalar icin). */
  anonymous?: boolean;
}

export async function apiFetch(
  path: string,
  init: ApiRequestInit = {},
  deps: ApiDeps = defaultDeps
): Promise<Response> {
  const { anonymous, headers: extraHeaders, ...rest } = init;
  const headers = new Headers(extraHeaders);

  if (!anonymous) {
    const user = deps.getUser();
    if (!user) {
      throw new ApiError(401, "Oturum henüz doğrulanmadı.");
    }
    // getIdToken() suresi dolmus token'i kendiliginden yeniler.
    headers.set("Authorization", `Bearer ${await user.getIdToken()}`);
  }

  const appCheckToken = await deps.getAppCheckToken().catch(() => null);
  if (appCheckToken) {
    headers.set("X-Firebase-AppCheck", appCheckToken);
  }

  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  return deps.fetchImpl(url, { ...rest, headers });
}

/** Hata yanitindaki `{ error }` alanini okuyup ApiError firlatir. */
export async function ensureOk(res: Response): Promise<Response> {
  if (res.ok) return res;
  const data = await res.json().catch(() => ({} as { error?: string }));
  throw new ApiError(res.status, data?.error || `Sunucu hatası (${res.status})`);
}
