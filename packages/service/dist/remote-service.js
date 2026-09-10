import http from "node:http";
import { URL } from "node:url";
import { MailPortError, ERROR_CODES } from "@mailerport/core";

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
function publicMessage(message) {
  if (!message || typeof message !== "object") return message;
  const copy = structuredClone(message); delete copy.dkim; return copy;
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
  const header = req.headers.authorization;
  if (typeof header !== "string" || !/^Bearer [^\s]+$/.test(header)) return null;
  return header.slice(7);
}

async function readJsonBody(req, maxBodyBytes) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBodyBytes) {
      throw new MailPortError(ERROR_CODES.MAIL_MESSAGE_TOO_LARGE, "Request body too large");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new MailPortError(ERROR_CODES.MAIL_DELIVERY_FAILED, "Invalid JSON body");
  }
}

function authorize(req, { apiKey, adminKey, operations, applicationId }) {
  if (!apiKey && !adminKey && !operations) return { application_id: applicationId || "app", scopes: ["mail.send", "mail.read", "mail.test"] };
  const token = parseAuthorization(req);
  if (adminKey && token === adminKey) return { admin: true, application_id: null, scopes: ["*"] };
  if (apiKey && token === apiKey) return { application_id: applicationId || "app", tenant_id: null, scopes: ["mail.send", "mail.read", "mail.test"] };
  const principal = token && operations?.authenticate(token);
  if (!principal) {
    throw new MailPortError(ERROR_CODES.MAIL_UNAUTHORIZED, "Unauthorized");
  }
  return principal;
}
function requireScope(principal, scope) {
  if (!principal.admin && !principal.scopes?.includes(scope)) throw new MailPortError(ERROR_CODES.MAIL_FORBIDDEN, `Missing scope: ${scope}`);
}
function requireAdmin(principal) {
  if (!principal.admin) throw new MailPortError(ERROR_CODES.MAIL_FORBIDDEN, "Administrative credential required");
}

