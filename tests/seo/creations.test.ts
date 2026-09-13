import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { navigation } from "@/data/site";
import { CANONICAL_SITE_ORIGIN } from "@/lib/seo/canonical";
import { buildPublicSitemap, PUBLIC_SITEMAP_PATHS } from "@/lib/seo/sitemap";
import { buildCreationStructuredData, serializeStructuredData } from "@/lib/seo/structured-data";

test("public navigation adds Créations without removing an existing destination", () => {
  assert.deepEqual(navigation.map(({ label, href }) => [label, href]), [
    ["Accueil", "/"],
    ["Discographie", "/discographie"],
    ["Créations", "/creations"],
    ["Commander", "/commander"],
    ["Boutique", "/boutique"],
    ["À propos", "/a-propos"],
    ["Contact", "/contact"],
  ]);
});

test("all links remain available in the intermediate desktop header and route matching is segment-safe", async () => {
  const [header, styles] = await Promise.all([
    readFile(new URL("../../components/site-header.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(header, /pathname === href \|\| pathname\.startsWith\(`\$\{href\}\/`\)/);
  assert.doesNotMatch(header, /pathname\.startsWith\(href\)/);
  const intermediateHeader = styles.match(/@media \(max-width: 1100px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(intermediateHeader, /\.desktop-navigation__link \{ display: inline-flex; \}/);
  assert.doesNotMatch(intermediateHeader, /\.desktop-navigation__link \{ display: none; \}/);
});

test("an audio-only creation exposes BreadcrumbList and CreativeWork without VideoObject", () => {
  const data = buildCreationStructuredData({
    slug: "creation-audio",
    title: "Création audio",
    description: "Une collaboration musicale originale.",
    image: "/media/creations/cover-id",
    publishedAt: "2026-09-13T10:30:00.000Z",
    collaborator: "Artiste invité",
    category: "Collaboration",
    links: [
      "https://example.com/creation",
      "http://example.com/non-securise",
      "https://user:secret@example.com/prive",
      "javascript:alert(1)",
    ],
  });
  const serialized = JSON.stringify(data);

  assert.match(serialized, /"@type":"BreadcrumbList"/);
  assert.match(serialized, /"@type":"CreativeWork"/);
  assert.match(serialized, /https:\/\/www\.lnxbeats\.fr\/creations\/creation-audio/);
  assert.match(serialized, /https:\/\/www\.lnxbeats\.fr\/media\/creations\/cover-id/);
  assert.match(serialized, /https:\/\/example\.com\/creation/);
  assert.doesNotMatch(serialized, /VideoObject/);
  assert.doesNotMatch(serialized, /javascript:/);
  assert.doesNotMatch(serialized, /non-securise|user:secret|prive/);
});

test("creation structured data rejects non-canonical slugs and neutralizes script injection", () => {
  assert.throws(() => buildCreationStructuredData({
    slug: "../brouillon",
    title: "Brouillon",
    description: "Ne doit jamais produire une URL publique.",
  }), /Invalid public creation slug/);

  const serialized = serializeStructuredData(buildCreationStructuredData({
    slug: "creation-sure",
    title: "</script><script>alert('x')</script>",
    description: "Une description sûre.",
  }));
  assert.doesNotMatch(serialized, /<\/script>|<script>/i);
  assert.doesNotThrow(() => JSON.parse(serialized));
});

test("VideoObject is fail-closed unless the supplied video is explicitly published and public", () => {
  for (const video of [
    { published: false, contentUrl: "/media/creations/video-id" },
    { published: true, contentUrl: "javascript:alert(1)" },
    { published: true, contentUrl: null },
    { published: true, contentUrl: "/media/creations/video-id", uploadDate: "2026-09-13T10:30:00.000Z" },
    { published: true, contentUrl: "/media/creations/video-id", thumbnailUrl: "/media/creations/poster-id" },
  ]) {
    const serialized = JSON.stringify(buildCreationStructuredData({
      slug: "creation-sans-video-publique",
      title: "Création sans vidéo publique",
      description: "La vidéo ne doit pas être annoncée.",
      video,
    }));
    assert.doesNotMatch(serialized, /VideoObject/);
    assert.doesNotMatch(serialized, /associatedMedia/);
  }
});

test("a real published video adds one coherent VideoObject linked to its CreativeWork", () => {
  const data = buildCreationStructuredData({
    slug: "clip-publie",
    title: "Clip publié",
    description: "Une création audiovisuelle publiée.",
    image: "/media/creations/cover-id",
    publishedAt: "2026-09-13T10:30:00.000Z",
    video: {
      published: true,
      contentUrl: "/media/creations/video-id",
      thumbnailUrl: "/media/creations/poster-id",
      name: "Clip publié — vidéo",
      duration: "PT2M15S",
    },
  });
  const graph = data["@graph"];
  const serialized = JSON.stringify(data);

  assert.equal(graph.filter((entry) => entry["@type"] === "VideoObject").length, 1);
  assert.match(serialized, /"associatedMedia":\{"@id":"https:\/\/www\.lnxbeats\.fr\/creations\/clip-publie#video"\}/);
  assert.match(serialized, /"contentUrl":"https:\/\/www\.lnxbeats\.fr\/media\/creations\/video-id"/);
  assert.match(serialized, /"thumbnailUrl":"https:\/\/www\.lnxbeats\.fr\/media\/creations\/poster-id"/);
  assert.match(serialized, /"duration":"PT2M15S"/);
  assert.doesNotThrow(() => JSON.parse(serializeStructuredData(data)));
});

test("the public sitemap includes the creation index and supplied published creation URLs", () => {
  const updatedAt = new Date("2026-09-13T11:00:00.000Z");
  const sitemap = buildPublicSitemap([], [], [{ slug: "clip-publie", updatedAt }]);
  const index = sitemap.find(({ url }) => url === `${CANONICAL_SITE_ORIGIN}/creations`);
  const detail = sitemap.find(({ url }) => url === `${CANONICAL_SITE_ORIGIN}/creations/clip-publie`);

  assert.ok(PUBLIC_SITEMAP_PATHS.includes("/creations"));
  assert.ok(index);
  assert.deepEqual(detail?.lastModified, updatedAt);
  assert.equal(detail?.changeFrequency, "monthly");
  assert.equal(detail?.priority, 0.65);
});
