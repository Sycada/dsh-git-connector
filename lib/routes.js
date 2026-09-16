/**
 * dsh-git-connector - HTTP bridge for the Settings card.
 *
 * All routes hang under the plugin-owned prefix /dsh-git-connector/api and every
 * request passes a browser-trust fence (loopback or configured trustedHosts),
 * matching the containment posture of the /api gateway.
 *
 * The card and the agent tools share one engine: a button here and a tool call
 * there run exactly the same guarded code path.
 */
import { resolveGitBinary, gitVersion } from "./git.js";
import {
  requireRepo, repoContext, gitClone, gitPull, gitFetch, gitStatus,
  localRepoState, describeRef, setRef, unsetRef,
  secretRefOf, removeProviderWithCreds, forgeContext,
} from "./engine.js";
import { publicFlags } from "./flags.js";
import { workspaceRootOf } from "./paths.js";

function loopbackish(address = "") {
  const a = String(address).toLowerCase();
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1" || a.startsWith("127.");
}

function hostnameOf(req) {
  const host = String(req.headers?.host ?? "");
  return host.replace(/^\[|\]$/g, "").split(":")[0].toLowerCase() || "";
}

/** Browser-trust fence: loopback peers are always trusted; else cfg.trustedHosts. */
export function fence(req, cfg = {}) {
  if (loopbackish(req.socket?.remoteAddress)) return true;
  const host = hostnameOf(req);
  if (host === "127.0.0.1" || host === "localhost" || host === "::1") return true;
  const trusted = Array.isArray(cfg.trustedHosts) ? cfg.trustedHosts.map((h) => String(h).toLowerCase()) : [];
  return trusted.includes(host) || trusted.includes(String(req.headers?.host ?? "").toLowerCase());
}

function sendJson(res, code, payload) {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, code, message, httpCode = 400) {
  sendJson(res, httpCode, { error: message, ok: false });
}

function readJsonBody(req, limit = 262144) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        rejectPromise(Object.assign(new Error("request body too large"), { code: "TOO_LARGE" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) { resolvePromise({}); return; }
      try { resolvePromise(JSON.parse(raw)); } catch { rejectPromise(new Error("invalid JSON body")); }
    });
    req.on("error", rejectPromise);
  });
}

function segmentPath(pathname) {
  return pathname.split("/").filter(Boolean);
}

/** Provider view plus whether its secret is set (never the value). */
async function providerView(ctx, store, provider) {
  const ref = secretRefOf(provider);
  const secret = ref ? await describeRef(ctx, ref) : { configured: false, source: "", writable: false };
  return { ...provider, secretRef: ref, secretSet: secret.configured, secretSource: secret.source };
}

/** Full state for the Settings card. */
export async function buildState(ctx, store, cfg) {
  const binary = resolveGitBinary(cfg);
  const version = await gitVersion(binary.file);

  const providers = [];
  for (const provider of store.listProviders()) providers.push(await providerView(ctx, store, provider));

  const repos = [];
  for (const repo of store.listRepos()) {
    const raw = store.findRepo(repo.id);
    const provider = store.providerOf(raw);
    const { flags, flagSources } = repoContext(store, cfg, raw);
    const local = await localRepoState(ctx, store, cfg, raw).catch(() => ({ present: false, isRepo: false, head: "" }));
    repos.push({
      ...repo,
      flags,
      flagSources,
      flagDetails: publicFlags(raw, provider ?? {}, cfg),
      local,
      tlsInsecure: flags.insecureTls === true,
    });
  }

  return {
    version: "0.1.0",
    git: { binary: binary.file, from: binary.from, version: version.ok ? version.version : "", error: version.error || "" },
    providers,
    repos,
    workspaceRoot: workspaceRootOf(cfg),
    settings: {
      allowForcePush: cfg.allowForcePush === true,
      allowRawUrl: cfg.allowRawUrl === true,
      allowOutsideWorkspace: cfg.allowOutsideWorkspace === true,
      allowInsecure: cfg.allowInsecure === true,
      gitTimeoutMs: cfg.gitTimeoutMs,
      httpTimeoutMs: cfg.httpTimeoutMs,
      instanceLabel: cfg.instanceLabel ?? "",
    },
  };
}

