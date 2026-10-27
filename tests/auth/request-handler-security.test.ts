import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { NextRequest } from "next/server";

import { handleBoundedAuthRequest } from "@/lib/auth/request-handler";

const baseURL = "http://127.0.0.1:3199";
const email = "bounded-auth-fixture@example.test";
const password = "synthetic-correct-password";

// Each test has its own in-memory adapter. No Prisma, real account, database,
// provider, network request or email delivery is used by this regression suite.
function authFixture() {
  const now = new Date();
  const userId = "f8475882-4610-4a3b-a00a-f847030c2135";
  const user = { id: userId, name: "Synthetic security fixture", email, emailVerified: true, createdAt: now, updatedAt: now };
  const memory = {
    user: [user],
    account: [{ id: "ff875dc7-d0bc-4945-92fa-cfddf210c39c", userId, accountId: userId, providerId: "credential", password: "synthetic-digest-only", createdAt: now, updatedAt: now }],
    session: [],
    verification: [],
  };
  const capturedEmails: string[] = [];
  const instance = betterAuth({
    baseURL,
    secret: randomBytes(32).toString("base64url"),
    database: memoryAdapter(memory),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: true,
      // Deliberately synthetic credential implementation, not production crypto.
      password: {
        hash: async () => "synthetic-digest-only",
        verify: async ({ hash, password: candidate }) => hash === "synthetic-digest-only" && candidate === password,
      },
      async sendResetPassword({ url }) { capturedEmails.push(url); },
    },
    emailVerification: {
      sendOnSignIn: false,
      async sendVerificationEmail({ url }) { capturedEmails.push(url); },
    },
    session: { expiresIn: 3600, updateAge: 0, cookieCache: { enabled: false } },
    rateLimit: { enabled: false },
    logger: { level: "error" },
  });
  let handlerCalls = 0;
  return {
    userId,
    capturedEmails,
    get handlerCalls() { return handlerCalls; },
    handle(request: Request) {
      return handleBoundedAuthRequest(request, async (forwarded) => {
        handlerCalls++;
        return instance.handler(forwarded);
      }, baseURL);
    },
  };
}

function post(path: string, body: string, contentType = "application/json", origin = baseURL, extraHeaders: Record<string, string> = {}) {
  return new Request(`${baseURL}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": contentType, origin, ...extraHeaders },
    body,
  });
}

// Next App Router exposes public getters/methods on the real request through a
// Proxy. Its identity is still unsuitable for native Request private slots.
function appRouterRequest(request: NextRequest) {
  return new Proxy(request, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

for (const encoding of ["json", "form"] as const) {
  test(`App Router proxied ${encoding} sign-in and SDK-shaped JSON logout preserve the real session lifecycle`, async () => {
    const fixture = authFixture();
    const body = encoding === "json" ? JSON.stringify({ email, password }) : new URLSearchParams({ email, password }).toString();
    const response = await fixture.handle(appRouterRequest(new NextRequest(`${baseURL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { origin: baseURL, "content-type": encoding === "json" ? "application/json" : "application/x-www-form-urlencoded" },
      body,
    })));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.id, fixture.userId);
    const cookie = response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
    assert.ok(cookie);
    const session = await fixture.handle(new Request(`${baseURL}/api/auth/get-session`, { headers: { cookie } }));
    assert.equal((await session.json()).user.id, fixture.userId);
    const logout = await fixture.handle(appRouterRequest(new NextRequest(`${baseURL}/api/auth/sign-out`, {
      method: "POST", headers: { origin: baseURL, cookie, "content-type": "application/json" }, body: "{}",
    })));
    assert.equal(logout.status, 200);
    assert.equal((await logout.json()).success, true);
    assert.ok(logout.headers.getSetCookie().some(value => /max-age=0/i.test(value)));
    const afterLogout = await fixture.handle(new Request(`${baseURL}/api/auth/get-session`, { headers: { cookie } }));
    assert.equal(await afterLogout.json(), null);
    assert.deepEqual(fixture.capturedEmails, []);
  });
}

