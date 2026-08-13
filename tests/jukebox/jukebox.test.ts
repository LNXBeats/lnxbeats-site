import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { jukeboxInitialIndex } from "@/lib/catalog/jukebox";
import { isPublicProject, selectJukeboxProjects } from "@/lib/catalog/publication";

type SelectorFixture = {
  slug: string;
  status: "published" | "in-development" | "draft" | "archive";
  publicVisible: boolean;
  jukeboxPlacement: "published" | "development" | null;
  jukeboxPosition: number | null;
  catalogPosition: number;
  cover: string | null;
};

const fixture = (overrides: Partial<SelectorFixture> = {}): SelectorFixture => ({
  slug: "projet-a",
  status: "published",
  publicVisible: true,
  jukeboxPlacement: "published",
  jukeboxPosition: 1,
  catalogPosition: 1,
  cover: "/media/catalog/cover",
  ...overrides,
});

test("public visibility is independent from the documented editorial status", () => {
  assert.equal(isPublicProject(fixture()), true);
  assert.equal(isPublicProject(fixture({ status: "in-development" })), true);
  assert.equal(isPublicProject(fixture({ publicVisible: false })), false);
  assert.equal(isPublicProject(fixture({ status: "draft" })), false);
  assert.equal(isPublicProject(fixture({ status: "archive" })), false);
});

test("each jukebox uses its explicit placement, public visibility, status and cover", () => {
  const projects = [
    fixture({ slug: "published" }),
    fixture({ slug: "development", status: "in-development", jukeboxPlacement: "development" }),
    fixture({ slug: "hidden", publicVisible: false }),
    fixture({ slug: "without-cover", cover: null }),
    fixture({ slug: "wrong-status", status: "in-development" }),
    fixture({ slug: "not-placed", jukeboxPlacement: null }),
  ];

  assert.deepEqual(selectJukeboxProjects(projects, "published").map(({ slug }) => slug), ["published"]);
  assert.deepEqual(selectJukeboxProjects(projects, "development").map(({ slug }) => slug), ["development"]);
  assert.deepEqual(selectJukeboxProjects([], "published"), []);
});

test("jukebox order is deterministic with gaps, duplicates and missing positions", () => {
  const projects = [
    fixture({ slug: "missing", jukeboxPosition: null, catalogPosition: 1 }),
    fixture({ slug: "position-ten", jukeboxPosition: 10, catalogPosition: 4 }),
    fixture({ slug: "duplicate-b", jukeboxPosition: 3, catalogPosition: 6 }),
    fixture({ slug: "duplicate-a", jukeboxPosition: 3, catalogPosition: 2 }),
  ];

  assert.deepEqual(selectJukeboxProjects(projects, "published").map(({ slug }) => slug), [
    "duplicate-a",
    "duplicate-b",
    "position-ten",
    "missing",
  ]);
});

test("the featured eligible project is initial, otherwise the editorial first item is used", () => {
  assert.equal(jukeboxInitialIndex([{ featured: false }, { featured: true }, { featured: false }]), 1);
  assert.equal(jukeboxInitialIndex([{ featured: false }]), 0);
  assert.equal(jukeboxInitialIndex([]), 0);
});

