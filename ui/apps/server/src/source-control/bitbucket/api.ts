// Bitbucket REST client — single IO seam for the Bitbucket provider.
import { ProviderAuthError } from "../errors.ts";

const API_BASE = "https://api.bitbucket.org/2.0";

function authHeader(): string {
  const user = process.env.BITBUCKET_USERNAME;
  const pass = process.env.BITBUCKET_APP_PASSWORD;
  if (!user || !pass) {
    throw new ProviderAuthError(
      "Bitbucket auth env not set: BITBUCKET_USERNAME / BITBUCKET_APP_PASSWORD",
    );
  }
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

export interface BbFetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
}

export async function bbFetch<T = unknown>(pathOrUrl: string, opts: BbFetchOptions = {}): Promise<T> {
  // Compute auth header first so missing env throws BEFORE the fetch
  // call — tests rely on this ordering to assert "no network call when
  // auth is missing".
  const auth = authHeader();
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: auth,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    let bodyText = "";
    try {
      bodyText = await res.text();
    } catch {}
    throw new ProviderAuthError(`Bitbucket 401: ${bodyText || "unauthenticated"}`);
  }
  if (!res.ok) {
    let bodyJson: unknown = null;
    try {
      bodyJson = await res.json();
    } catch {}
    const msg =
      (bodyJson as any)?.error?.message ?? `Bitbucket HTTP ${res.status} on ${url}`;
    throw new Error(String(msg));
  }
  return (await res.json()) as T;
}

/** Extract `<workspace>/<repo>` from a Bitbucket remote URL. */
export function repositoryFromRemote(remoteUrl: string): string | null {
  // Matches https://bitbucket.org/<ws>/<repo>(.git) and git@bitbucket.org:<ws>/<repo>(.git)
  const m = remoteUrl.match(/bitbucket\.org[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
}
