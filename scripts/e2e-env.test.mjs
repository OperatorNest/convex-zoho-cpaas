// @vitest-environment node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { getLocalCliEnv } from "./e2e-env.mjs";

test("local CLI env pins deployment and blocks ambient cloud selectors", () => {
  const dir = mkdtempSync(join(tmpdir(), "zoho-local-env-test-"));
  try {
    const path = join(dir, ".env.local");
    writeFileSync(
      path,
      "CONVEX_DEPLOYMENT=anonymous:local-test\nCONVEX_URL=http://127.0.0.1:3210\nCONVEX_SITE_URL=http://127.0.0.1:3211\n",
    );
    const { env, site } = getLocalCliEnv(path, {
      CONVEX_DEPLOY_KEY: "dummy",
      CONVEX_DEPLOYMENT_TOKEN: "dummy",
      CONVEX_SELF_HOSTED_URL: "https://example.invalid",
      CONVEX_OVERRIDE_ACCESS_TOKEN: "dummy",
      CONVEX_DEPLOYMENT: "dev:cloud-name",
    });
    assert.equal(env.CONVEX_DEPLOYMENT, "anonymous:local-test");
    assert.equal(env.CONVEX_DEPLOY_KEY, "");
    assert.equal(env.CONVEX_DEPLOYMENT_TOKEN, "");
    assert.equal(env.CONVEX_SELF_HOSTED_URL, "");
    assert.equal(env.CONVEX_OVERRIDE_ACCESS_TOKEN, "");
    assert.equal(site, "http://127.0.0.1:3211");
    for (const prefix of ["", "export ", "  "]) {
      writeFileSync(
        path,
        `${prefix}CONVEX_DEPLOY_KEY=dummy\nCONVEX_DEPLOYMENT=anonymous:local-test\nCONVEX_URL=http://127.0.0.1:3210\nCONVEX_SITE_URL=http://127.0.0.1:3211\n`,
      );
      assert.throws(() => getLocalCliEnv(path), /selector/);
    }
    writeFileSync(
      path,
      "CONVEX_DEPLOYMENT=anonymous:local-test\nCONVEX_DEPLOYMENT=dev:cloud\nCONVEX_URL=http://127.0.0.1:3210\nCONVEX_SITE_URL=http://127.0.0.1:3211\n",
    );
    assert.throws(() => getLocalCliEnv(path), /anonymous local/);
    writeFileSync(
      path,
      "CONVEX_DEPLOYMENT=anonymous:local-test\nCONVEX_URL=http://127.0.0.1:3210\nCONVEX_URL=https://example.invalid\nCONVEX_SITE_URL=http://127.0.0.1:3211\n",
    );
    assert.throws(() => getLocalCliEnv(path), /Nonlocal/);
    writeFileSync(
      path,
      "CONVEX_DEPLOY_KEY: dummy\nCONVEX_DEPLOYMENT=anonymous:local-test\nCONVEX_URL=http://127.0.0.1:3210\nCONVEX_SITE_URL=http://127.0.0.1:3211\n",
    );
    assert.throws(() => getLocalCliEnv(path), /Unsupported/);
    writeFileSync(
      path,
      "CONVEX_DEPLOY_KEY=`dummy`\nCONVEX_DEPLOYMENT=anonymous:local-test\nCONVEX_URL=http://127.0.0.1:3210\nCONVEX_SITE_URL=http://127.0.0.1:3211\n",
    );
    assert.throws(() => getLocalCliEnv(path), /selector/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
