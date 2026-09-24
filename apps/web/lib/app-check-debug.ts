/**
 * Decides whether this browser uses a Firebase App Check debug token, and which.
 *
 * App Check is enforced in production, so a debug token is a way past it:
 * only local development may use one, and never a value committed to the repo.
 *
 * - Only on localhost / 127.0.0.1 or in `next dev`. The production site never
 *   enables debug mode (there used to be a `?debug_token=true` switch, and a
 *   hard-coded token fallback, which together let anyone reading the repo
 *   pass App Check if that token was registered).
 * - `NEXT_PUBLIC_APPCHECK_DEBUG_TOKEN` (from apps/web/.env.local) if set;
 *   otherwise `true`, which makes the Firebase SDK generate a random,
 *   per-browser debug token and print it to the console, to be registered
 *   once in the Firebase console (App Check -> Manage debug tokens).
 */
export interface AppCheckDebugInput {
  hostname: string;
  nodeEnv: string | undefined;
  envToken: string | undefined;
}

export function resolveAppCheckDebugToken(input: AppCheckDebugInput): string | true | undefined {
  const local = input.hostname === "localhost" || input.hostname === "127.0.0.1";
  if (!local && input.nodeEnv !== "development") return undefined;
  const token = input.envToken?.trim();
  return token ? token : true;
}