/** Register the plugin's HTTP API. Returns a teardown function. */
export function registerRoutes(ctx, { store, cfg }) {
  const disposers = [];

  disposers.push(
    ctx.webServer.register({
      kind: "prefix",
      path: "/dsh-git-connector/api",
      handler: async (req, res) => {
        if (!fence(req, cfg)) return sendError(res, "forbidden", "forbidden", 403);
        try {
          const method = (req.method || "GET").toUpperCase();
          // The webserver hands prefix handlers the FULL pathname, mount prefix
          // included, so strip our own prefix before routing.
          let pathname = (req.url ?? "/").split("?")[0];
          const guard = "/dsh-git-connector/api";
          while (pathname.startsWith(guard)) pathname = pathname.slice(guard.length);
          if (!pathname.startsWith("/")) pathname = "/" + pathname;
          const seg = segmentPath(pathname);
          const query = new URL(req.url ?? "/", "http://dsh.internal").searchParams;

          if (seg.length === 1 && seg[0] === "state" && method === "GET") {
            return sendJson(res, 200, { ok: true, data: await buildState(ctx, store, cfg) });
          }

          // ---------------- providers ----------------
          if (seg.length === 1 && seg[0] === "providers" && method === "GET") {
            const providers = [];
            for (const p of store.listProviders()) providers.push(await providerView(ctx, store, p));
            return sendJson(res, 200, { ok: true, providers });
          }
          if (seg.length === 1 && seg[0] === "providers" && method === "POST") {
            const body = await readJsonBody(req);
            const created = store.upsertProvider(body.provider ?? body);
            return sendJson(res, 200, { ok: true, provider: await providerView(ctx, store, store.findProvider(created.id)) });
          }
          if (seg.length === 2 && seg[0] === "providers" && method === "PUT") {
            const body = await readJsonBody(req);
            store.upsertProvider(body.provider ?? body, seg[1]);
            return sendJson(res, 200, { ok: true, provider: await providerView(ctx, store, store.findProvider(seg[1])) });
          }
          if (seg.length === 2 && seg[0] === "providers" && method === "DELETE") {
            const clear = query.get("clear") === "1" || query.get("clear") === "true";
            const report = await removeProviderWithCreds(ctx, store, seg[1], clear);
            return sendJson(res, 200, { ok: true, ...report });
          }
          if (seg.length === 3 && seg[0] === "providers" && seg[2] === "key" && method === "POST") {
            const body = await readJsonBody(req);
            const provider = store.findProvider(seg[1]);
            if (!provider) return sendError(res, "provider", "provider not found", 404);
            const ref = secretRefOf(provider);
            if (!ref) return sendError(res, "ref", "this provider does not use a stored secret");
            if (!body.value) return sendError(res, "value", "a non-empty key is required");
            await setRef(ctx, ref, String(body.value));
            return sendJson(res, 200, { ok: true, ref, secretSet: true });
          }
          if (seg.length === 3 && seg[0] === "providers" && seg[2] === "key" && method === "DELETE") {
            const provider = store.findProvider(seg[1]);
            if (!provider) return sendError(res, "provider", "provider not found", 404);
            const ref = secretRefOf(provider);
            if (!ref) return sendError(res, "ref", "this provider does not use a stored secret");
            await unsetRef(ctx, ref);
            return sendJson(res, 200, { ok: true, ref, secretSet: false });
          }
          if (seg.length === 3 && seg[0] === "providers" && seg[2] === "test" && method === "POST") {
            return sendJson(res, 200, { ok: true, ...(await providerTest(ctx, store, cfg, seg[1])) });
          }

          // ---------------- repos ----------------
          if (seg.length === 1 && seg[0] === "repos" && method === "GET") {
            return sendJson(res, 200, { ok: true, repos: store.listRepos() });
          }
          if (seg.length === 1 && seg[0] === "repos" && method === "POST") {
            const body = await readJsonBody(req);
            const repo = store.upsertRepo(body.repo ?? body);
            return sendJson(res, 200, { ok: true, repo });
          }
          if (seg.length === 2 && seg[0] === "repos" && method === "PUT") {
            const body = await readJsonBody(req);
            const repo = store.upsertRepo(body.repo ?? body, seg[1]);
            return sendJson(res, 200, { ok: true, repo });
          }
          if (seg.length === 2 && seg[0] === "repos" && method === "DELETE") {
            const removed = store.removeRepo(seg[1]);
            return sendJson(res, 200, { ok: true, removed: { id: removed.id, name: removed.name } });
          }
          if (seg.length === 3 && seg[0] === "repos" && method === "POST") {
            const raw = requireRepo(store, seg[1]);
            const action = seg[2];
            const body = await readJsonBody(req);
            if (action === "status") return sendJson(res, 200, { ok: true, ...(await gitStatus(ctx, store, cfg, raw)) });
            if (action === "local") return sendJson(res, 200, { ok: true, ...(await localRepoState(ctx, store, cfg, raw)) });
            if (action === "clone") return sendJson(res, 200, { ok: true, ...(await gitClone(ctx, store, cfg, raw, body)) });
            if (action === "pull") return sendJson(res, 200, { ok: true, ...(await gitPull(ctx, store, cfg, raw, body)) });
            if (action === "fetch") return sendJson(res, 200, { ok: true, ...(await gitFetch(ctx, store, cfg, raw, body)) });
            if (action === "flags") {
              const provider = store.providerOf(raw);
              return sendJson(res, 200, { ok: true, flags: publicFlags(raw, provider ?? {}, cfg) });
            }
            if (action === "test") return sendJson(res, 200, { ok: true, ...(await repoTest(ctx, store, cfg, raw)) });
            return sendError(res, "action", "unknown repo action; use status|local|clone|pull|fetch|flags|test", 404);
          }

          return sendError(res, "not-found", "no API route for " + method + " /dsh-git-connector/api/" + seg.join("/"), 404);
        } catch (error) {
          return sendError(res, "error", error?.message ? String(error.message) : String(error), 400);
        }
      },
    })
  );

  const teardown = () => { for (const d of disposers) { try { d(); } catch { /* ignore */ } } };
  return { disposers, teardown };
}

