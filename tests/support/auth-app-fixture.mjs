import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import { configPath, projectRoot, runLocalDb } from "../../scripts/local-db.mjs";
import { loadServerModule } from "../../scripts/server-runtime.mjs";

// Only isolated test databases use these credentials. This is not a seed command.
export const testEmail = "local-owner@example.test";
export const testPassword = "Local browser verification passphrase!";

export async function startAuthApp({ seed } = {}) {
  await mkdir(join(projectRoot, ".wrangler"), { recursive: true });
  const statePath = await mkdtemp(join(projectRoot, ".wrangler/auth-app-"));
  let worker;
  let platform;
  async function close() {
    try { await worker?.stop(); await platform?.dispose(); }
    finally { await rm(statePath, { recursive: true, force: true }); }
  }
  try {
    await runLocalDb("migrate", [], statePath);
    const { getPlatformProxy, unstable_dev } = await import("wrangler");
    const schema = await loadServerModule("db/schema.ts");
    const { issueSetupToken } = await loadServerModule("auth/service.ts");
    platform = await getPlatformProxy({ configPath, persist: { path: join(statePath, "v3") }, remoteBindings: false, envFiles: [] });
    const db = drizzle(platform.env.DB, { schema });
    const grant = await issueSetupToken(db, { email: testEmail, displayName: "Local verification owner", accessLevel: "owner" });
    const previewGrant = await issueSetupToken(db, { email: "setup-preview@example.test", displayName: "Setup preview", accessLevel: "manager" });
    const fixtureData = seed ? await seed(db, schema, loadServerModule, testPassword) : undefined;
    await platform.dispose();
    platform = undefined;
    worker = await unstable_dev(join(projectRoot, "dist/server/index.js"), {
      config: join(projectRoot, "dist/server/wrangler.json"), local: true,
      ip: "127.0.0.1", port: 0, inspect: false, logLevel: "error", persist: true, persistTo: statePath,
      vars: { AUTH_RATE_LIMIT_SECRET: "isolated-app-verification-secret-at-least-32-characters", AUTH_PRIVATE_FIELD_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, envFiles: [],
      experimental: { disableExperimentalWarning: true, watch: false, disableDevRegistry: true },
    });
    const origin = `http://${worker.address}:${worker.port}`;
    const setup = await fetch(`${origin}/api/auth/setup`, {
      method: "POST", signal: AbortSignal.timeout(30000), headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ token: grant.token, password: testPassword }),
    });
    const setupBody = await setup.text();
    if (setup.status !== 200) throw new Error(`Isolated Worker setup failed (${setup.status}): ${setupBody}`);
    return { origin, email: testEmail, password: testPassword, fixtureData, setupLink: `${origin}/setup#token=${previewGrant.token}`, close };
  } catch (error) { await close(); throw error; }
}
