import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("public creation queries are lifecycle and media fail-closed", async () => {
  const source = await read("lib/creations/queries.ts");

  assert.match(source, /status: "PUBLISHED"/);
  assert.match(source, /publishedAt: \{ not: null \}/);
  assert.match(source, /visibility: "PUBLIC"/);
  assert.match(source, /rightsStatus: "CLEARED"/);
  assert.match(source, /role: "AUDIO"[\s\S]*?mimeType: "audio\/mpeg"/);
  assert.match(source, /role: "VIDEO"[\s\S]*?mimeType: "video\/mp4"/);
  assert.match(source, /\(!audio && !video\) \|\| !summary \|\| !creation\.publishedAt/);
  assert.match(source, /requestedPrimary === "cover" && !cover/);
  assert.match(source, /requestedPrimary === "audio" && !audio/);
  assert.match(source, /requestedPrimary === "video" && !video/);
});

test("sitemap eligibility is derived from the same public mapper as pages", async () => {
  const source = await read("lib/creations/queries.ts");
  const sitemapFunction = source.slice(source.indexOf("export async function listSitemapCreations"));

  assert.match(sitemapFunction, /loadPublicCreations\(\)/);
  assert.match(sitemapFunction, /mapPublicCreation\(creation\)/);
  assert.doesNotMatch(sitemapFunction, /prisma\.creation\.findMany/);
});

test("public external links are normalized HTTPS links without credentials", async () => {
  const source = await read("lib/creations/queries.ts");

  assert.match(source, /url\.protocol !== "https:" \|\| url\.username \|\| url\.password/);
  assert.match(source, /\.map\(publicExternalLink\)/);
});