/** Probe one provider: unauthenticated version, then an authenticated whoami. */
export async function providerTest(ctx, store, cfg, idOrName) {
  const provider = store.findProvider(idOrName);
  if (!provider) throw new Error("provider " + JSON.stringify(idOrName) + " not found");
  const { forge, token, tls, timeoutMs } = await forgeContext(ctx, store, cfg, null, provider);
  const started = Date.now();
  const report = {
    provider: provider.name,
    kind: provider.kind,
    apiBaseUrl: provider.apiBaseUrl,
    gitBaseUrl: provider.gitBaseUrl,
    tokenSet: token !== "",
    tlsInsecure: tls.insecure,
    version: "",
    authenticated: false,
    login: "",
    error: "",
  };
  try {
    const v = await forge.version({ provider, token, tls, timeoutMs });
    report.version = v.version;
  } catch (error) {
    report.error = String(error?.message ?? error);
    report.durationMs = Date.now() - started;
    return { ...report, ok: false };
  }
  if (token !== "") {
    try {
      const me = await forge.whoami({ provider, token, tls, timeoutMs });
      report.authenticated = true;
      report.login = me.login;
    } catch (error) {
      report.error = String(error?.message ?? error);
    }
  }
  report.durationMs = Date.now() - started;
  return { ...report, ok: report.error === "" };
}

/** Probe one repo: forge reachability plus local work-copy state. */
export async function repoTest(ctx, store, cfg, repo) {
  const provider = store.providerOf(repo);
  const { flags } = repoContext(store, cfg, repo);
  const local = await localRepoState(ctx, store, cfg, repo);
  const report = {
    repo: repo.name,
    remoteUrl: repo.remoteUrl,
    localPath: repo.localPath,
    tlsInsecure: flags.insecureTls === true,
    local,
    provider: null,
  };
  if (provider) {
    const probe = await providerTest(ctx, store, cfg, provider.id).catch((error) => ({ ok: false, error: String(error?.message ?? error) }));
    report.provider = { name: provider.name, ok: probe.ok === true, version: probe.version ?? "", authenticated: probe.authenticated === true, error: probe.error ?? "" };
  }
  return { ...report, ok: report.provider === null || report.provider.ok === true };
}
