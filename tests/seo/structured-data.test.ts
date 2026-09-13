import assert from "node:assert/strict";
import test from "node:test";

import type { PublicProject } from "@/lib/catalog/types";
import {
  buildProductStructuredData,
  buildProjectStructuredData,
  buildSiteStructuredData,
  serializeStructuredData,
} from "@/lib/seo/structured-data";

function project(overrides: Partial<PublicProject> = {}): PublicProject {
  return {
    slug: "histoire-test",
    title: "Histoire test",
    type: "album",
    year: 2026,
    releaseDate: "2026-09-01",
    description: "Une histoire musicale.",
    shortDescription: "Une histoire musicale.",
    cover: "/media/catalog/cover-id",
    coverAlt: "Pochette de Histoire test",
    featured: true,
    status: "published",
    publicVisible: true,
    jukeboxPlacement: "published",
    jukeboxPosition: 1,
    catalogPosition: 1,
    genres: ["Récit"],
    credits: [],
    tracks: [{ number: 1, title: "Premier chapitre", status: "released" }],
    trackCount: 1,
    platforms: [
      { platform: "spotify", label: "Spotify", url: "https://open.spotify.com/album/example", scope: "release" },
      { platform: "appleMusic", label: "Apple Music", url: "https://music.apple.com/fr/artist/example", scope: "artist" },
    ],
    seo: { description: "Une histoire musicale publiée par LNX Beats." },
    artworkTone: "gold",
    dataConfidence: {
      overall: "confirmed", identity: "confirmed", editorial: "confirmed", release: "confirmed",
      artwork: "confirmed", tracklist: "confirmed", platforms: "confirmed", genres: "confirmed",
      credits: "confirmed", seo: "confirmed",
    },
    ...overrides,
  };
}

test("site identity describes the solo artist as a Person and not a MusicGroup", () => {
  const data = buildSiteStructuredData();
  const serialized = JSON.stringify(data);
  assert.match(serialized, /"@type":"WebSite"/);
  assert.match(serialized, /"@type":"Person"/);
  assert.match(serialized, /"name":"Ludovic Mathon"/);
  assert.match(serialized, /"alternateName":"LNX Beats"/);
  assert.match(serialized, /https:\/\/www\.lnxbeats\.fr\/#artist/);
  assert.doesNotMatch(serialized, /%23artist/);
  assert.doesNotMatch(serialized, /MusicGroup/);
});

test("album data is canonical, exact and limited to release-specific platform links", () => {
  const data = buildProjectStructuredData(project());
  const serialized = JSON.stringify(data);
  assert.match(serialized, /"@type":"MusicAlbum"/);
  assert.match(serialized, /https:\/\/www\.lnxbeats\.fr\/album\/histoire-test/);
  assert.match(serialized, /"datePublished":"2026-09-01"/);
  assert.match(serialized, /"name":"Premier chapitre"/);
  assert.match(serialized, /https:\/\/open\.spotify\.com\/album\/example/);
  assert.doesNotMatch(serialized, /music\.apple\.com\/fr\/artist\/example/);
});

test("in-development project data does not invent a publication date", () => {
  const data = buildProjectStructuredData(project({ type: "project", status: "in-development", releaseDate: null, year: null }));
  const serialized = JSON.stringify(data);
  assert.match(serialized, /"@type":"CreativeWork"/);
  assert.doesNotMatch(serialized, /datePublished/);
});

test("product offer derives price, currency and availability from the supplied product", () => {
  const data = buildProductStructuredData({
    slug: "cd-test",
    title: "CD test",
    description: "Un CD publié.",
    priceCents: 1234,
    currency: "EUR",
    availabilityState: "AVAILABLE",
    image: { id: "image-id", alt: "Pochette du CD", width: 1200, height: 1200 },
  });
  const serialized = JSON.stringify(data);
  assert.match(serialized, /"@type":"Product"/);
  assert.match(serialized, /"price":"12\.34"/);
  assert.match(serialized, /"priceCurrency":"EUR"/);
  assert.match(serialized, /https:\/\/schema\.org\/InStock/);
  assert.match(serialized, /https:\/\/www\.lnxbeats\.fr\/media\/boutique\/image-id/);
});

test("a temporarily unavailable published product stays representable without exposing stock", () => {
  const data = buildProductStructuredData({
    slug: "cd-temporairement-indisponible",
    title: "CD temporairement indisponible",
    description: "Un CD publié dont les exemplaires sont réservés.",
    priceCents: 700,
    currency: "EUR",
    availabilityState: "TEMPORARILY_UNAVAILABLE",
    image: null,
  });
  const serialized = JSON.stringify(data);
  assert.match(serialized, /https:\/\/schema\.org\/OutOfStock/);
  assert.doesNotMatch(serialized, /"(?:inventoryLevel|quantity|availableQuantity|stock)"/);
});

test("a sold-out published product remains an OutOfStock product page", () => {
  const data = buildProductStructuredData({
    slug: "badge-epuise",
    title: "Badge épuisé",
    description: "Un badge publié et épuisé.",
    priceCents: 300,
    currency: "EUR",
    availabilityState: "SOLD_OUT",
    image: null,
  });
  const serialized = JSON.stringify(data);
  assert.match(serialized, /https:\/\/schema\.org\/OutOfStock/);
  assert.doesNotMatch(serialized, /"(?:inventoryLevel|quantity|availableQuantity|stock)"/);
});

test("structured data serialization cannot terminate its script element", () => {
  assert.equal(serializeStructuredData({ value: "</script>" }), "{\"value\":\"\\u003c/script>\"}");
});
