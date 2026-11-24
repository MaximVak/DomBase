import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { configPath, projectRoot, runLocalDb } from "../scripts/local-db.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";
import { seedWorkforceFixture } from "./support/workforce-fixture.mjs";

test("company channels follow current roles and announcements protect confirmations and email copies", { timeout: 120000 }, async t => {
  const statePath = await mkdtemp(join(projectRoot, ".wrangler/channels-check-"));
  let platform;
  t.after(async () => { try { await platform?.dispose(); } finally { await rm(statePath, { recursive: true, force: true }); } });
  await runLocalDb("migrate", [], statePath);
  const { getPlatformProxy } = await import("wrangler");
  platform = await getPlatformProxy({ configPath, persist: { path: join(statePath, "v3") }, remoteBindings: false, envFiles: [] });
  const schema = await loadServerModule("db/schema.ts");
  const db = drizzle(platform.env.DB, { schema });
  const password = "Isolated company channels fixture password!";
  const f = await seedWorkforceFixture(db, schema, loadServerModule, password);
  const { createAuthService, createAccessService, createSelfService, newToken, createMessengerService, dispatchAnnouncementEmails } =
    await loadServerModule("tests/support/workforce-runtime.ts");
  const secret = "isolated-channel-test-secret-at-least-32";
  const auth = createAuthService(db, { secret });
  const access = createAccessService(db, auth);
  const self = createSelfService(db, auth, secret);
  const now = Date.now();
  const service = createMessengerService(db, auth, access, self, { secret, now: () => now, announcementEmail: true });
  const disabledDelivery = createMessengerService(db, auth, access, self, { secret, now: () => now });
  const origin = "http://localhost:3000";
  const request = (path, cookie = "", body, site = origin) => new Request(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Cookie: cookie, ...(body === undefined ? {} : { Origin: site, "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
  const [employee, manager, owner, gm] = await Promise.all([login(f.employeeAccount), login(f.manager), login(f.secondOwner), login(f.generalManager)]);
  const call = (path, cookie = "", body) => service.handle(request("/api/messenger/" + path, cookie, body));
  const feed = (channel, cookie) => call("channels/feed?channel=" + channel, cookie);
  const action = (cookie, body) => call("channels/actions", cookie, body);
  const announce = (channel, title, extra = {}) => ({ action: "announce", id: newToken(), channel, title, body: title + " details",
    pin: true, email: true, ...extra });
  const home = cookie => call("channels/home", cookie).then(ok);
  let companyId, managerId;

  await t.test("company and managers channels use active accounts and current messages permission", async () => {
    assert.equal((await feed("company", "")).status, 401);
    assert.equal((await call("channels/home", manager + "; dombase-kiosk-device=" + f.deviceToken)).status, 403);
    assert.deepEqual((await ok(await feed("company", employee))).channels, ["company"]);
    assert.equal((await feed("managers", employee)).status, 404);
    assert.deepEqual((await ok(await feed("managers", manager))).channels, ["company", "managers"]);
    assert.equal((await call("inbox", owner)).status, 403);
    assert.equal((await ok(await feed("company", owner))).canPublish, true);
    assert.equal((await ok(await feed("company", gm))).canPublish, true);
    assert.equal((await action(manager, announce("company", "Denied"))).status, 403);
    assert.equal((await action(employee, { action: "post", id: newToken(), body: "Denied", channel: "managers" })).status, 404);
    assert.equal((await service.handle(request("/api/messenger/channels/actions", manager, { action: "post" }, "https://example.test"))).status, 403);
    const post = { action: "post", id: newToken(), channel: "managers", body: "Manager-only operational note" };
    const result = await ok(await action(manager, post), 201);
    assert.deepEqual(await ok(await action(manager, post), 201), result);
    assert.ok((await ok(await feed("managers", gm))).posts.some(row => row.id === result.id));
    await db.insert(schema.accountPermissions).values({ accountId: f.manager.id, permission: "messages.read", allowed: false });
    assert.equal((await feed("company", manager)).status, 403);
    await db.delete(schema.accountPermissions).where(eq(schema.accountPermissions.accountId, f.manager.id));
  });

  await t.test("Home pins, deep links and explicit read confirmation stay inside the announcement audience", async () => {
    const prefPath = "/api/self/notification-preferences";
    const { revision, version, scheduleVersion, contextToken } = await ok(await self.handle(request(prefPath, employee)));
    await ok(await self.handle(request(prefPath, employee, { id: newToken(), revision, version, scheduleVersion, contextToken, events: { announcement: { email: true } } })));
    await db.insert(schema.accountNotificationPreferences).values([f.manager.id, f.generalManager.id, f.owner.id].map(accountId =>
      ({ accountId, choices: { events: { announcement: { email: true } } } })));
    const copy = announce("company", "Company fixture update");
    assert.equal((await disabledDelivery.handle(request("/api/messenger/channels/actions", owner, copy))).status, 409);
    companyId = (await ok(await action(owner, copy), 201)).id;
    assert.deepEqual(await ok(await action(owner, copy), 201), { id: companyId });
    assert.equal((await action(owner, { ...copy, title: "different" })).status, 409);
    managerId = (await ok(await action(owner, announce("managers", "Private fixture manager update")), 201)).id;
    assert.deepEqual((await home(employee)).posts.map(row => row.id), [companyId]);
    assert.deepEqual(new Set((await home(manager)).posts.map(row => row.id)), new Set([companyId, managerId]));
    assert.equal((await action(employee, { action: "read", postId: managerId })).status, 404);
    assert.equal((await action(employee, { action: "pin", postId: companyId, pinned: false })).status, 403);
    assert.equal((await call("channels/receipts?post=" + companyId, manager)).status, 403);
    assert.equal((await ok(await call("channels/feed?channel=company&anchor=" + companyId, employee))).posts.at(-1).title, copy.title);
    await ok(await action(employee, { action: "read", postId: companyId }));
    await ok(await action(employee, { action: "read", postId: companyId }));
    const receipts = await ok(await call("channels/receipts?post=" + companyId, owner));
    assert.equal(receipts.read, 2);
    assert.ok(receipts.people.some(row => row.accountId === f.employeeAccount.id && row.readAt));
    assert.match((await home(employee)).posts[0].readAt, /^\d{4}-/);
    await ok(await action(gm, { action: "pin", postId: companyId, pinned: false }));
    assert.deepEqual((await home(employee)).posts, []);
    await ok(await action(owner, { action: "pin", postId: companyId, pinned: true }));
    assert.equal((await home(employee)).posts[0].id, companyId);
  });

  await t.test("email copies honor saved opt-in, role changes and idempotent dispatch", async () => {
    const queued = await db.select().from(schema.channelAnnouncementRecipients);
    assert.ok(queued.some(row => row.postId === companyId && row.accountId === f.employeeAccount.id && row.state === "pending"));
    assert.ok(!queued.some(row => row.postId === managerId && row.accountId === f.employeeAccount.id));
    await db.update(schema.accountNotificationPreferences).set({ choices: { events: { announcement: { email: false } } } })
      .where(eq(schema.accountNotificationPreferences.accountId, f.manager.id));
    await db.run(sql`UPDATE accounts SET access_level='employee',session_version=session_version+1 WHERE id=${f.owner.id}`);
    const captured = [];
    const env = { STAGE6_ANNOUNCEMENT_EMAIL_ENABLED: "true", INVITATION_EMAIL_FROM: "sender@example.test",
      INVITATION_EMAIL_REPLY_TO: "reply@example.test", INVITATION_EMAIL_ORIGIN: "https://example.test",
      INVITATION_EMAIL: { send: async message => { captured.push(message); return { messageId: "accepted" }; } } };
    await dispatchAnnouncementEmails(db, { ...env, STAGE6_ANNOUNCEMENT_EMAIL_ENABLED: undefined }, now);
    assert.deepEqual(captured, []);
    await Promise.all([dispatchAnnouncementEmails(db, env, now), dispatchAnnouncementEmails(db, env, now)]);
    await dispatchAnnouncementEmails(db, env, now);
    assert.equal(captured.length, 4);
    assert.ok(captured.some(mail => mail.to === f.employeeAccount.email && mail.text.includes("channel=company&post=" + companyId)));
    assert.ok(!captured.some(mail => mail.to === f.employeeAccount.email && mail.text.includes("Private fixture manager update")));
    assert.equal(captured.filter(mail => mail.to === f.generalManager.email).length, 2);
    assert.ok(!captured.some(mail => mail.to === f.manager.email));
    assert.ok(captured.some(mail => mail.to === f.owner.email && mail.text.includes("channel=company")));
    assert.ok(!captured.some(mail => mail.to === f.owner.email && mail.text.includes("channel=managers")));
    const status = await db.select().from(schema.channelAnnouncementRecipients);
    assert.equal(status.filter(row => row.state === "accepted").length, 4);
    assert.equal(status.filter(row => row.state === "cancelled").length, 3);
  });

  await t.test("promotions and demotions affect existing channel access and the channel switch preserves private chats", async () => {
    await db.run(sql`UPDATE accounts SET access_level='manager',session_version=session_version+1 WHERE id=${f.employeeAccount.id}`);
    assert.equal((await feed("company", employee)).status, 401);
    const promoted = await login(f.employeeAccount);
    assert.ok((await ok(await feed("managers", promoted))).posts.some(row => row.id === managerId));
    await ok(await action(promoted, { action: "read", postId: managerId }));
    assert.ok((await ok(await call("channels/receipts?post=" + managerId, owner))).people.some(row => row.accountId === f.employeeAccount.id && row.readAt));
    await db.run(sql`UPDATE accounts SET access_level='employee',session_version=session_version+1 WHERE id=${f.manager.id}`);
    const demoted = await login(f.manager);
    assert.equal((await feed("managers", demoted)).status, 404);
    assert.ok(!(await home(demoted)).posts.some(row => row.id === managerId));
    await db.update(schema.locationSettings).set({ enableCompanyChannels: false });
    assert.equal((await feed("company", owner)).status, 404);
    assert.deepEqual((await home(demoted)).posts, []);
    assert.ok((await ok(await call("inbox", demoted))).threads.some(row => row.id === f.conversationA.id));
  });
});
