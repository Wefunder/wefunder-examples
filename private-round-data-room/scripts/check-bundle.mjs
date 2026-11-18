// Run after `next build`: fail if anything that belongs on the server ended up in the files the
// browser downloads (.next/static). It looks for the installation token's variable name, the
// token value the build ran with, and the SDK's API host, which only the SDK carries.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), ".next", "static");
const needles = ["WEFUNDER_INSTALL_TOKEN", "api.wefunder.com", process.env.WEFUNDER_INSTALL_TOKEN].filter(Boolean);

const files = [];
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const full = path.join(d, name);
    if (statSync(full).isDirectory()) walk(full);
    else files.push(full);
  }
};

try {
  walk(dir);
} catch {
  console.error(`check-bundle: ${dir} not found. Run \`npm run build\` first.`);
  process.exit(1);
}

const hits = [];
for (const file of files) {
  const text = readFileSync(file, "latin1");
  for (const needle of needles) if (text.includes(needle)) hits.push(`${path.relative(process.cwd(), file)} contains ${needle === process.env.WEFUNDER_INSTALL_TOKEN ? "the installation token" : needle}`);
}

if (hits.length > 0) {
  console.error(`check-bundle: server-only material reached the browser bundle:\n  ${hits.join("\n  ")}`);
  process.exit(1);
}
console.log(`check-bundle: ${files.length} browser files, none carry the installation token or the SDK.`);
