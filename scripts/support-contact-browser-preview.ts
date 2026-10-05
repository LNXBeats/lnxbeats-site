import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Client } from "pg";

// Disposable localhost-only screenshot harness. No Production route/auth bypass,
// no browser credential output, no POST forwarding and no real provider keys.
const dbUrl = new URL(process.env.DATABASE_URL ?? "");
assert.equal(dbUrl.hostname, "127.0.0.1"); assert.equal(dbUrl.pathname, "/lnx_financial_review_qa");
assert.equal(dbUrl.username, "qa_owner"); assert.equal(process.env.NODE_ENV, "test");
const db = new Client({ connectionString: dbUrl.toString() }); await db.connect();
const ownerToken = randomBytes(32).toString("hex");
const hash = createHash("sha256").update(ownerToken).digest("hex");
const confirmed = randomUUID(), pending = randomUUID(), admin = randomUUID();
const session = randomBytes(32).toString("hex");
const authSecret = randomBytes(48).toString("base64url");
await db.query(`INSERT INTO users (id,email,"displayName",role,status,"emailVerified","updatedAt")
  VALUES ($1,$2,'Admin QA local','ADMIN','ACTIVE',true,now())`, [admin,`visual-${admin}@example.invalid`]);
await db.query(`INSERT INTO auth_sessions (id,"userId",token,"expiresAt","updatedAt") VALUES ($1,$2,$3,now()+interval '2 hours',now())`, [randomUUID(), admin, session]);
for (const [id,status] of [[confirmed,"SUCCEEDED"],[pending,"PENDING"]]) {
  await db.query(`INSERT INTO support_contributions (id,"ownerHash","amountCents",currency,provider,mode,status,"idempotencyKey","providerReference","paymentReference","supporterEmail","supporterMessage","updatedAt")
    VALUES ($1,$2,300,'EUR','STRIPE','TEST',$3,$4,$5,$6,'supporter@example.invalid','Merci pour vos histoires !\nMessage synthétique réservé à la revue visuelle.',now())`,
    [id,hash,status,createHash("sha256").update(id).digest("hex"),`cs_test_visual_${id.replaceAll("-","")}`,status==="SUCCEEDED"?`pi_test_visual_${id}`:null]);
}
for (const audience of ["SUPPORTER","ADMIN"]) await db.query(`INSERT INTO support_notifications (id,"contributionId",audience,mode,status,"idempotencyKey","sentAt")
  VALUES ($1,$2,$3,'TEST','SENT',$4,now())`, [randomUUID(),confirmed,audience,`visual:${confirmed}:${audience}`]);
await db.end();
const signed = encodeURIComponent(`${session}.${createHmac("sha256",authSecret).update(session).digest("base64")}`);
const cookies = `lnx_support_access=${ownerToken}; __Secure-lnx-studio.session_token=${signed}; lnx-studio.session_token=${signed}`;
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p","4183"], {
  env: { ...process.env, NODE_ENV: "production", AUTH_SECRET: authSecret, AUTH_URL: "http://127.0.0.1:4183", SITE_URL: "http://127.0.0.1:4183",
    SUPPORT_TEST_MODE: "true", SUPPORT_ENABLED: "true", PAYMENT_DEPLOYMENT_ENV: "development", STRIPE_MODE: "test",
    STRIPE_SECRET_KEY: "rk_test_synthetic_not_a_provider_credential", SUPPORT_STRIPE_WEBHOOK_SECRET: "synthetic_only_not_external",
    NOTIFICATION_DEPLOYMENT_ENV: "development", NOTIFICATION_EMAIL_TRANSPORT: "capture", NOTIFICATION_WORKER_ENABLED: "false",
    ADS_ENABLED: "false", SUPPORT_PAYPAL_LIVE_APPROVED: "false" }, stdio: ["ignore","pipe","pipe"] });
const server = createServer((req,res) => {
  if (!['GET','HEAD'].includes(req.method ?? "")) { res.writeHead(405); res.end("Read-only QA preview"); return; }
  const target = new URL(req.url ?? "/", "http://127.0.0.1:4184");
  const path = target.pathname === "/qa-confirmed" ? `/soutenir/confirmation/${confirmed}`
    : target.pathname === "/qa-pending" ? `/soutenir/confirmation/${pending}`
      : target.pathname === "/qa-admin-support" ? `/admin/soutiens/${confirmed}` : `${target.pathname}${target.search}`;
  const upstream = httpRequest({ hostname: "127.0.0.1", port: 4183, path, method: req.method,
    headers: { ...req.headers, host: "127.0.0.1:4183", cookie: cookies } }, response => {
      res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res);
    });
  upstream.on("error", () => { res.writeHead(503); res.end("QA preview starting"); }); upstream.end();
});
server.listen(4184,"127.0.0.1", () => console.log("Read-only QA preview: http://127.0.0.1:4184/soutenir /qa-confirmed /qa-pending /qa-admin-support"));
function stop() { server.close(); child.kill("SIGTERM"); }
process.on("SIGINT",stop); process.on("SIGTERM",stop); child.on("exit", () => server.close());
