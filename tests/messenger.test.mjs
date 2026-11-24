import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { configPath, projectRoot, runLocalDb } from "../scripts/local-db.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";
import { seedWorkforceFixture } from "./support/workforce-fixture.mjs";

test("team messenger keeps groups, mentions, searches and R2 attachments private across manager and employee logins", { timeout: 120000 }, async t => {
  const statePath = await mkdtemp(join(projectRoot, ".wrangler/messenger-check-"));
  let platform;
  t.after(async () => { try { await platform?.dispose(); } finally { await rm(statePath, { recursive: true, force: true }); } });
  await runLocalDb("migrate", [], statePath);
  const { getPlatformProxy } = await import("wrangler");
  platform = await getPlatformProxy({ configPath, persist: { path: join(statePath, "v3") }, remoteBindings: false, envFiles: [] });
  const schema = await loadServerModule("db/schema.ts");
  const db = drizzle(platform.env.DB, { schema });
  const password = "Isolated fictional messenger test password!";
  const f = await seedWorkforceFixture(db, schema, loadServerModule, password);
  const { createAuthService, createAccessService, createSelfService, newToken, newRecordId } = await loadServerModule("tests/support/workforce-runtime.ts");
  const { createMessengerService } = await loadServerModule("messenger/service.ts");
  const { cleanupMessengerUploads } = await loadServerModule("messenger/files.ts");
  const secret = "isolated-messenger-test-secret-at-least-32";
  const auth = createAuthService(db, { secret });
  const self = createSelfService(db, auth, secret);
  const access = createAccessService(db, auth);
  const service = createMessengerService(db, auth, access, self, { secret, bucket: platform.env.FILES });
  const origin = "http://localhost:3000";
  const request = (path, cookie = "", body, changes = {}) => new Request(origin + path, {
    method: body === undefined ? "GET" : "POST", headers: { Cookie: cookie, ...(body === undefined ? {} : { Origin: origin, "Content-Type": "application/json" }), ...changes },
    ...(body === undefined ? {} : { body: body instanceof Uint8Array ? body : JSON.stringify(body) }),
  });
  async function login(account) {
    const result = await auth.handle(request("/api/auth/login", "", { email: account.email, password }));
    assert.equal(result.status, 200);
    return result.headers.get("set-cookie").split(";")[0];
  }
  async function ok(response, status = 200) {
    assert.equal(response.status, status, response.status !== status ? await response.clone().text() : undefined);
    return response.json();
  }
  const [manager, employee, owner] = await Promise.all([login(f.manager), login(f.employeeAccount), login(f.owner)]);
  const call = (route, cookie = "", body, options) => service.handle(request("/api/messenger/" + route, cookie, body, options));
  const action = (cookie, body) => call("actions", cookie, body);
  const create = (overrides = {}) => ({ id: newToken(), action: "create", source: "department", conversationId: newRecordId(),
    departmentId: f.deptA.id, ...overrides });
  const byThread = (pack, thread) => pack.threads.find(row => row.id === thread);
  assert.equal((await call("inbox")).status, 401);
  assert.equal((await call("inbox", manager + "; dombase-kiosk-device=" + f.deviceToken)).status, 403);
  await t.test("existing conversations, scoped groups and authenticated roster", async () => {
    const legacy = await ok(await call("history?conversation=" + f.conversationA.id, employee));
    assert.deepEqual(legacy.messages.map(row => row.body), ["Local member message"]);
    assert.equal((await call("history?conversation=" + f.conversationB.id, manager)).status, 404);
    const roster = await ok(await call("roster", manager));
    assert.ok(roster.people.some(row => row.id === f.a.id));
    assert.ok(!roster.people.some(row => row.id === f.b.id));
    assert.deepEqual(roster.departments.map(row => row.id), [f.deptA.id]);
    assert.equal((await action(manager, create({ departmentId: f.deptB.id }))).status, 404);
    assert.equal((await action(manager, create({ source: "people", people: [f.b.id] }))).status, 403);
    assert.equal((await action(employee, create({ departmentId: f.deptB.id }))).status, 404);
    const [newer, older] = await db.insert(schema.messages).values([
      { conversationId: f.conversationA.id, senderEmployeeId: f.managerEmployee.id, body: "Legacy afternoon queue", sentAt: "2026-10-03 22:00:00" },
      { conversationId: f.conversationA.id, senderEmployeeId: f.managerEmployee.id, body: "Legacy morning queue", sentAt: "2026-10-03T18:00:00.000Z" },
    ]).returning();
    const page = await ok(await call("history?conversation=" + f.conversationA.id + "&anchor=" + newer.id, employee));
    assert.deepEqual(page.messages.map(row => row.id), [older.id, newer.id]);
    await ok(await action(employee, { action: "read", conversationId: f.conversationA.id, through: older.id }));
    assert.deepEqual((await db.select().from(schema.messageReads)).filter(row => row.conversationId === f.conversationA.id).map(row => row.messageId), [older.id]);
  });
  const [publication] = await db.insert(schema.schedulePublications).values({ version: 1, publishedByAccountId: f.owner.id, notifyMode: "none" }).returning();
  const date = "2026-12-07";
  await db.insert(schema.shifts).values([
    { employeeId: f.a.id, roleId: f.roleA.id, date, startTime: "10:00", endTime: "14:00", publicationId: publication.id },
    { employeeId: f.b.id, roleId: f.roleB.id, date, startTime: "10:00", endTime: "14:00", publicationId: publication.id },
    { employeeId: f.multi.id, roleId: f.roleA.id, date, startTime: "11:00", endTime: "15:00" },
  ]);
  await t.test("published schedule groups use current roles and an employee's own scheduled date", async () => {
    const scheduled = create({ source: "schedule", date });
    const { id } = await ok(await action(manager, scheduled), 201);
    const data = await ok(await call("history?conversation=" + id, manager));
    assert.deepEqual(data.members.map(row => row.id).sort(), [f.managerEmployee.id, f.a.id].sort());
    const memberSchedule = await ok(await action(employee, create({ source: "schedule", date })), 201);
    assert.ok((await ok(await call("history?conversation=" + memberSchedule.id, employee))).members.some(row => row.id === f.b.id));
    assert.equal((await action(employee, create({ source: "schedule", date: "2026-12-09" }))).status, 404);
  });

  const department = create({ name: "Fixture department coordination" });
  const { id: conversationId } = await ok(await action(manager, department), 201);
  assert.deepEqual(await ok(await action(manager, department), 201), { id: conversationId });
  const historyPath = "history?conversation=" + conversationId;
  const send = (body, mentions = [], attachments = []) => ({ action: "send", id: newToken(), conversationId, body, mentions, attachments });
  const pdf = new TextEncoder().encode("%PDF-1.4\nSynthetic messenger file\n");
  const fileId = newToken();
  const upload = (token, bytes = pdf, cookie = manager, content = "application/pdf", name = "Private shift note.pdf", originHeader = origin) =>
    call("files?conversation=" + conversationId, cookie, bytes,
      { "Content-Type": content, "x-file-name": encodeURIComponent(name), "x-upload-id": token, Origin: originHeader });
  await t.test("draft and published attachment bytes use distinct access rules", async () => {
    assert.equal((await upload(newToken(), pdf, owner)).status, 404);
    assert.equal((await upload(newToken(), pdf, manager, "application/pdf", "private.pdf", "http://localhost:8000")).status, 403);
    assert.equal((await upload(newToken(), new TextEncoder().encode("invalid PDF"))).status, 415);
    const staged = await ok(await upload(fileId), 201);
    assert.equal(staged.name, "Private shift note.pdf");
    assert.equal((await call("files/" + fileId, employee)).status, 404);
    assert.equal((await action(employee, send("Upload belongs to someone else", [], [fileId]))).status, 409);
    const payload = send("Tuesday coverage @"+f.a.name, [f.a.id], [fileId]);
    const first = await ok(await action(manager, payload), 201);
    assert.deepEqual(await ok(await action(manager, payload), 201), first);
    assert.equal((await action(manager, { ...payload, body: "changed payload" })).status, 409);
    const history = await ok(await call(historyPath, employee));
    assert.equal(history.messages.length, 1);
    assert.deepEqual(history.messages[0].attachments, [staged]);
    assert.deepEqual(history.messages[0].mentions, [{ id: f.a.id, name: f.a.name }]);
    assert.equal((await call("files/" + fileId, owner)).status, 404);
    const downloaded = await call("files/" + fileId, employee);
    assert.equal(downloaded.status, 200);
    assert.match(downloaded.headers.get("content-disposition"), /^attachment;/);
    assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), pdf);
    assert.equal((await call(historyPath, owner)).status, 404);
    assert.equal((await action(owner, send("Unauthorized"))).status, 404);
    assert.equal((await action(manager, send("@"+f.b.name, [f.b.id]))).status, 400);
    assert.equal((await ok(await call("search?term=Tuesday", employee))).hits[0].id, first.id);
    assert.equal((await ok(await call("search?term=Private+shift+note", employee))).hits[0].id, first.id);
    assert.deepEqual((await ok(await call("search?term=Tuesday", owner))).hits, []);
    assert.equal((await ok(await call(historyPath + "&anchor=" + first.id, employee))).messages[0].id, first.id);
    assert.equal(byThread(await ok(await call("inbox", employee)), conversationId).mentions, 1);
    await ok(await action(employee, { action: "read", conversationId, through: first.id }));
    assert.equal(byThread(await ok(await call("inbox", employee)), conversationId).mentions, 0);
  });
  await t.test("mention opt-out and muted conversations suppress alert badges", async () => {
    const pref = "/api/self/notification-preferences";
    const writeChoice = async checked => {
      const { revision, version, scheduleVersion, contextToken } = await ok(await self.handle(request(pref, employee)));
      await ok(await self.handle(request(pref, employee, { id: newToken(), revision, version, scheduleVersion, contextToken, events: { mention: { inApp: checked } } })));
    };
    await writeChoice(false);
    await ok(await action(manager, send("@"+f.a.name+" opted out", [f.a.id])), 201);
    let thread = byThread(await ok(await call("inbox", employee)), conversationId);
    assert.equal(thread.unread, 1); assert.equal(thread.mentions, 0);
    await writeChoice(true);
    assert.equal(byThread(await ok(await call("inbox", employee)), conversationId).mentions, 0);
    await ok(await action(employee, { action: "preferences", conversationId, muted: true }));
    await ok(await action(manager, send("@"+f.a.name+" muted", [f.a.id])), 201);
    await ok(await action(employee, { action: "preferences", conversationId, muted: false, pinned: true }));
    thread = byThread(await ok(await call("inbox", employee)), conversationId);
    assert.equal(thread.mentions, 0); assert.equal(thread.pinned, true);
  });
  await t.test("unused attachment bytes expire and team messaging uses the existing company setting", async () => {
    const unused = newToken();
    await ok(await upload(unused), 201);
    await db.update(schema.messageAttachments).set({ expiresAt: "2025-01-01T00:00:00.000Z" }).where(eq(schema.messageAttachments.fileId, unused));
    await cleanupMessengerUploads(db, platform.env.FILES);
    assert.equal(await platform.env.FILES.get("message-attachments/" + unused), null);
    assert.equal((await db.get(sql`SELECT status FROM files WHERE id=${unused}`)).status, "deleted");
    assert.equal((await call("files/" + fileId, employee)).status, 200);
    await db.update(schema.locationSettings).set({ enableTeamMessaging: false });
    assert.equal((await call("inbox", employee)).status, 403);
    assert.equal((await call("files/" + fileId, employee)).status, 403);
  });
});
