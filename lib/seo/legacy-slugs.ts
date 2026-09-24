import "server-only";

import { prisma } from "@/lib/prisma";

const VALID_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,158}[a-z0-9])?$/;

export async function resolveLegacyPublicSlug(kind: "album" | "creations" | "boutique", formerSlug: string) {
  if (!VALID_SLUG.test(formerSlug)) return null;
  if (kind === "album") {
    const project = await prisma.project.findFirst({
      where: { formerSlugs: { has: formerSlug }, publicVisible: true, status: { in: ["PUBLISHED", "IN_DEVELOPMENT"] } },
      select: { slug: true },
    });
    return project?.slug ?? null;
  }
  if (kind === "creations") {
    const creation = await prisma.creation.findFirst({
      where: { formerSlugs: { has: formerSlug }, status: "PUBLISHED" }, select: { slug: true },
    });
    return creation?.slug ?? null;
  }
  const product = await prisma.product.findFirst({
    where: { formerSlugs: { has: formerSlug }, status: "PUBLISHED" }, select: { slug: true },
  });
  return product?.slug ?? null;
}
