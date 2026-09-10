import dns from "node:dns/promises";
import { MailPortError, ERROR_CODES } from "./errors.js";

export async function validateMtaIdentity({ hostname, egressIp, resolver = dns } = {}) {
  if (!hostname || !egressIp) throw new MailPortError(ERROR_CODES.MAIL_NOT_CONFIGURED,
    "Direct MX delivery requires MAILPORT_MTA_HOSTNAME and MAILPORT_EGRESS_IP");
  let reverse;
  try { reverse = await resolver.reverse(egressIp); } catch { reverse = []; }
  if (!reverse.map((value) => value.replace(/\.$/, "").toLowerCase()).includes(hostname.replace(/\.$/, "").toLowerCase()))
    throw new MailPortError(ERROR_CODES.MAIL_NOT_CONFIGURED, `PTR for ${egressIp} must resolve to ${hostname}`);
  let forward = [];
  try { forward = egressIp.includes(":") ? await resolver.resolve6(hostname) : await resolver.resolve4(hostname); } catch {}
  if (!forward.includes(egressIp)) throw new MailPortError(ERROR_CODES.MAIL_NOT_CONFIGURED,
    `${hostname} must resolve forward to ${egressIp}`);
  return { hostname, egressIp, ptr: true, forward: true, fcrdns: true };
}

export async function probeEgressIp(url, fetcher = globalThis.fetch) {
  if (!url) return null;
  let response;
  try { response = await fetcher(url, { headers: { accept: "application/json, text/plain" }, signal: AbortSignal.timeout(5000) }); }
  catch (error) { throw new MailPortError(ERROR_CODES.MAIL_NOT_CONFIGURED, `Could not verify public egress IP: ${error.message}`); }
  if (!response.ok) throw new MailPortError(ERROR_CODES.MAIL_NOT_CONFIGURED,
    `Could not verify public egress IP: probe returned HTTP ${response.status}`);
  const text = (await response.text()).trim();
  try { const value = JSON.parse(text); return String(value.ip || value.address || value.origin || "").trim(); }
  catch { return text; }
}

export async function validateMtaEgress({ expectedIp, probeUrl, fetcher } = {}) {
  if (!probeUrl) return { checked: false, expectedIp };
  const observedIp = await probeEgressIp(probeUrl, fetcher);
  if (observedIp !== expectedIp) throw new MailPortError(ERROR_CODES.MAIL_NOT_CONFIGURED,
    `Declared egress IP ${expectedIp} does not match observed public egress IP ${observedIp || "unknown"}`);
  return { checked: true, expectedIp, observedIp };
}
