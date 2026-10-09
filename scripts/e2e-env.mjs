// Loads accepted component values from gitignored .env.e2e through stdin only.
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

export const deploymentNames = [
  "ZOHO_CPAAS_REGION",
  "ZOHO_CPAAS_BASE_URL",
  "ZOHO_CPAAS_TOKEN",
  "ZOHO_CPAAS_EMAIL_TOKEN",
  "ZOHO_CPAAS_SMS_TOKEN",
  "ZOHO_CPAAS_WHATSAPP_TOKEN",
  "ZOHO_CPAAS_WEBHOOK_SECRET",
  "ZOHO_CPAAS_WEBHOOK_SECRET_PREVIOUS",
  "ZOHO_CPAAS_RETENTION_DAYS",
];
const allowed = new Set(deploymentNames);
const testModeName = "ZOHO_CPAAS_TEST_MODE";
const selectorNames = [
  "CONVEX_DEPLOY_KEY",
  "CONVEX_DEPLOYMENT_TOKEN",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
  "CONVEX_OVERRIDE_ACCESS_TOKEN",
];

export function getLocalCliEnv(path = ".env.local", ambient = process.env) {
  if (!existsSync(path))
    throw new Error("Existing anonymous local deployment is required (.env.local missing)");
  const file = readFileSync(path, "utf8");
  // Convex uses dotenv for --env-file. Node's parser shares its last-wins and
  // whitespace behavior, but rejects dotenv's colon assignment syntax here.
  if (/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*:\s*\S/m.test(file))
    throw new Error("Unsupported .env.local assignment syntax");
  const parsed = parseEnv(file);
  const deployment = parsed.CONVEX_DEPLOYMENT?.trim();
  const cloud = parsed.CONVEX_URL?.trim();
  const site = parsed.CONVEX_SITE_URL?.trim();
  if (!deployment || (!deployment.startsWith("anonymous:") && !deployment.startsWith("local:")))
    throw new Error("An existing anonymous local Convex deployment is required");
  if (selectorNames.some((name) => parsed[name]?.trim()))
    throw new Error(".env.local contains a cloud or self-hosted deployment selector");
  for (const value of [cloud, site]) {
    if (!value) throw new Error("Local Convex URL and site URL are required");
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Invalid local Convex endpoint");
    }
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !url.port ||
      url.username ||
      url.password
    )
      throw new Error("Nonlocal Convex endpoint refused");
  }
  const env = { ...ambient };
  for (const name of [...selectorNames, "CONVEX_URL", "CONVEX_SITE_URL"]) env[name] = "";
  for (const name of Object.keys(env))
    if (name.startsWith("ZOHO_CPAAS_") || name.startsWith("E2E_")) delete env[name];
  env.CONVEX_DEPLOYMENT = deployment;
  env.CONVEX_AGENT_MODE = "anonymous";
  return { env, site };
}

export function readE2eEnv(path = ".env.e2e") {
  if (!existsSync(path)) throw new Error("Missing .env.e2e. Copy .env.e2e.example and fill it in.");
  const values = new Map();
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    values.set(key, value);
  }
  return values;
}

function convexEnv(args, input, cliEnv) {
  const result = spawnSync("pnpm", ["exec", "convex", "env", ...args], {
    input,
    stdio: ["pipe", "ignore", "pipe"],
    encoding: "utf8",
    env: cliEnv,
  });
  return result.status === 0;
}

export function loadE2eEnv(values, { replace = false } = {}) {
  const { env } = getLocalCliEnv();
  const names = [];
  for (const key of deploymentNames) {
    const value = values.get(key);
    if (value) {
      if (!convexEnv(["set", key], value, env)) throw new Error(`Failed to set ${key}`);
      names.push(key);
    } else if (replace) {
      // A stale per-channel override must not silently replace the shared token.
      if (!convexEnv(["remove", key], undefined, env)) throw new Error(`Failed to remove ${key}`);
    }
  }
  if (!convexEnv(["remove", testModeName], undefined, env))
    throw new Error(`Failed to remove ${testModeName}`);
  return names;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const values = readE2eEnv();
    if (![...values.keys()].some((key) => allowed.has(key) && values.get(key)))
      throw new Error("No deployment variables found in .env.e2e.");
    for (const key of loadE2eEnv(values)) console.log(`set ${key}`);
    console.log(`removed ${testModeName} (e2e mode)`);
  } catch (error) {
    // Never include CLI stderr or configuration values in maintainer output.
    console.error(error instanceof Error ? error.message : "Failed to load .env.e2e");
    process.exitCode = 1;
  }
}
