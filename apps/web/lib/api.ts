import type { User } from "firebase/auth";
import { getAppCheckToken } from "./firebase";
import { getFirebaseAuth } from "./auth";
import { getLang, translate } from "./i18n";

/**
 * Tum backend cagrilari buradan gecer. Hedef, Firebase Hosting'in /api/**
 * rewrite'i ile ulasilan `api` Cloud Function'idir (functions/index.js).
 *
 * `/` ve `/health` disindaki her uc nokta `Authorization: Bearer <ID token>`
 * ister; kullanici kimligi sunucuda token'dan okunur. Bu yuzden oturum
 * acilmadan yapilan cagrilar sunucuya hic gitmeden reddedilir.
 */
export const API_BASE = "/api";

/**
 * Base for requests whose response must stream (POST /chat, SSE). Firebase
 * Hosting buffers responses from its /api/** rewrite: measured in production,
 * every event of a chat turn reached the browser in the same millisecond, at
 * the end. So streaming requests go straight to the function (same auth: ID
 * token + App Check; the function allows CORS). `next dev` keeps /api, which
 * it proxies to ALFRED_API_ORIGIN. Override with NEXT_PUBLIC_STREAM_API_BASE.
 */
export const STREAM_API_BASE =
  process.env.NEXT_PUBLIC_STREAM_API_BASE ||
  (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    ? `https://us-central1-${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.cloudfunctions.net/api`
    : API_BASE);

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
  /** Groq'un istedigi gercek bekleme (biliniyorsa). */
  readonly retryAfterMs?: number;
  /** Hangi limit: tpm | tpd | rpm | rpd | unknown (yalnizca `rate_limited`). */
  readonly limitType?: string;
  constructor(message: string, code?: string, retryAfterMs?: number, limitType?: string) {
    super(message);
    this.name = "ChatStreamError";
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.limitType = limitType;
  }
}

export interface ApiDeps {
  getUser: () => User | null;
  getAppCheckToken: () => Promise<string | null>;
  fetchImpl: typeof fetch;
  /** Base for `stream: true` requests; defaults to STREAM_API_BASE. */
  streamBase?: string;
}

const defaultDeps: ApiDeps = {
  getUser: () => getFirebaseAuth().currentUser,
  getAppCheckToken,
  fetchImpl: (...args) => fetch(...args)
};

export interface ApiRequestInit extends RequestInit {
  /** true ise ID token eklenmez (yalnizca /health gibi acik uc noktalar icin). */
  anonymous?: boolean;
  /** true: the response streams (SSE), so bypass Hosting (see STREAM_API_BASE). */
  stream?: boolean;
}

export async function apiFetch(
  path: string,
  init: ApiRequestInit = {},
  deps: ApiDeps = defaultDeps
): Promise<Response> {
  const { anonymous, stream, headers: extraHeaders, ...rest } = init;
  const headers = new Headers(extraHeaders);

  if (!anonymous) {
    const user = deps.getUser();
    if (!user) {
      throw new ApiError(401, translate(getLang(), "api.notSignedIn"));
    }
    // getIdToken() suresi dolmus token'i kendiliginden yeniler.
    headers.set("Authorization", `Bearer ${await user.getIdToken()}`);
  }

  const appCheckToken = await deps.getAppCheckToken().catch(() => null);
  if (appCheckToken) {
    headers.set("X-Firebase-AppCheck", appCheckToken);
  }

  const base = stream ? (deps.streamBase ?? STREAM_API_BASE) : API_BASE;
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  return deps.fetchImpl(url, { ...rest, headers });
}

/** Hata yanitindaki `{ error }` alanini okuyup ApiError firlatir. */
export async function ensureOk(res: Response): Promise<Response> {
  if (res.ok) return res;
  const data = await res.json().catch(() => ({} as { error?: string }));
  throw new ApiError(res.status, data?.error || translate(getLang(), "api.serverError", { status: res.status }));
}
