import http from "node:http";
import { URL } from "node:url";

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
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
</html>`;
}

export function createLocalInboxServer(
  mail,
  { host = "127.0.0.1", port = 8788 } = {}
) {
  const server = http.createServer((req, res) => {
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
