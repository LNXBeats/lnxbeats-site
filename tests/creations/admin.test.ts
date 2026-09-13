import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("every Creations Admin page is protected and remains dynamic", async () => {
  const pages = await Promise.all([
    read("app/admin/creations/page.tsx"),
    read("app/admin/creations/nouveau/page.tsx"),
    read("app/admin/creations/[slug]/page.tsx"),
  ]);
  for (const page of pages) {
    assert.match(page, /await requireAdmin\(\)/);
    assert.match(page, /dynamic = "force-dynamic"/);
  }
  assert.match(pages[0], /<AdminBackLink href="\/admin">/);
  assert.match(pages[1], /<AdminBackLink href="\/admin\/creations">/);
  assert.match(pages[2], /<AdminBackLink href="\/admin\/creations">/);
});

test("Admin actions enforce same-origin auth, closed payloads and explicit lifecycle confirmations", async () => {
  const actions = await read("app/admin/creations/actions.ts");
  assert.match(actions, /isSameOriginMutation/);
  assert.match(actions, /return requireAdmin\(\)/);
  assert.match(actions, /strictCreationFormData/);
  assert.match(actions, /assertCreationConfirmation/);
  for (const action of [
    "createCreationAction",
    "updateCreationAction",
    "publishCreationAction",
    "unpublishCreationAction",
    "archiveCreationAction",
    "createCreationExternalLinkAction",
    "updateCreationExternalLinkAction",
    "deleteCreationExternalLinkAction",
  ]) {
    assert.match(actions, new RegExp(`export async function ${action}\\(`));
  }
  assert.doesNotMatch(actions, /stripe|paypal|checkout|payment/i);
});

test("service forces DRAFT creation and keeps slug and archived records immutable", async () => {
  const service = await read("lib/creations/service.ts");
  assert.match(service, /status: "DRAFT"/);
  assert.match(service, /publishedAt: null/);
  assert.match(service, /values\.slug !== current\.slug/);
  assert.match(service, /SLUG_IMMUTABLE/);
  assert.match(service, /status: \{ not: "ARCHIVED" \}/);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /lockVersion: \{ increment: 1 \}/);
  assert.match(service, /assertCreationPublishable\(current\)/);
  assert.match(service, /current\.status === "PUBLISHED"[\s\S]*?assertCreationPublishable\(\{/);
  assert.match(service, /summary: values\.summary/);
  assert.match(service, /primaryMedia: values\.primaryMedia/);
  assert.doesNotMatch(service, /prisma\.creation\.delete|transaction\.creation\.delete/);
});

test("Admin exposes all editorial fields, bounded media slots and external link CRUD", async () => {
  const [fields, detail, mediaManager] = await Promise.all([
    read("components/admin-creation-fields.tsx"),
    read("app/admin/creations/[slug]/page.tsx"),
    read("components/admin-creation-media-manager.tsx"),
  ]);
  for (const name of [
    "title",
    "slug",
    "summary",
    "description",
    "collaborator",
    "credits",
    "category",
    "primaryMedia",
    "position",
    "seoTitle",
    "seoDescription",
  ]) assert.match(fields, new RegExp(`name="${name}"`));
  assert.match(detail, /AdminCreationMediaManager/);
  for (const role of ["COVER", "VIDEO_POSTER", "AUDIO", "VIDEO"]) assert.match(mediaManager, new RegExp(role));
  assert.match(detail, /createCreationExternalLinkAction/);
  assert.match(detail, /updateCreationExternalLinkAction/);
  assert.match(detail, /deleteCreationExternalLinkAction/);
  assert.match(mediaManager, /type="file"/);
  assert.match(mediaManager, /rightsConfirmed/);
  assert.doesNotMatch(mediaManager, /presign|signedPut/i);
});
