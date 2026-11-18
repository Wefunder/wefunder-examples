// A tripwire for the rule in lib/server.ts: nothing about the round is rendered or returned
// without a signed-in data-room user. Every page and route handler must check who is signed in,
// except the login page and the two routes that start and end a session. A new file under app/
// that forgets fails here, before it can put raise totals or an invest link on an open URL.
//
// It also holds the two rules that keep the installation token on the server: only lib/env.ts
// reads it, and the Client Component imports nothing that could carry it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const walk = (dir: string): string[] =>
  readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const OPEN = new Set(["app/login/page.tsx", "app/api/login/route.ts", "app/api/logout/route.ts"]);

test("every page and route checks the signed-in user before anything else", () => {
  const entries = walk("app").filter((f) => /(^|\/)(page\.tsx|route\.ts)$/.test(f));
  assert.ok(entries.length >= 6, "found the app's pages and routes");
  for (const file of entries) {
    if (OPEN.has(file)) continue;
    assert.match(read(file), /await (requireUser|requireFounder|currentUser)\(\)/, `${file} must check the signed-in user`);
  }
});

test("only lib/env.ts reads the installation token, and it is server-only", () => {
  const sources = [...walk("app"), ...walk("lib")].filter((f) => /\.tsx?$/.test(f));
  const readers = sources.filter((f) => read(f).includes("WEFUNDER_INSTALL_TOKEN"));
  assert.deepEqual(readers, ["lib/env.ts"]);
  assert.match(read("lib/env.ts"), /^import "server-only";$/m);
  assert.match(read("lib/server.ts"), /^import "server-only";$/m);
});

test("the Client Component imports only display helpers and types", () => {
  const clients = walk("app").filter((f) => /\.tsx$/.test(f) && /^"use client";/.test(read(f)));
  assert.deepEqual(clients, ["app/invest_panel.tsx"]);
  for (const file of clients) {
    const imports = [...read(file).matchAll(/^import (type )?.*? from "(.+?)";$/gm)].map((m) => ({ typeOnly: Boolean(m[1]), from: m[2] }));
    for (const i of imports) {
      const allowed = i.from === "react" || i.from === "@/lib/states.ts" || (i.typeOnly && i.from === "@/lib/wefunder.ts");
      assert.ok(allowed, `${file} imports ${i.from}`);
    }
  }
});
