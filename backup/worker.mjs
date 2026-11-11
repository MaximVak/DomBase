import { createBackupWorker } from "./hosted.mjs";

// No workers.dev URL or public routes. Only the app's internal service binding
// can call this Worker; platform credentials never enter the request body.
export default { fetch(request, env) { return createBackupWorker(env).fetch(request); } };
