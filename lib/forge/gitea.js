/**
 * dsh-git-connector - Gitea / Forgejo adapter (REST v1).
 *
 * Gitea serves its git transport and its API from the SAME origin, so
 * gitBaseUrl === apiBaseUrl; only the /api/v1 prefix differs.
 */
import { forgeRequest, unwrap, normalizeRepo, normalizeBranch, normalizePull, normalizeContent } from "./index.js";

const PREFIX = "/api/v1";

/** GET /api/v1/version - the one unauthenticated capability probe. */
async function version(ctx) {
  const res = await forgeRequest(ctx.provider, { path: PREFIX + "/version", auth: false, tls: ctx.tls, timeoutMs: ctx.timeoutMs });
  const data = unwrap(res, "gitea version");
  return { version: String(data?.version ?? ""), raw: data };
}

/** GET /api/v1/user - proves the token works. */
async function whoami(ctx) {
  const res = await forgeRequest(ctx.provider, { path: PREFIX + "/user", token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs });
  const data = unwrap(res, "gitea whoami");
  return { login: String(data?.login ?? ""), name: String(data?.full_name ?? ""), admin: data?.is_admin === true };
}

/** GET /api/v1/user/repos */
async function listRepos(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: PREFIX + "/user/repos",
    query: { limit: ctx.limit ?? 50, page: ctx.page ?? 1 },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  const data = unwrap(res, "gitea list repos");
  return Array.isArray(data) ? data.map(normalizeRepo) : [];
}

/** POST /api/v1/user/repos */
async function createRepo(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: PREFIX + "/user/repos",
    method: "POST",
    body: {
      name: ctx.name,
      private: ctx.private === true,
      auto_init: ctx.autoInit === true,
      default_branch: ctx.defaultBranch || undefined,
      description: ctx.description || undefined,
    },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  return normalizeRepo(unwrap(res, "gitea create repo"));
}

/** GET /api/v1/repos/{owner}/{repo} */
async function repoInfo(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: PREFIX + "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo),
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  return normalizeRepo(unwrap(res, "gitea repo info"));
}

/** GET /api/v1/repos/{owner}/{repo}/branches */
async function listBranches(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: PREFIX + "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/branches",
    query: { limit: ctx.limit ?? 50 },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  const data = unwrap(res, "gitea list branches");
  return Array.isArray(data) ? data.map(normalizeBranch) : [];
}

/** GET /api/v1/repos/{owner}/{repo}/contents/{path} */
async function getContents(ctx) {
  let path = PREFIX + "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/contents";
  if (ctx.path) {
    const clean = String(ctx.path).split("/").filter(Boolean).map(encodeURIComponent).join("/");
    path += "/" + clean;
  }
  const res = await forgeRequest(ctx.provider, {
    path, query: { ref: ctx.ref || undefined }, token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  return normalizeContent(unwrap(res, "gitea contents"));
}

/** GET /api/v1/repos/{owner}/{repo}/pulls */
async function listPulls(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: PREFIX + "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/pulls",
    query: { state: ctx.state || "open", limit: ctx.limit ?? 50 },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  const data = unwrap(res, "gitea list pulls");
  return Array.isArray(data) ? data.map(normalizePull) : [];
}

/** POST /api/v1/repos/{owner}/{repo}/pulls */
async function createPull(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: PREFIX + "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/pulls",
    method: "POST",
    body: { title: ctx.title, head: ctx.head, base: ctx.base, body: ctx.body || undefined },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  return normalizePull(unwrap(res, "gitea create pull"));
}

/** POST /api/v1/repos/{owner}/{repo}/issues */
async function createIssue(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: PREFIX + "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/issues",
    method: "POST",
    body: { title: ctx.title, body: ctx.body || undefined },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  const data = unwrap(res, "gitea create issue");
  return { number: Number(data?.number ?? 0), title: String(data?.title ?? ""), htmlUrl: String(data?.html_url ?? "") };
}

export default {
  kind: "gitea",
  label: "Gitea / Forgejo",
  apiPrefix: PREFIX,
  probePaths: [PREFIX + "/version", PREFIX + "/user", "/swagger.v1.json"],
  version, whoami, listRepos, createRepo, repoInfo, listBranches, getContents, listPulls, createPull, createIssue,
};
