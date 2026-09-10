import http from "node:http";
import { URL } from "node:url";
import { MailPortError, ERROR_CODES } from "./errors.js";

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function parseQueryFilters(searchParams) {
  const parsed = {};
  for (const [key, value] of searchParams.entries()) {
    if (value === "null") parsed[key] = null;
    else if (value === "undefined") parsed[key] = undefined;
    else parsed[key] = value;
  }
  return parsed;
}

function parseAuthorization(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function assertAuthorized(req, apiKey) {
  if (!apiKey) return;
  const token = parseAuthorization(req);
  if (!token || token !== apiKey) {
    throw new MailPortError(ERROR_CODES.MAIL_UNAUTHORIZED, "Unauthorized");
  }
}

export function createMailPortService(
  mail,
  { host = "127.0.0.1", port = 8789, apiKey } = {}
) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${host}:${port}`);

      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/ready") {
        return sendJson(res, 200, { ready: true });
      }

      if (url.pathname.startsWith("/v1/")) {
        assertAuthorized(req, apiKey);
      }

      if (req.method === "POST" && url.pathname === "/v1/messages") {
        const body = await readJsonBody(req);
        const message = body.template
          ? await mail.send(body.template, body.payload || {})
          : await mail.send(body);
        return sendJson(res, 200, message);
      }

      if (req.method === "GET" && url.pathname === "/v1/messages") {
        return sendJson(res, 200, mail.list(parseQueryFilters(url.searchParams)));
      }

      if (req.method === "GET" && url.pathname.startsWith("/v1/messages/")) {
        const id = decodeURIComponent(url.pathname.split("/").pop());
        const message = mail.get(id);
        if (!message) return sendJson(res, 404, { error: "not_found" });
        return sendJson(res, 200, message);
      }

      if (req.method === "GET" && url.pathname === "/v1/test/messages") {
        return sendJson(res, 200, mail.test.list(parseQueryFilters(url.searchParams)));
      }

      if (req.method === "GET" && url.pathname.startsWith("/v1/test/messages/")) {
        const id = decodeURIComponent(url.pathname.split("/").pop());
        const message = mail.test.get(id);
        if (!message) return sendJson(res, 404, { error: "not_found" });
        return sendJson(res, 200, message);
      }

      if (req.method === "DELETE" && url.pathname === "/v1/test/messages") {
        mail.test.clear();
        return sendJson(res, 200, { cleared: true });
      }

      return sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof MailPortError) {
        const status = error.code === ERROR_CODES.MAIL_UNAUTHORIZED ? 401 : 400;
        return sendJson(res, status, { error: error.code, message: error.message });
      }
      return sendJson(res, 500, { error: "internal_error" });
    }
  });

  return {
    async start() {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off("error", onError);
          reject(error);
        };
        server.once("error", onError);
        server.listen(port, host, () => {
          server.off("error", onError);
          resolve();
        });
      });
    },
    async stop() {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    },
  };
}
