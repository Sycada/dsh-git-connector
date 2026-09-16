/**
 * dsh-git-connector - forge adapter registry.
 *
 * A "forge" is the server hosting repositories behind an API (Gitea/Forgejo,
 * GitHub). Adapters normalise three differences so the tools and the engine can
 * stay provider-agnostic:
 *   1. where the API lives (Gitea shares the git origin; GitHub splits it),
 *   2. how the token rides the wire (token vs Bearer),
 *   3. how response bodies are shaped.
 */
import { httpRequest } from "../http.js";

/** Per-kind auth scheme used to build the Authorization header. */
const AUTH_SCHEME = { gitea: "token", forgejo: "token", github: "Bearer" };

/** Adapter modules, loaded lazily so a missing half never breaks the other. */
let adaptersPromise = null;
async function adapters() {
  if (adaptersPromise === null) {
    adaptersPromise = (async () => {
      const [gitea, github] = await Promise.all([import("./gitea.js"), import("./github.js")]);
      return new Map([["gitea", gitea.default], ["forgejo", gitea.default], ["github", github.default]]);
    })();
  }
  return adaptersPromise;
}

/** Resolve the adapter for one provider record. */
export async function getForge(provider) {
  const table = await adapters();
  const adapter = table.get(String(provider?.kind ?? "").toLowerCase());
  if (!adapter) {
    const known = [...table.keys()].join(", ");
    throw new Error("no forge adapter for kind " + JSON.stringify(provider?.kind) + " (known: " + known + ")");
  }
  return adapter;
}

/** Build the Authorization header value for a provider + token. */
export function authHeader(provider, token) {
  const scheme = AUTH_SCHEME[String(provider?.kind ?? "").toLowerCase()] ?? "token";
  return token ? scheme + " " + token : "";
}

/** Turn a failed transport/HTTP result into a message a human can act on. */
export function describeForgeError(res, what) {
  if (res.transportError) return what + ": " + res.transportError;
  const detail = (() => {
    const data = res.data;
    if (data && typeof data === "object") {
      for (const key of ["message", "error", "errors"]) {
        if (typeof data[key] === "string" && data[key] !== "") return data[key];
      }
    }
    return String(res.text || "").trim().slice(0, 200);
  })();
  const suffix = detail ? " - " + detail : "";
  switch (res.status) {
    case 401: return what + ": authentication failed (missing, wrong or expired token)" + suffix;
    case 403: return what + ": forbidden (token lacks the required scope, or the account is restricted)" + suffix;
    case 404: return what + ": not found - the repository may not exist, may be private, or may still be empty (a repo with no commits has no branches, contents or pull requests)" + suffix;
    case 409: return what + ": conflict (the resource already exists or is not in a valid state)" + suffix;
    case 422: return what + ": rejected by the server" + suffix;
    case 429: return what + ": rate limited" + suffix;
    default: return what + ": HTTP " + res.status + suffix;
  }
}

/**
 * One forge API call.
 * @param {object} provider provider record (apiBaseUrl, kind)
 * @param {{path: string, method?: string, query?: object, body?: any, token?: string,
 *          tls?: object, timeoutMs?: number, auth?: boolean}} spec
 * @returns {Promise<object>} the raw httpRequest result
 */
export async function forgeRequest(provider, spec) {
  const {
    path, method = "GET", query, body, token = "", tls = {},
    timeoutMs = 30000, auth = true,
  } = spec;

  let url = String(provider.apiBaseUrl || "").replace(/\/+$/, "") + path;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs !== "") url += "?" + qs;
  }

  const headers = {};
  if (auth) {
    const header = authHeader(provider, token);
    if (header !== "") headers.authorization = header;
  }

  return httpRequest(url, {
    method,
    headers,
    body: body === undefined || body === null ? null : JSON.stringify(body),
    timeoutMs,
    tls,
  });
}

/** Require a 2xx, else throw with a mapped message. */
export function unwrap(res, what) {
  if (!res.ok) throw new Error(describeForgeError(res, what));
  return res.data;
}

/** Normalise a repo object from either forge into one shape. */
export function normalizeRepo(raw) {
  return {
    fullName: String(raw?.full_name ?? ""),
    name: String(raw?.name ?? ""),
    owner: String(raw?.owner?.login ?? raw?.owner?.username ?? ""),
    private: raw?.private === true,
    defaultBranch: String(raw?.default_branch ?? ""),
    description: String(raw?.description ?? ""),
    cloneUrl: String(raw?.clone_url ?? ""),
    sshUrl: String(raw?.ssh_url ?? ""),
    htmlUrl: String(raw?.html_url ?? ""),
    empty: raw?.empty === true,
    updatedAt: String(raw?.updated_at ?? ""),
  };
}

/** Normalise a branch object. */
export function normalizeBranch(raw) {
  return { name: String(raw?.name ?? ""), sha: String(raw?.commit?.id ?? raw?.commit?.sha ?? "") };
}

/** Normalise a pull request object. */
export function normalizePull(raw) {
  return {
    number: Number(raw?.number ?? 0),
    title: String(raw?.title ?? ""),
    state: String(raw?.state ?? ""),
    author: String(raw?.user?.login ?? raw?.user?.username ?? ""),
    head: String(raw?.head?.ref ?? ""),
    base: String(raw?.base?.ref ?? ""),
    htmlUrl: String(raw?.html_url ?? ""),
    createdAt: String(raw?.created_at ?? ""),
    merged: raw?.merged === true,
  };
}

/** Normalise a content entry. */
export function normalizeContent(raw) {
  if (Array.isArray(raw)) {
    return raw.map((entry) => ({
      name: String(entry?.name ?? ""),
      path: String(entry?.path ?? ""),
      type: String(entry?.type ?? ""),
      size: Number(entry?.size ?? 0),
      sha: String(entry?.sha ?? ""),
    }));
  }
  if (raw && typeof raw === "object") {
    return [{
      name: String(raw.name ?? ""),
      path: String(raw.path ?? ""),
      type: String(raw.type ?? "file"),
      size: Number(raw.size ?? 0),
      sha: String(raw.sha ?? ""),
    }];
  }
  return [];
}