test("App Router forwarding keeps bounded octets, request metadata and in-flight cancellation", async () => {
  const controller = new AbortController();
  const raw = "email=proxy-fixture%40example.test&password=synthetic%2Bvalue+with%20spaces%26equals%3D";
  const url = `${baseURL}/api/auth/sign-in/email?retour=%2Fadmin`;
  const incoming = new NextRequest(url, {
    method: "POST", body: raw, signal: controller.signal,
    headers: { origin: baseURL, "content-type": "application/x-www-form-urlencoded; charset=UTF-8", cookie: "synthetic-session=fixture-only", "x-synthetic-marker": "preserved" },
    cache: "no-store", credentials: "include", mode: "same-origin", redirect: "manual",
    referrer: `${baseURL}/connexion`, referrerPolicy: "same-origin", integrity: "", keepalive: true,
  });
  const expectedHeaders = [...incoming.headers.entries()];
  let calls = 0;
  const response = await handleBoundedAuthRequest(appRouterRequest(incoming), async (forwarded) => {
    calls++;
    assert.equal(forwarded.url, incoming.url);
    assert.equal(forwarded.method, incoming.method);
    assert.deepEqual([...forwarded.headers.entries()], expectedHeaders);
    for (const key of ["cache", "credentials", "integrity", "keepalive", "mode", "redirect", "referrer", "referrerPolicy"] as const) {
      assert.equal(forwarded[key], incoming[key], key);
    }
    assert.deepEqual(new Uint8Array(await forwarded.arrayBuffer()), new TextEncoder().encode(raw));
    assert.equal(forwarded.signal.aborted, false);
    controller.abort();
    assert.equal(forwarded.signal.aborted, true);
    return Response.json({ status: true });
  }, baseURL);
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});

for (const encoding of ["json", "form"] as const) {
  test(`bounded auth preserves a real ${encoding} credential sign-in, session cookie and logout`, async () => {
    const fixture = authFixture();
    const body = encoding === "json" ? JSON.stringify({ email, password }) : new URLSearchParams({ email, password }).toString();
    const response = await fixture.handle(post("/sign-in/email", body, encoding === "json" ? "application/json" : "application/x-www-form-urlencoded"));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.id, fixture.userId);
    const cookieHeaders = response.headers.getSetCookie();
    assert.ok(cookieHeaders.length > 0);
    assert.ok(cookieHeaders.some((value) => /httponly/i.test(value)));
    const cookie = cookieHeaders.map((value) => value.split(";", 1)[0]).join("; ");
    const current = await fixture.handle(new Request(`${baseURL}/api/auth/get-session`, { headers: { cookie } }));
    assert.equal(current.status, 200);
    assert.equal((await current.json()).user.id, fixture.userId);
    const logout = await fixture.handle(new Request(`${baseURL}/api/auth/sign-out`, { method: "POST", headers: { origin: baseURL, cookie } }));
    assert.equal(logout.status, 200);
    const afterLogout = await fixture.handle(new Request(`${baseURL}/api/auth/get-session`, { headers: { cookie } }));
    assert.equal(await afterLogout.json(), null);
    assert.equal(fixture.handlerCalls, 4);
    assert.deepEqual(fixture.capturedEmails, []);
  });
}

test("bounded auth preserves generic credential failures without issuing a session", async () => {
  const fixture = authFixture();
  const response = await fixture.handle(post("/sign-in/email", JSON.stringify({ email, password: "synthetic-wrong-password" })));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { code: "INVALID_CREDENTIALS", message: "Identifiants invalides" });
  assert.equal(response.headers.getSetCookie().length, 0);
  assert.equal(fixture.handlerCalls, 1);
  assert.deepEqual(fixture.capturedEmails, []);
});

