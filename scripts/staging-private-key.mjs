import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { projectRoot, readStagingConfig, wrangler, stagingPath } from "./staging.mjs";
await readStagingConfig();
const names = await wrangler(["secret", "list", "--config", stagingPath], { capture: true });
if (/\bAUTH_PRIVATE_FIELD_KEY\b/.test(names)) console.log("Hosted private-field key already exists; preserved without rotation.");
else {
  const dir = join(projectRoot, ".wrangler/secrets"); await mkdir(dir, { recursive: true, mode: 0o700 }); await chmod(dir, 0o700);
  const path = join(dir, "staging-private-field-key"); let value;
  try { value = (await readFile(path, "utf8")).trim(); }
  catch (error) { if (error.code !== "ENOENT") throw new Error("Could not read the private local key backup."); value = randomBytes(32).toString("base64url"); await writeFile(path, value + "\n", { mode: 0o600, flag: "wx" }); }
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error("Invalid private key backup; refusing to replace it.");
  await chmod(path, 0o600);
  await wrangler(["secret", "put", "AUTH_PRIVATE_FIELD_KEY", "--config", stagingPath], { input: value + "\n", capture: true });
  console.log("Configured the independent hosted private-field key; private local recovery copy saved. Value not displayed. Existing PIN/rate key preserved.");
}
