import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
export const configPath = resolve(projectRoot, "wrangler.local.jsonc");
export const persistPath = resolve(projectRoot, ".wrangler/state");

// Set these before dynamically importing Wrangler (which snapshots its log path).
process.env.WRANGLER_SEND_METRICS = "false";
process.env.WRANGLER_WRITE_LOGS = "false";
process.env.WRANGLER_LOG_PATH = resolve(projectRoot, ".wrangler/logs");
process.env.MINIFLARE_REGISTRY_PATH = resolve(projectRoot, ".wrangler/registry");

export function runLocalDb(action, args = [], statePath = persistPath) {
  const commands = {
    migrate: ["migrations", "apply"],
    status: ["migrations", "list"],
    execute: ["execute"],
  };
  if (!Object.hasOwn(commands, action)) {
    throw new Error("Use migrate, status, or execute.");
  }
  const forbidden = /^(?:-c|-e|--(?:remote|local|config|env|persist-to))(?:=|$)/;
  if (args.some(arg => forbidden.test(arg))) {
    throw new Error("Local database commands cannot override the config, environment, or target.");
  }
  const wrangler = fileURLToPath(import.meta.resolve("wrangler/bin/wrangler.js"));
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [
      wrangler, "d1", ...commands[action], "dombase-local",
      "--config", configPath, "--local", "--persist-to", statePath, ...args,
    ], {
      cwd: projectRoot,
      env: { ...process.env, CI: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", data => { output += data; });
    child.stderr.on("data", data => { output += data; });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) accept(output);
      else reject(new Error(`Local database ${action} failed (${code}):\n${output}`));
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.stdout.write(await runLocalDb(process.argv[2], process.argv.slice(3)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