test("rate-limited sign-in retains Retry-After while replacing provider error details", async () => {
  for (const sourceHeader of ["x-retry-after", "retry-after"]) {
    const response = await handleBoundedAuthRequest(post("/sign-in/email", JSON.stringify({ email, password })), async () => {
      return Response.json({ error: "synthetic internal account detail" }, { status: 429, headers: { [sourceHeader]: "61" } });
    }, baseURL);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "61");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { code: "INVALID_CREDENTIALS", message: "Identifiants invalides" });
  }
});

test("password-reset requests preserve generic success/failure responses and rate-limit Retry-After", async () => {
  for (const sourceStatus of [200, 400, 500, 429]) {
    const response = await handleBoundedAuthRequest(post("/request-password-reset", JSON.stringify({ email, redirectTo: "/reinitialiser-mot-de-passe" })), async () => {
      return Response.json({ detail: "synthetic internal account detail" }, { status: sourceStatus, headers: { "retry-after": "120" } });
    }, baseURL);
    assert.equal(response.status, sourceStatus === 429 ? 429 : 200);
    assert.equal(response.headers.get("retry-after"), "120");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { status: true, message: "Si un compte correspond à cette adresse, un message a été préparé." });
  }
});

test("foreign-origin credential requests stop before body parsing and Better Auth", async () => {
  let bodyReads = 0;
  let handlerCalls = 0;
  const request = post("/sign-in/email", "{}", "application/json", "https://foreign-origin.example.test");
  Object.defineProperty(request, "body", { get() { bodyReads++; throw new Error("body must not be read"); } });
  const response = await handleBoundedAuthRequest(request, async () => { handlerCalls++; return new Response(); }, baseURL);
  assert.equal(response.status, 403);
  assert.equal(bodyReads, 0);
  assert.equal(handlerCalls, 0);
});

test("native sign-up, verification and unused social routes are unreachable before body parsing", async () => {
  for (const path of ["/sign-up/email", "/sign-up/email/", "/verify-email", "/verify-email/", "/sign-in/social", "/sign-in/social/", "/link-social", "/link-social/"]) {
    for (const method of ["GET", "POST"]) {
      let bodyReads = 0;
      let handlerCalls = 0;
      const request = new Request(`${baseURL}/api/auth${path}?provider=synthetic`, {
        method,
        headers: { origin: baseURL, "content-type": "application/json" },
        ...(method === "POST" ? { body: "{}" } : {}),
      });
      Object.defineProperty(request, "body", { get() { bodyReads++; throw new Error("disabled route must not read a body"); } });
      const response = await handleBoundedAuthRequest(request, async () => { handlerCalls++; return new Response(); }, baseURL);
      assert.equal(response.status, 404, `${method} ${path}`);
      assert.equal(bodyReads, 0, `${method} ${path}`);
      assert.equal(handlerCalls, 0, `${method} ${path}`);
    }
  }
});

test("over-limit JSON and form bodies stop before the Better Auth handler", async () => {
  for (const contentType of ["application/json", "application/x-www-form-urlencoded"]) {
    let handlerCalls = 0;
    const response = await handleBoundedAuthRequest(post("/sign-in/email", "x".repeat(16 * 1024 + 1), contentType), async () => {
      handlerCalls++;
      return new Response();
    }, baseURL);
    assert.equal(response.status, 413, contentType);
    assert.equal(handlerCalls, 0, contentType);
  }
});

test("malformed and excessively deep JSON stop before the Better Auth handler", async () => {
  const deeplyNested = `${'{"nested":'.repeat(128)}0${"}".repeat(128)}`;
  for (const body of ['{"email":', deeplyNested]) {
    let handlerCalls = 0;
    const response = await handleBoundedAuthRequest(post("/sign-in/email", body), async () => {
      handlerCalls++;
      return new Response();
    }, baseURL);
    assert.equal(response.status, 400);
    assert.equal(handlerCalls, 0);
  }
});