test("discography reuses one jukebox component and hides an empty development collection", async () => {
  const [homepage, discography] = await Promise.all([
    readFile(new URL("../../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/discographie/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(homepage, /ProjectJukebox|HomeJukebox/);
  assert.equal((discography.match(/<ProjectJukebox\b/g)?.length ?? 0), 2);
  assert.match(discography, /developmentJukebox\.length \?/);
  assert.match(discography, /publishedProjects\.length} projets publiés/);
  assert.match(discography, /<CompactProjectCatalog projects=\{publishedProjects}/);
});

test("the desktop scene keeps five relative cover positions", async () => {
  const component = await readFile(new URL("../../components/home-jukebox.tsx", import.meta.url), "utf8");
  for (const position of ["is-far-previous", "is-previous", "is-active", "is-next", "is-far-next"]) assert.match(component, new RegExp(position));
});

test("the jukebox keeps one explicit continuous model for safari-friendly playback", async () => {
  const component = await readFile(new URL("../../components/home-jukebox.tsx", import.meta.url), "utf8");
  assert.match(component, /const \[audioUnlocked, setAudioUnlocked\] = useState\(false\);/);
  assert.match(component, /const \[continuousPlayback, setContinuousPlayback\] = useState\(false\);/);
  assert.match(component, /const shouldAutoplay = useCallback/);
  assert.match(component, /const attemptPlayback = useCallback/);
  assert.match(component, /const playRequestRef = useRef\(0\);/);
  assert.match(component, /const playbackAllowed = continuousPlayback;/);
  assert.doesNotMatch(component, /const playbackAllowed = fromGesture \|\| continuousPlayback;/);
  assert.match(component, /if \(playbackAllowed && nextProject\.audioPreview\)/);
  assert.match(component, /playRequestRef\.current \+= 1;/);
  assert.match(component, /if \(audio\.src !== targetSrc\)/);
  assert.doesNotMatch(component, /audio\.currentSrc !== targetSrc/);
  assert.match(component, /window\.dispatchEvent\(new CustomEvent\("lnx-audio-preview-play"/);
});

test("all public players coordinate through one playback event", async () => {
  const [jukebox, standalone] = await Promise.all([
    readFile(new URL("../../components/home-jukebox.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/audio-preview-player.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(jukebox, /window\.addEventListener\("lnx-audio-preview-play", stopOtherJukebox\)/);
  assert.match(jukebox, /pauseCurrent\(false\)/);
  assert.match(standalone, /window\.addEventListener\(playbackEvent, stopOtherPlayer\)/);
});

test("the jukebox uses a single shared audio element and explicit user-triggered play attempts", async () => {
  const component = await readFile(new URL("../../components/home-jukebox.tsx", import.meta.url), "utf8");
  assert.equal((component.match(/<audio\b/g)?.length ?? 0), 1);
  assert.match(component, /ref={audioRef}/);
  assert.doesNotMatch(component, /\bautoPlay\b/);
  assert.doesNotMatch(component, /\bcontrols\b/);
  assert.match(component, /pauseCurrent\(false\)/);
  assert.match(component, /catch \{/);
  assert.doesNotMatch(component, /audio\.play\(\)\.catch/);
});

test("navigation is bounded and exposes symmetric accessible 48px controls plus a hint", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("../../components/home-jukebox.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(component, /select\(activeIndex \+ Math\.sign\(index - activeIndex\)\)/);
  assert.match(component, /next === activeIndex/);
  assert.match(component, /aria-label="Projet précédent"/);
  assert.match(component, /aria-label="Projet suivant"/);
  assert.match(component, /disabled={activeIndex === 0}/);
  assert.match(component, /disabled={activeIndex === projects\.length - 1}/);
  assert.equal((component.match(/home-jukebox__arrow-track/g)?.length ?? 0), 2);
  assert.equal((component.match(/home-jukebox__arrow-line/g)?.length ?? 0), 2);
  assert.equal((component.match(/home-jukebox__arrow-symbol/g)?.length ?? 0), 2);
  assert.match(component, /Faites défiler les projets/);
  assert.match(component, /Glissez pour parcourir/);
  assert.match(css, /\.home-jukebox__arrow-symbol[\s\S]*?width: 48px;[\s\S]*?height: 48px;/);
  assert.match(css, /--jukebox-arrow-vertical: -50%;/);
  assert.match(css, /\.home-jukebox__arrow--previous:hover:not\(:disabled\),[\s\S]*?transform: translateY\(var\(--jukebox-arrow-vertical\)\);/);
});

test("the visual system preloads only immediate eager covers and neutralizes drag taps", async () => {
  const component = await readFile(new URL("../../components/home-jukebox.tsx", import.meta.url), "utf8");
  assert.match(component, /const preloadCover = Math\.abs\(distance\) <= 1;/);
  assert.match(component, /priority={eager && preloadCover}/);
  assert.match(component, /Math\.hypot\(event\.clientX - start\.x, event\.clientY - start\.y\) > 8/);
  assert.match(component, /if \(pointerDraggedRef\.current\)/);
});

test("the desktop CSS uses 3D transforms while reduced motion keeps the catalogue visible", async () => {
  const css = await readFile(new URL("../../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /perspective: 1100px/);
  assert.match(css, /transform-style: preserve-3d/);
  assert.match(css, /rotateY\(28deg\)/);
  assert.match(css, /rotateY\(-28deg\)/);
  assert.match(css, /560ms cubic-bezier\(\.22,1,\.36,1\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(max-width: 700px\) and \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.home-jukebox__item \{ transform: none !important; \}/);
});

test("the publication migration is additive and preserves the existing public catalogue", async () => {
  const sql = await readFile(new URL("../../prisma/migrations/20260812143000_project_publication_controls/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN "publicVisible" BOOLEAN NOT NULL DEFAULT true/);
  assert.match(sql, /ADD COLUMN "jukeboxPlacement"/);
  assert.match(sql, /ADD COLUMN "jukeboxPosition" INTEGER/);
  assert.match(sql, /WHEN project\."status" = 'PUBLISHED' THEN 'PUBLISHED'/);
  assert.match(sql, /WHEN project\."status" = 'IN_DEVELOPMENT' THEN 'DEVELOPMENT'/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/);
});

test("hidden projects are filtered from lists, direct pages, sitemap and public media", async () => {
  const [queries, coverRoute, audioRoute, albumPage, sitemap] = await Promise.all([
    readFile(new URL("../../lib/catalog/queries.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/media/catalog/[assetId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/media/catalog/audio/[assetId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/album/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/sitemap.ts", import.meta.url), "utf8"),
  ]);
  assert.match(queries, /const publicProjectWhere = \{[\s\S]*?publicVisible: true/);
  assert.match(queries, /where: \{ \.\.\.publicProjectWhere, slug \}/);
  assert.match(queries, /listSitemapProjects[\s\S]*?where: publicProjectWhere/);
  assert.match(coverRoute, /publicVisible: true/);
  assert.match(audioRoute, /publicVisible: true/);
  assert.match(albumPage, /if \(!project\) notFound\(\)/);
  assert.match(sitemap, /listSitemapProjects\(\)/);
});
