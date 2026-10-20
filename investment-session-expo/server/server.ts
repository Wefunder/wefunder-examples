import { createServer } from "node:http";
import { handle } from "./lib/app.ts";
import { env } from "./lib/env.ts";

const deps = { token: env.installToken, returnUrl: env.returnUrl, apiBase: env.apiBase, offeringIds: env.offeringIds };

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  let body: unknown = null;
  if (chunks.length) {
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { body = null; }
  }
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  let reply;
  try {
    reply = await handle(req.method ?? "GET", path, body, deps);
  } catch (e) {
    console.error(e);
    reply = { status: 500, body: { error: { type: "internal", message: "internal error" } } };
  }
  res.writeHead(reply.status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(reply.body));
}).listen(env.port, () => {
  console.log(`investment-session server on http://0.0.0.0:${env.port} (offerings: ${env.offeringIds.join(", ")})`);
});