test("bounded forwarding preserves the original URL, query, method, headers and encoded form octets", async () => {
  const raw = "email=bounded-auth-fixture%40example.test&password=synthetic%2Bvalue+with%20spaces%26equals%3D&rememberMe=true";
  const url = `${baseURL}/api/auth/sign-in/email?redirectTo=%2Fcompte%2Fmusique&source=synthetic`;
  const request = new Request(url, {
    method: "POST",
    headers: { origin: baseURL, "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-synthetic-request": "preserve-me", cookie: "synthetic_cookie=fixture-only" },
    body: raw,
  });
  let handlerCalls = 0;
  const response = await handleBoundedAuthRequest(request, async (forwarded) => {
    handlerCalls++;
    assert.equal(forwarded.url, url);
    assert.equal(forwarded.method, "POST");
    assert.equal(forwarded.headers.get("origin"), baseURL);
    assert.equal(forwarded.headers.get("content-type"), "application/x-www-form-urlencoded; charset=UTF-8");
    assert.equal(forwarded.headers.get("x-synthetic-request"), "preserve-me");
    assert.equal(forwarded.headers.get("cookie"), "synthetic_cookie=fixture-only");
    assert.deepEqual(new Uint8Array(await forwarded.arrayBuffer()), new TextEncoder().encode(raw));
    return new Response("synthetic forwarded response", { headers: { "x-synthetic-response": "preserved" } });
  }, baseURL);
  assert.equal(handlerCalls, 1);
  assert.equal(await response.text(), "synthetic forwarded response");
  assert.equal(response.headers.get("x-synthetic-response"), "preserved");
});

test("existing strict profile, email and reset payload guards are not relaxed for forms", async () => {
  const cases = [
    ["/update-user", "name=Synthetic"],
    ["/send-verification-email", `email=${encodeURIComponent(email)}&callbackURL=%2Fverifier-email`],
    ["/request-password-reset", `email=${encodeURIComponent(email)}&redirectTo=%2Freinitialiser-mot-de-passe`],
    ["/reset-password", `newPassword=${password}&token=synthetic-token-long-enough-for-policy`],
  ];
  for (const [path, body] of cases) {
    let handlerCalls = 0;
    const response = await handleBoundedAuthRequest(post(path, body, "application/x-www-form-urlencoded"), async () => {
      handlerCalls++;
      return new Response();
    }, baseURL);
    assert.equal(response.status, 400, path);
    assert.equal(handlerCalls, 0, path);
  }
});

test("the password-reset GET callback remains delegated intact instead of being treated as a reset mutation", async () => {
  const url = `${baseURL}/api/auth/reset-password/synthetic-token?callbackURL=%2Freinitialiser-mot-de-passe`;
  let handlerCalls = 0;
  const response = await handleBoundedAuthRequest(new Request(url), async (forwarded) => {
    handlerCalls++;
    assert.equal(forwarded.url, url);
    assert.equal(forwarded.method, "GET");
    assert.equal(forwarded.body, null);
    return new Response(null, { status: 302, headers: { location: `${baseURL}/reinitialiser-mot-de-passe?token=synthetic-token` } });
  }, baseURL);
  assert.equal(handlerCalls, 1);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), `${baseURL}/reinitialiser-mot-de-passe?token=synthetic-token`);
});

test("genuine password-reset handling captures its email in memory and keeps the generic response", async () => {
  const fixture = authFixture();
  const response = await fixture.handle(post("/request-password-reset", JSON.stringify({ email, redirectTo: "/reinitialiser-mot-de-passe" })));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: true, message: "Si un compte correspond à cette adresse, un message a été préparé." });
  assert.equal(fixture.handlerCalls, 1);
  assert.equal(fixture.capturedEmails.length, 1);
  const captured = new URL(fixture.capturedEmails[0]);
  assert.equal(captured.origin, baseURL);
  assert.match(captured.pathname, /^\/api\/auth\/reset-password\//);
});
