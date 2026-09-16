/**
 * dsh-git-connector - minimal HTTP client with PER-REQUEST TLS control.
 *
 * Built on node:http / node:https rather than global fetch on purpose: fetch's
 * only knob for a self-signed server is a global env var or an undici dispatcher,
 * and the design forbids mutating process-wide TLS state. An explicit https.Agent
 * keeps the bypass (or a custom CA) scoped to the one request that asked for it.
 */
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";

/** Hard cap on a forge response body we are willing to buffer. */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * Perform one HTTP request.
 * @param {string} url
 * @param {{method?: string, headers?: Record<string,string>, body?: string|null,
 *          timeoutMs?: number, tls?: {caFile?: string, insecure?: boolean}}} options
 * @returns {Promise<{ok: boolean, status: number, headers: object, data: any,
 *                    text: string, transportError?: string, tlsInsecure: boolean}>}
 */
export function httpRequest(url, options = {}) {
  const { method = "GET", headers = {}, body = null, timeoutMs = 30000, tls = {} } = options;
  return new Promise((resolve) => {
    let target;
    try { target = new URL(url); } catch {
      resolve({ ok: false, status: 0, headers: {}, data: null, text: "", transportError: "invalid URL " + JSON.stringify(url), tlsInsecure: false });
      return;
    }
    const isHttps = target.protocol === "https:";
    const mod = isHttps ? https : http;
    const tlsInsecure = isHttps && tls.insecure === true;

    let agent;
    let customAgent = false;
    if (isHttps && (tlsInsecure || tls.caFile)) {
      const agentOptions = { keepAlive: false };
      if (tls.caFile) {
        try {
          agentOptions.ca = readFileSync(tls.caFile);
        } catch (error) {
          resolve({
            ok: false, status: 0, headers: {}, data: null, text: "",
            transportError: "cannot read CA file " + JSON.stringify(tls.caFile) + ": " + (error?.message ?? error),
            tlsInsecure: false,
          });
          return;
        }
      }
      if (tlsInsecure) agentOptions.rejectUnauthorized = false;
      agent = new https.Agent(agentOptions);
      customAgent = true;
    }

    const finalHeaders = { accept: "application/json", "user-agent": "dsh-git-connector", ...headers };
    if (body != null && finalHeaders["content-type"] === undefined) {
      finalHeaders["content-type"] = "application/json";
    }
    if (body != null && finalHeaders["content-length"] === undefined) {
      finalHeaders["content-length"] = Buffer.byteLength(body);
    }

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (customAgent && agent) { try { agent.destroy(); } catch { /* ignore */ } }
      resolve(value);
    };

    let req;
    try {
      req = mod.request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: target.pathname + target.search,
        method,
        headers: finalHeaders,
        ...(agent ? { agent } : {}),
        ...(tlsInsecure ? { rejectUnauthorized: false } : {}),
      });
    } catch (error) {
      finish({ ok: false, status: 0, headers: {}, data: null, text: "", transportError: String(error?.message ?? error), tlsInsecure });
      return;
    }

    const timer = setTimeout(() => {
      try { req.destroy(new Error("request timed out after " + Math.round(timeoutMs / 1000) + "s")); } catch { /* ignore */ }
    }, Math.max(1, Number(timeoutMs) || 30000));

    req.on("response", (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          try { req.destroy(new Error("response exceeded " + MAX_BODY_BYTES + " bytes")); } catch { /* ignore */ }
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        clearTimeout(timer);
        const text = Buffer.concat(chunks).toString("utf8");
        let data = null;
        let parseError = null;
        if (text.trim() !== "") {
          try { data = JSON.parse(text); } catch (error) { parseError = String(error?.message ?? error); }
        }
        const status = res.statusCode ?? 0;
        finish({
          ok: status >= 200 && status < 300,
          status,
          headers: res.headers ?? {},
          data,
          text,
          parseError,
          tlsInsecure,
        });
      });
      res.on("error", (error) => {
        clearTimeout(timer);
        finish({ ok: false, status: 0, headers: {}, data: null, text: "", transportError: String(error?.message ?? error), tlsInsecure });
      });
    });

    req.on("error", (error) => {
      clearTimeout(timer);
      const code = error?.code ? String(error.code) + ": " : "";
      finish({ ok: false, status: 0, headers: {}, data: null, text: "", transportError: code + String(error?.message ?? error), tlsInsecure });
    });

    if (body != null) req.write(body);
    req.end();
  });
}
