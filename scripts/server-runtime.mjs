import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { projectRoot } from "./local-db.mjs";

// Wrangler already pins the TS loader used by these local operator/test tools.
const require = createRequire(import.meta.resolve("wrangler"));
export const { tsImport } = require("tsx/esm/api");
export const loadServerModule = relativePath => tsImport(pathToFileURL(resolve(projectRoot, relativePath)).href, import.meta.url);
