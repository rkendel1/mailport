import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createDirectMxTransport, FileSigningKeyStore, validateMtaEgress, validateMtaIdentity } from "../src/index.js";

function smtpServer() {
  let received = "";
  const server = net.createServer((socket) => { socket.write("220 mx.example.test ESMTP\r\n"); let dataMode = false; let buffer = "";
    socket.on("data", (chunk) => { buffer += chunk; received += chunk;
      while (buffer.includes("\r\n")) { const end = buffer.indexOf("\r\n"); const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (dataMode) { if (line === ".") { dataMode = false; socket.write("250 2.0.0 queued\r\n"); } continue; }
        if (line.startsWith("EHLO")) socket.write("250-mx.example.test\r\n250 8BITMIME\r\n");
        else if (line.startsWith("MAIL FROM")) socket.write("250 2.1.0 ok\r\n");
        else if (line.startsWith("RCPT TO")) socket.write("250 2.1.5 ok\r\n");
        else if (line === "DATA") { dataMode = true; socket.write("354 end with dot\r\n"); }
        else if (line === "QUIT") { socket.write("221 bye\r\n"); socket.end(); }
      }
    }); });
  return { server, received: () => received };
}

test("direct MX transport resolves recipient MX and waits for DATA acceptance", async () => {
  const smtp = smtpServer(); await new Promise((resolve) => smtp.server.listen(0, "127.0.0.1", resolve));
  const port = smtp.server.address().port;
  const transport = createDirectMxTransport({ hostname: "mail.sender.test", port,
    resolver: { async resolveMx(domain) { assert.equal(domain, "recipient.test"); return [{ priority: 10, exchange: "127.0.0.1" }]; } } });
  const result = await transport.send({ message_id: "msg_direct", from: "auth@sender.test", to: ["user@recipient.test"],
    cc: [], bcc: [], reply_to: [], subject: "Direct", text: "hello", html: "<p>hello</p>", attachments: [] });
  smtp.server.close();
  assert.equal(result.status, "sent"); assert.match(smtp.received(), /EHLO mail\.sender\.test/); assert.match(smtp.received(), /Subject: Direct/);
});

test("encrypted signing keys survive restart without plaintext persistence", () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mailport-keys-")), "keys.json");
  const encryptionKey = crypto.randomBytes(32).toString("base64");
  const first = new FileSigningKeyStore({ filePath, encryptionKey }); first.set("example.test", "PRIVATE MATERIAL");
  assert.equal(fs.readFileSync(filePath, "utf8").includes("PRIVATE MATERIAL"), false);
  assert.equal(new FileSigningKeyStore({ filePath, encryptionKey }).get("example.test"), "PRIVATE MATERIAL");
});

test("MTA readiness requires matching PTR and forward DNS", async () => {
  const resolver = { async reverse() { return ["mail.example.test"]; }, async resolve4() { return ["192.0.2.10"]; } };
  assert.deepEqual(await validateMtaIdentity({ hostname: "mail.example.test", egressIp: "192.0.2.10", resolver }),
    { hostname: "mail.example.test", egressIp: "192.0.2.10", ptr: true, forward: true, fcrdns: true });
  await assert.rejects(() => validateMtaIdentity({ hostname: "wrong.example.test", egressIp: "192.0.2.10", resolver }),
    { code: "MAIL_NOT_CONFIGURED" });
});

test("MTA readiness can verify actual public egress against the declaration", async () => {
  const fetcher = async () => new Response(JSON.stringify({ ip: "192.0.2.10" }), { status: 200 });
  assert.deepEqual(await validateMtaEgress({ expectedIp: "192.0.2.10", probeUrl: "https://probe.test/ip", fetcher }),
    { checked: true, expectedIp: "192.0.2.10", observedIp: "192.0.2.10" });
  await assert.rejects(() => validateMtaEgress({ expectedIp: "192.0.2.11", probeUrl: "https://probe.test/ip", fetcher }),
    { code: "MAIL_NOT_CONFIGURED" });
});
