import assert from "node:assert/strict";
import test from "node:test";

import {
  discographyFilterCounts,
  filterDiscographyProjects,
  sortDiscographyProjects,
  visibleDiscographyProjects,
} from "@/lib/catalog/jukebox";

type FixtureProject = {
  slug: string;
  type: "album" | "single" | "project";
  status: "published" | "in-development" | "draft" | "archive";
  releaseDate: string | null;
  catalogPosition: number;
  jukeboxPosition?: number | null;
};

const projects: readonly FixtureProject[] = [
  { slug: "single-recent", type: "single", status: "published", releaseDate: "2026-05-05", catalogPosition: 1 },
  { slug: "album-old", type: "album", status: "published", releaseDate: "2025-04-10", catalogPosition: 2 },
  { slug: "album-undated", type: "album", status: "published", releaseDate: null, catalogPosition: 3 },
  { slug: "project-development", type: "project", status: "in-development", releaseDate: null, catalogPosition: 4 },
  { slug: "single-development", type: "single", status: "in-development", releaseDate: null, catalogPosition: 5 },
];

test("discography filters derive their counts from the same project collection", () => {
  assert.deepEqual(discographyFilterCounts(projects), {
    all: 5,
    albums: 2,
    singles: 2,
    development: 2,
  });
  assert.deepEqual(filterDiscographyProjects(projects, "albums").map(({ slug }) => slug), ["album-old", "album-undated"]);
  assert.deepEqual(filterDiscographyProjects(projects, "singles").map(({ slug }) => slug), ["single-recent", "single-development"]);
  assert.deepEqual(filterDiscographyProjects(projects, "development").map(({ slug }) => slug), ["project-development", "single-development"]);
});

test("editorial sorting follows catalogPosition and remains deterministic", () => {
  const shuffled = [projects[4], projects[1], projects[3], projects[0], projects[2]];
  assert.deepEqual(sortDiscographyProjects(shuffled, "editorial").map(({ slug }) => slug), projects.map(({ slug }) => slug));
});

test("Vie de chien uses jukebox position 1 rather than catalogue position 26", () => {
  const input: FixtureProject[] = [
    { ...projects[1], slug: "legacy-first", catalogPosition: 1, jukeboxPosition: null },
    { ...projects[1], slug: "explicit-second", catalogPosition: 2, jukeboxPosition: 2 },
    { ...projects[1], slug: "vie-de-chien", catalogPosition: 26, jukeboxPosition: 1 },
  ];
  assert.deepEqual(visibleDiscographyProjects(input, "albums", "editorial").map(p => p.slug), ["vie-de-chien", "explicit-second", "legacy-first"]);
  assert.equal(input[2].catalogPosition, 26);
});

test("jukebox null, zero and collisions have deterministic explicit precedence", () => {
  const input: FixtureProject[] = [
    { ...projects[1], slug: "legacy", catalogPosition: 1, jukeboxPosition: null },
    { ...projects[1], slug: "b", catalogPosition: 3, jukeboxPosition: 2 },
    { ...projects[1], slug: "a", catalogPosition: 3, jukeboxPosition: 2 },
    { ...projects[1], slug: "earlier-catalogue", catalogPosition: 2, jukeboxPosition: 2 },
    { ...projects[1], slug: "zero", catalogPosition: 30, jukeboxPosition: 0 },
  ];
  assert.deepEqual(sortDiscographyProjects(input, "editorial").map(p => p.slug), ["zero", "earlier-catalogue", "a", "b", "legacy"]);
});

test("drafts and archives remain excluded while public projects without audio remain discoverable", () => {
  const input = [
    { ...projects[1], slug: "draft", status: "draft" as const, jukeboxPosition: 0 },
    { ...projects[1], slug: "archive", status: "archive" as const, jukeboxPosition: 0 },
    { ...projects[1], slug: "published-without-audio", audioPreview: null, jukeboxPosition: 1 },
    { ...projects[3], audioPreview: null },
  ];
  assert.deepEqual(visibleDiscographyProjects(input, "all", "editorial").map(p => p.slug), ["published-without-audio", "project-development"]);
  assert.equal(discographyFilterCounts(input).all, 2);
});

test("date sorting keeps undated projects last and uses editorial order as its stable fallback", () => {
  assert.deepEqual(sortDiscographyProjects(projects, "newest").map(({ slug }) => slug), [
    "single-recent",
    "album-old",
    "album-undated",
    "project-development",
    "single-development",
  ]);
  assert.deepEqual(sortDiscographyProjects(projects, "oldest").map(({ slug }) => slug), [
    "album-old",
    "single-recent",
    "album-undated",
    "project-development",
    "single-development",
  ]);
});

test("filtering and sorting never mutate the PostgreSQL-derived input order", () => {
  const before = projects.map(({ slug }) => slug);
  sortDiscographyProjects(filterDiscographyProjects(projects, "all"), "newest");
  assert.deepEqual(projects.map(({ slug }) => slug), before);
});

test("the visible discography collection applies one shared filter and sort policy", () => {
  assert.deepEqual(visibleDiscographyProjects(projects, "all", "editorial").map(({ slug }) => slug), [
    "single-recent",
    "album-old",
    "album-undated",
    "project-development",
    "single-development",
  ]);
  assert.deepEqual(visibleDiscographyProjects(projects, "albums", "newest").map(({ slug }) => slug), [
    "album-old",
    "album-undated",
  ]);
  assert.deepEqual(visibleDiscographyProjects(projects, "development", "oldest").map(({ slug }) => slug), [
    "project-development",
    "single-development",
  ]);
});