export function createMailPortService(
  mail,
  {
    host = "127.0.0.1",
    port = 8789,
    apiKey,
    maxBodyBytes = 256 * 1024,
    testEndpointsEnabled = true,
    adminKey, operations, rateLimits, applicationId, production, deliveryEvents,
  } = {}
) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${host}:${port}`);

      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/ready") {
        await mail.list();
        if (production?.production && operations && !operations.signingReady())
          return sendJson(res, 503, { ready: false, reason: "signing_configuration_unavailable" });
        return sendJson(res, 200, { ready: true });
      }

      const principal = url.pathname.startsWith("/v1/")
        ? authorize(req, { apiKey, adminKey, operations, applicationId }) : null;

      if (req.method === "GET" && url.pathname === "/v1/status") {
        const status = typeof mail.status === "function" ? await mail.status() : {};
        const suppressions = operations?.listSuppressions({ admin: true }) || [];
        return sendJson(res, 200, { service: "mailport", version: "1.0.0", ...status,
          suppression: { suppressed: suppressions.length, hard_bounces: suppressions.filter((item) => item.reason === "hard_bounce").length,
            complaints: suppressions.filter((item) => item.reason === "complaint").length } });
      }

      if (req.method === "POST" && url.pathname === "/v1/domains") {
        requireAdmin(principal); const body = await readJsonBody(req, maxBodyBytes);
        return sendJson(res, 201, operations.createDomain(body.domain));
      }
      if (req.method === "GET" && url.pathname === "/v1/domains") {
        requireAdmin(principal); return sendJson(res, 200, operations.listDomains());
      }
      if (url.pathname.startsWith("/v1/domains/")) {
        requireAdmin(principal);
        const parts = url.pathname.split("/"); const domain = decodeURIComponent(parts[3]);
        if (req.method === "POST" && parts[4] === "verify") return sendJson(res, 200, await operations.verifyDomain(domain));
        if (req.method === "GET") { const item = operations.getDomain(domain); return item ? sendJson(res, 200, item) : sendJson(res, 404, { error: "not_found" }); }
        if (req.method === "DELETE") { operations.deleteDomain(domain); return sendJson(res, 200, { deleted: true }); }
      }
      if (req.method === "POST" && url.pathname === "/v1/identities") {
        requireAdmin(principal); return sendJson(res, 201, operations.createIdentity(await readJsonBody(req, maxBodyBytes)));
      }
      if (req.method === "GET" && url.pathname === "/v1/identities") {
        requireAdmin(principal); return sendJson(res, 200, operations.listIdentities(principal));
      }
      if (req.method === "POST" && url.pathname === "/v1/suppressions") {
        requireAdmin(principal); return sendJson(res, 201, operations.addSuppression(await readJsonBody(req, maxBodyBytes)));
      }
      if (req.method === "POST" && url.pathname === "/v1/delivery-events") {
        requireAdmin(principal);
        return sendJson(res, 202, publicMessage(await deliveryEvents.consume(await readJsonBody(req, maxBodyBytes))));
      }
      if (req.method === "GET" && url.pathname === "/v1/suppressions") {
        requireAdmin(principal); return sendJson(res, 200, operations.listSuppressions(principal));
      }
      if (req.method === "GET" && /^\/v1\/messages\/[^/]+\/events$/.test(url.pathname)) {
        requireScope(principal, "mail.read"); const id = decodeURIComponent(url.pathname.split("/")[3]);
        const message = await mail.get(id);
        if (!message) return sendJson(res, 404, { error: "not_found" });
        if (!principal.admin && message.application_id !== principal.application_id) throw new MailPortError(ERROR_CODES.MAIL_FORBIDDEN, "Message belongs to another application");
        return sendJson(res, 200, message.events || []);
      }

      if (req.method === "POST" && url.pathname === "/v1/messages") {
        requireScope(principal, "mail.send");
        const body = await readJsonBody(req, maxBodyBytes);
        delete body.__applicationId; delete body.__tenantId; delete body.__identityAddress;
        const payload = body.template ? body.payload || {} : body;
        const identity = operations?.listIdentities(principal).find((item) => item.identity === payload.identity &&
          (!item.tenant_id || item.tenant_id === principal.tenant_id));
        if (identity && identity.status !== "active") throw new MailPortError(ERROR_CODES.MAIL_DOMAIN_NOT_VERIFIED, "Sending identity is not active");
        const recipients = [...(Array.isArray(payload.to) ? payload.to : [payload.to]), ...(payload.cc || []), ...(payload.bcc || [])].filter(Boolean);
        const suppressed = recipients.find((email) => operations?.isSuppressed(email, principal));
        if (suppressed) throw new MailPortError(ERROR_CODES.MAIL_RECIPIENT_SUPPRESSED, "Recipient is suppressed", { recipient: suppressed });
        operations?.enforceRate(principal, payload.identity, recipients, rateLimits);
        payload.__applicationId = principal.application_id; payload.__tenantId = principal.tenant_id;
        if (identity) payload.__identityAddress = identity.address;
        if (identity) payload.__dkim = operations.signingForIdentity(identity.identity, principal);
        const message = body.template
          ? await mail.send(body.template, payload)
          : await mail.send(body);
        return sendJson(res, 200, publicMessage(message));
      }

      if (req.method === "GET" && url.pathname === "/v1/messages") {
        requireScope(principal, "mail.read");
        return sendJson(res, 200, (await mail.list(parseQueryFilters(url.searchParams))).filter((item) => principal.admin ||
          (item.application_id === principal.application_id && (principal.tenant_id == null || item.tenant_id === principal.tenant_id))).map(publicMessage));
      }

      if (req.method === "GET" && url.pathname.startsWith("/v1/messages/")) {
        const id = decodeURIComponent(url.pathname.split("/").pop());
        const message = await mail.get(id);
        if (!message) return sendJson(res, 404, { error: "not_found" });
        requireScope(principal, "mail.read");
        if (!principal.admin && (message.application_id !== principal.application_id ||
          (principal.tenant_id != null && message.tenant_id !== principal.tenant_id))) throw new MailPortError(ERROR_CODES.MAIL_FORBIDDEN, "Message belongs to another application");
        return sendJson(res, 200, publicMessage(message));
      }

      if (req.method === "GET" && url.pathname === "/v1/test/messages") {
        requireScope(principal, "mail.test");
        if (!testEndpointsEnabled) {
          throw new MailPortError(
            ERROR_CODES.MAIL_TEST_TRANSPORT_DISABLED,
            "Test API is disabled"
          );
        }
        return sendJson(res, 200, (await mail.test.list(parseQueryFilters(url.searchParams))).filter((item) =>
          principal.admin || item.application_id === principal.application_id).map(publicMessage));
      }

      if (req.method === "GET" && url.pathname.startsWith("/v1/test/messages/")) {
        requireScope(principal, "mail.test");
        if (!testEndpointsEnabled) {
          throw new MailPortError(
            ERROR_CODES.MAIL_TEST_TRANSPORT_DISABLED,
            "Test API is disabled"
          );
        }
        const id = decodeURIComponent(url.pathname.split("/").pop());
        const message = await mail.test.get(id);
        if (!message) return sendJson(res, 404, { error: "not_found" });
        if (!principal.admin && message.application_id !== principal.application_id) throw new MailPortError(ERROR_CODES.MAIL_FORBIDDEN, "Message belongs to another application");
        return sendJson(res, 200, publicMessage(message));
      }

      if (req.method === "DELETE" && url.pathname === "/v1/test/messages") {
        requireScope(principal, "mail.test");
        if (!testEndpointsEnabled) {
          throw new MailPortError(
            ERROR_CODES.MAIL_TEST_TRANSPORT_DISABLED,
            "Test API is disabled"
          );
        }
        const filters = parseQueryFilters(url.searchParams);
        if (!principal.admin || Object.keys(filters).length) await mail.test.clear({ ...filters, application_id: principal.application_id });
        else await mail.test.clear();
        return sendJson(res, 200, { cleared: true });
      }

      return sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof MailPortError) {
        const status = error.code === ERROR_CODES.MAIL_UNAUTHORIZED ? 401 : error.code === ERROR_CODES.MAIL_FORBIDDEN ? 403 :
          error.code === ERROR_CODES.MAIL_RATE_LIMITED ? 429 : 400;
        return sendJson(res, status, { error: error.code, message: error.message, details: error.details });
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
      if (typeof mail.stopWorker === "function") mail.stopWorker();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
      if (typeof mail.close === "function") {
        await mail.close();
      }
    },
  };
}
