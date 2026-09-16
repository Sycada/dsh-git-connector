/**
 * dsh-git-connector - GitHub adapter (REST).
 *
 * Unlike Gitea, GitHub splits its API host from its git host
 * (api.github.com vs github.com), and GitHub Enterprise inserts /api/v3.
 * defaultBaseUrls() in store.js already encodes that, so this adapter only
 * has to speak the protocol.
 */
import { forgeRequest, unwrap, normalizeRepo, normalizeBranch, normalizePull, normalizeContent } from "./index.js";

/** GET /meta - unauthenticated server metadata. */
async function version(ctx) {
  const res = await forgeRequest(ctx.provider, { path: "/meta", auth: false, tls: ctx.tls, timeoutMs: ctx.timeoutMs });
  const data = unwrap(res, "github meta");
  return { version: String(data?.installed_version ?? data?.verifiable_password_authentication ?? "github"), raw: data };
}

/** GET /user */
async function whoami(ctx) {
  const res = await forgeRequest(ctx.provider, { path: "/user", token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs });
  const data = unwrap(res, "github whoami");
  return { login: String(data?.login ?? ""), name: String(data?.name ?? ""), admin: false };
}

/** GET /user/repos */
async function listRepos(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: "/user/repos",
    query: { per_page: ctx.limit ?? 50, page: ctx.page ?? 1, sort: "updated" },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  const data = unwrap(res, "github list repos");
  return Array.isArray(data) ? data.map(normalizeRepo) : [];
}

/** POST /user/repos */
async function createRepo(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: "/user/repos",
    method: "POST",
    body: {
      name: ctx.name,
      private: ctx.private === true,
      auto_init: ctx.autoInit === true,
      description: ctx.description || undefined,
    },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  return normalizeRepo(unwrap(res, "github create repo"));
}

/** GET /repos/{owner}/{repo} */
async function repoInfo(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo),
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  return normalizeRepo(unwrap(res, "github repo info"));
}

/** GET /repos/{owner}/{repo}/branches */
async function listBranches(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/branches",
    query: { per_page: ctx.limit ?? 50 },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  const data = unwrap(res, "github list branches");
  return Array.isArray(data) ? data.map(normalizeBranch) : [];
}

/** GET /repos/{owner}/{repo}/contents/{path} */
async function getContents(ctx) {
  let path = "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/contents";
  if (ctx.path) {
    const clean = String(ctx.path).split("/").filter(Boolean).map(encodeURIComponent).join("/");
    path += "/" + clean;
  }
  const res = await forgeRequest(ctx.provider, {
    path, query: { ref: ctx.ref || undefined }, token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  return normalizeContent(unwrap(res, "github contents"));
}

/** GET /repos/{owner}/{repo}/pulls */
async function listPulls(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/pulls",
    query: { state: ctx.state || "open", per_page: ctx.limit ?? 50 },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  const data = unwrap(res, "github list pulls");
  return Array.isArray(data) ? data.map(normalizePull) : [];
}

/** POST /repos/{owner}/{repo}/pulls */
async function createPull(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/pulls",
    method: "POST",
    body: { title: ctx.title, head: ctx.head, base: ctx.base, body: ctx.body || undefined },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  return normalizePull(unwrap(res, "github create pull"));
}

/** POST /repos/{owner}/{repo}/issues */
async function createIssue(ctx) {
  const res = await forgeRequest(ctx.provider, {
    path: "/repos/" + encodeURIComponent(ctx.owner) + "/" + encodeURIComponent(ctx.repo) + "/issues",
    method: "POST",
    body: { title: ctx.title, body: ctx.body || undefined },
    token: ctx.token, tls: ctx.tls, timeoutMs: ctx.timeoutMs,
  });
  const data = unwrap(res, "github create issue");
  return { number: Number(data?.number ?? 0), title: String(data?.title ?? ""), htmlUrl: String(data?.html_url ?? "") };
}

export default {
  kind: "github",
  label: "GitHub",
  apiPrefix: "",
  probePaths: ["/meta", "/user", "/rate_limit"],
  version, whoami, listRepos, createRepo, repoInfo, listBranches, getContents, listPulls, createPull, createIssue,
};
