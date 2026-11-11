// Prove scheduled execution via its non-personal D1 receipt, without raw Worker logs.
import { writeFile } from "node:fs/promises";
import { cloudflare } from "./cloudflare-api.mjs";
import { readStagingConfig, stagingAccount, stagingName, stagingPath, wrangler } from "./staging.mjs";
const config = await readStagingConfig();
const base = `/accounts/${stagingAccount}`;
const schedules = await cloudflare(`${base}/workers/scripts/${stagingName}/schedules`);
if (!schedules.schedules?.some(schedule => schedule.cron === "* * * * *")) throw new Error("The expected maintenance schedule is not configured.");
const deadline = Date.now() + 16 * 60000;
let found;
while (Date.now() < deadline) {
  let result;
  try {
    result = await cloudflare(`${base}/d1/database/${config.d1_databases[0].database_id}/query`, { method: "POST", body: { sql: "SELECT created_at FROM audit_log WHERE action = 'maintenance.scheduled' AND entity_type = 'system' AND entity_id = 'scheduled-workforce' ORDER BY id DESC LIMIT 1", params: [] } });
  } catch (error) {
    if (!error.message.includes("HTTP 401")) throw error;
    await wrangler(["whoami", "--config", stagingPath], { capture: true }); continue;
  }
  found = result[0].results[0];
  if (found) break;
  await new Promise(resolve => setTimeout(resolve, 15000));
}
if (!found) throw new Error("Configured schedule has no execution receipt within the propagation window.");
const deployment = await cloudflare(`${base}/workers/scripts/${stagingName}/deployments`);
const proof = { at: new Date().toISOString(), cron: "* * * * *", receiptAt: found.created_at, version: deployment.deployments[0].versions[0].version_id, scheduledHandlerObserved: true };
await writeFile(".wrangler/releases/step7-scheduled-execution.json", JSON.stringify(proof, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify(proof));
