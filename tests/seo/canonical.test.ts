import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import robots from "@/app/robots";
import { CANONICAL_SITE_ORIGIN, PRODUCTION_RAILWAY_PUBLIC_HOST, canonicalPublicUrl, resolvePublicOriginPolicy } from "@/lib/seo/canonical";
import { createPublicPageMetadata } from "@/lib/seo/metadata";
import { buildPublicSitemap } from "@/lib/seo/sitemap";
import { proxy } from "@/proxy";

test("public SEO identity is fixed to the canonical www HTTPS origin", () => {
  assert.equal(CANONICAL_SITE_ORIGIN, "https://www.lnxbeats.fr");
  assert.equal(canonicalPublicUrl(), "https://www.lnxbeats.fr/");
  assert.equal(canonicalPublicUrl("/album/test", "?x=1"), "https://www.lnxbeats.fr/album/test?x=1");
  assert.equal(canonicalPublicUrl("//evil.example/escape"), "https://www.lnxbeats.fr//evil.example/escape");
});

test("public metadata aligns canonical, Open Graph and Twitter identities", () => {
  const metadata = createPublicPageMetadata({ title: "Discographie", description: "Les projets LNX Beats.", pathname: "/discographie" });
  assert.equal(metadata.alternates?.canonical, "/discographie");
  assert.equal(metadata.openGraph?.url, "/discographie");
  assert.equal(metadata.openGraph?.title, "Discographie — LNX Beats");
  assert.equal(metadata.twitter?.title, "Discographie — LNX Beats");
});

test("robots allows public routes and points only to the official sitemap", () => {
  const result = robots();
  assert.equal(result.host, CANONICAL_SITE_ORIGIN);
  assert.equal(result.sitemap, "https://www.lnxbeats.fr/sitemap.xml");
  assert.ok(JSON.stringify(result.rules).includes("/api/"));
  assert.ok(!JSON.stringify(result.rules).includes('"disallow":"/"'));
});

test("sitemap contains only canonical public project and product URLs", () => {
  const entries = buildPublicSitemap(
    [{ slug: "projet-publie", status: "PUBLISHED", featured: true }],
    [{ slug: "cd-test" }],
  );
  assert.ok(entries.some((entry) => entry.url === "https://www.lnxbeats.fr/album/projet-publie"));
  assert.ok(entries.some((entry) => entry.url === "https://www.lnxbeats.fr/boutique/cd-test"));
  assert.ok(entries.every((entry) => entry.url.startsWith(`${CANONICAL_SITE_ORIGIN}/`)));
  assert.ok(entries.every((entry) => !/(railway|localhost|\/admin|\/api)/i.test(entry.url)));
});

test("apex and exact public Railway host redirect while preserving path and query", () => {
  for (const host of ["lnxbeats.fr", PRODUCTION_RAILWAY_PUBLIC_HOST]) {
    assert.deepEqual(resolvePublicOriginPolicy({ method: "GET", host, pathname: "/album/test", search: "?x=1" }), {
      action: "redirect", location: "https://www.lnxbeats.fr/album/test?x=1", status: 308,
    });
  }
});

test("canonical and local hosts never redirect; unknown Railway page hosts are noindex", () => {
  for (const host of ["www.lnxbeats.fr", "localhost:31780", "127.0.0.1:31780", "example.com", `${PRODUCTION_RAILWAY_PUBLIC_HOST}.evil.example`]) {
    assert.deepEqual(resolvePublicOriginPolicy({ method: "GET", host, pathname: "/discographie" }), { action: "none" });
  }
  assert.deepEqual(resolvePublicOriginPolicy({ method: "GET", host: "preview.up.railway.app", pathname: "/discographie" }), { action: "noindex" });
});

test("technical routes and mutations bypass canonical host routing", () => {
  for (const pathname of ["/api/health", "/api/payments/stripe/webhook", "/api/payments/paypal/webhook", "/_next/static/a.js", "/media/catalog/id"]) {
    assert.deepEqual(resolvePublicOriginPolicy({ method: "GET", host: PRODUCTION_RAILWAY_PUBLIC_HOST, pathname }), { action: "none" });
  }
  assert.deepEqual(resolvePublicOriginPolicy({ method: "POST", host: "lnxbeats.fr", pathname: "/discographie" }), { action: "none" });
});

test("Next proxy applies redirects and noindex without a canonical loop", () => {
  const redirect = proxy(new NextRequest("https://lnxbeats.fr/album/test?x=1", { headers: { host: "lnxbeats.fr" } }));
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("location"), "https://www.lnxbeats.fr/album/test?x=1");
  const canonical = proxy(new NextRequest("https://www.lnxbeats.fr/album/test", { headers: { host: "www.lnxbeats.fr" } }));
  assert.equal(canonical.headers.get("location"), null);
  const unknown = proxy(new NextRequest("https://preview.up.railway.app/discographie", { headers: { host: "preview.up.railway.app" } }));
  assert.equal(unknown.headers.get("x-robots-tag"), "noindex, nofollow");
});
