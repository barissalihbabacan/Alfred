/**
 * `unknown` hata degerleri icin kucuk yardimcilar (catch bloklari, Firebase
 * hatalari). apps/web src/ icinden import etmedigi icin src/core/errors'daki
 * errorMessage'in esdegeri burada tutulur.
 */

/** Bir nesnenin `key` alanini okur; nesne degilse `undefined` doner. */
export function readErrorProp(err: unknown, key: string): unknown {
  if ((typeof err === "object" && err !== null) || typeof err === "function") {
    return (err as Record<string, unknown>)[key];
  }
  return undefined;
}

/** `err?.message || fallback` esdegeri. */
export function errorMessage(err: unknown, fallback: string): string {
  const message = readErrorProp(err, "message");
  return typeof message === "string" && message.length > 0 ? message : fallback;
}

/** Hatanin `name` alani `"AbortError"` ise true (fetch iptali). */
export function isAbortError(err: unknown): boolean {
  return readErrorProp(err, "name") === "AbortError";
}

/** Hatanin `code` alani (Firebase `auth/...` kodlari gibi), yoksa undefined. */
export function errorCode(err: unknown): unknown {
  return readErrorProp(err, "code");
}

/** `code` alani eklenmis bir Error uretir (Firebase hatalariyla ayni sekil). */
export function errorWithCode(message: string, code: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
