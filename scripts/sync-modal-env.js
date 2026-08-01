/**
 * Sync Modal tokens from ~/.modal.toml into ~/.manertdev/.env
 * Prints only non-secret status fields.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const tomlPath = path.join(os.homedir(), ".modal.toml");
if (!fs.existsSync(tomlPath)) {
  console.log(JSON.stringify({ ok: false, error: "missing ~/.modal.toml — run: python -m modal setup" }));
  process.exit(1);
}

const toml = fs.readFileSync(tomlPath, "utf8");
const blocks = {};
let cur = null;
let active = null;

for (const raw of toml.split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const activeMatch = line.match(/^active\s*=\s*["']?([^"'\s]+)/i);
  if (activeMatch && !cur) {
    active = activeMatch[1];
    continue;
  }
  const header = line.match(/^\[([^\]]+)\]/);
  if (header) {
    cur = header[1];
    blocks[cur] = {};
    continue;
  }
  const kv = line.match(/^([a-zA-Z0-9_]+)\s*=\s*["']?([^"']+?)["']?\s*$/);
  if (kv && cur) blocks[cur][kv[1]] = kv[2];
}

const profiles = Object.keys(blocks);
const name =
  active ||
  profiles.find((p) => p.toLowerCase() !== "default") ||
  profiles[0];
const b = blocks[name] || {};

const dest = path.join(os.homedir(), ".manertdev", ".env");
fs.mkdirSync(path.dirname(dest), { recursive: true });
let t = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : "";

function upsert(key, value) {
  if (!value) return false;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(t)) t = t.replace(re, `${key}=${value}`);
  else {
    if (t && !t.endsWith("\n")) t += "\n";
    t += `${key}=${value}\n`;
  }
  return true;
}

const wroteId = upsert("MODAL_TOKEN_ID", b.token_id);
const wroteSecret = upsert("MODAL_TOKEN_SECRET", b.token_secret);
const wroteProfile = upsert("MODAL_PROFILE", name);
fs.writeFileSync(dest, t);

console.log(
  JSON.stringify({
    ok: true,
    profile: name,
    wroteTokenId: wroteId,
    wroteTokenSecret: wroteSecret,
    wroteProfile,
    hasId: Boolean(b.token_id),
    hasSecret: Boolean(b.token_secret),
  }),
);
