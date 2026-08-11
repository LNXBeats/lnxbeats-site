import assert from "node:assert/strict";
import test from "node:test";

import { getProjectBySlug, projects } from "@/data/discography";
import { homeEditorial } from "@/data/home";

test("the local catalogue remains the explicit public runtime source", () => {
  assert.equal(projects.length, 25);
  assert.equal(new Set(projects.map(({ slug }) => slug)).size, projects.length);
});

test("the configured homepage spotlight resolves to a real published featured project", () => {
  const spotlight = getProjectBySlug(homeEditorial.spotlightProjectSlug);
  assert.ok(spotlight);
  assert.equal(spotlight.status, "published");
  assert.equal(spotlight.featured, true);
});

test("missing official covers remain explicit instead of fabricated", () => {
  for (const project of projects) {
    if (!project.cover) assert.equal(project.dataConfidence.artwork, "placeholder");
  }
});
