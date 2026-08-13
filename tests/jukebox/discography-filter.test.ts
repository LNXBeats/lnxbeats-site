import assert from "node:assert/strict";
import test from "node:test";

import {
  discographyFilterCounts,
  filterDiscographyProjects,
  sortDiscographyProjects,
} from "@/lib/catalog/jukebox";

type FixtureProject = {
  slug: string;
  type: "album" | "single" | "project";
  status: "published" | "in-development" | "draft" | "archive";
  releaseDate: string | null;
  catalogPosition: number;
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
