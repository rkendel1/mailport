import http from "node:http";
import { URL } from "node:url";
import { MailPortError } from "./errors.js";

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendHtml(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(body);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderInbox(messages) {
  const rows = messages
    .map(
      (m) => `<tr>
<td>${escapeHtml(m.to.join(", "))}</td>
<td>${escapeHtml(m.from)}</td>
<td>${escapeHtml(m.subject)}</td>
<td>${escapeHtml(m.created_at)}</td>
<td>${escapeHtml(m.status)}</td>
<td>${escapeHtml(m.message_id)}</td>
<td><a href="/mail/${encodeURIComponent(m.message_id)}">Open</a></td>
</tr>`
    )
    .join("");

  return `<!doctype html>
<html>
  <body>
    <h1>MailPort Test Inbox</h1>
    <table border="1">
      <thead>
        <tr>
          <th>Recipient</th>
          <th>From</th>
          <th>Subject</th>
          <th>Timestamp</th>
          <th>Status</th>
          <th>Message ID</th>
          <th>Open</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
</html>`;
}

function renderMessageDetail(message) {
  return `<!doctype html>
<html>
  <body>
    <h1>Message ${escapeHtml(message.message_id)}</h1>
    <p><strong>To:</strong> ${escapeHtml(message.to.join(", "))}</p>
    <p><strong>From:</strong> ${escapeHtml(message.from)}</p>
    <p><strong>Subject:</strong> ${escapeHtml(message.subject)}</p>
    <p><strong>Status:</strong> ${escapeHtml(message.status)}</p>
    <h2>Text</h2>
    <pre>${escapeHtml(message.text || "")}</pre>
    <h2>HTML</h2>
    <pre>${escapeHtml(message.html || "")}</pre>
    <h2>Metadata</h2>
    <pre>${escapeHtml(JSON.stringify(message.metadata || {}, null, 2))}</pre>
    <p><a href="/mail">Back to inbox</a></p>
  </body>
</html>`;
}

export function createLocalInboxServer(
  mail,
  { host = "127.0.0.1", port = 8788 } = {}
) {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, `http://${host}:${port}`);

      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === "GET" && url.pathname === "/ready") {
        return sendJson(res, 200, { ready: true });
      }

      if (req.method === "GET" && url.pathname === "/mail") {
        return sendHtml(res, 200, renderInbox(mail.test.list()));
      }

      if (req.method === "GET" && url.pathname.startsWith("/mail/")) {
        const id = decodeURIComponent(url.pathname.split("/").pop());
        const message = mail.test.get(id);
        if (!message) return sendJson(res, 404, { error: "not_found" });
        return sendHtml(res, 200, renderMessageDetail(message));
      }

      if (req.method === "GET" && url.pathname === "/v1/test/messages") {
        return sendJson(res, 200, mail.test.list(Object.fromEntries(url.searchParams.entries())));
      }

      if (req.method === "GET" && url.pathname.startsWith("/v1/test/messages/")) {
        const id = url.pathname.split("/").pop();
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
        return sendJson(res, 400, { error: error.code, message: error.message });
      }
      return sendJson(res, 500, { error: "internal_error" });
    }
  });

  return {
    async start() {
      await new Promise((resolve) => server.listen(port, host, resolve));
    },
    async stop() {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    },
  };
}
