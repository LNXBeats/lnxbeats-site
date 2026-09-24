import assert from "node:assert/strict";
import test, { after } from "node:test";

import { createAdminCreation, updateAdminCreation } from "@/lib/creations/service";
import { createCatalogProject, updateCatalogProject } from "@/lib/catalog/service";
import { createAdminProduct, updateAdminProduct } from "@/lib/shop/product-service";
import { prisma } from "@/lib/prisma";
import { resolveLegacyPublicSlug } from "@/lib/seo/legacy-slugs";

const localUrl = process.env.DATABASE_URL;
const safeLocalDatabase = (() => {
  if (!localUrl) return false;
  try {
    const url = new URL(localUrl);
    return url.hostname === "127.0.0.1" && url.port !== "5432" && url.pathname === "/lnx_admin_v2";
  } catch { return false; }
})();

after(async () => { if (safeLocalDatabase) await prisma.$disconnect(); });

test("Admin V2 generates and follows draft slugs without moving published URLs", { skip: !safeLocalDatabase }, async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const actor = await prisma.user.create({ data: { email: `admin-v2-${crypto.randomUUID()}@example.invalid`, displayName: "Admin V2 QA", role: "ADMIN", status: "ACTIVE" } });
  const creation = await createAdminCreation({ slug: "", title: `J’ai adopté un humain ${suffix}`, position: "0" });
  assert.equal(creation.slug, `j-ai-adopte-un-humain-${suffix}`);
  const renamedCreation = await updateAdminCreation(creation.id, creation.lockVersion, { slug: creation.slug, title: `Une création nouvelle ${suffix}`, position: "0" });
  assert.equal(renamedCreation.slug, `une-creation-nouvelle-${suffix}`);
  assert.deepEqual(renamedCreation.formerSlugs, [creation.slug]);
  assert.equal(await resolveLegacyPublicSlug("creations", creation.slug), null, "un brouillon ne révèle pas son ancienne adresse");

  const project = await createCatalogProject({ slug: "", title: `Mon projet ${suffix}`, type: "project", status: "draft", jukeboxPlacement: "none" });
  const renamedProject = await updateCatalogProject(project.id, { updatedAt: project.updatedAt.toISOString(), title: `Mon projet corrigé ${suffix}`, type: "project", status: "draft", jukeboxPlacement: "none" });
  assert.equal(renamedProject.slug, `mon-projet-corrige-${suffix}`);
  assert.deepEqual(renamedProject.formerSlugs, [project.slug]);
  assert.equal(await resolveLegacyPublicSlug("album", project.slug), null, "un brouillon reste privé");
  const publishedProject = await updateCatalogProject(project.id, { updatedAt: renamedProject.updatedAt.toISOString(), title: `Mon projet publié ${suffix}`, type: "project", status: "published", publicVisible: "on", jukeboxPlacement: "none" });
  assert.equal(await resolveLegacyPublicSlug("album", project.slug), publishedProject.slug, "l’ancien slug public pointe directement vers le canonical");
  const retitledProject = await updateCatalogProject(project.id, { updatedAt: publishedProject.updatedAt.toISOString(), title: `Nouveau titre publié ${suffix}`, type: "project", status: "published", publicVisible: "on", jukeboxPlacement: "none" });
  assert.equal(retitledProject.slug, publishedProject.slug);

  const productInput = { slug: "", title: `Badge d’essai ${suffix}`, description: "Produit local de validation.", priceCents: null, trackInventory: false, shippingRequired: false, shippingPriceCents: 0, shippingWeightGrams: null, position: 0 };
  const product = await createAdminProduct(productInput, actor.id);
  const renamedProduct = await updateAdminProduct(product.id, product.lockVersion, { ...productInput, slug: product.slug, title: `Badge nouveau ${suffix}` }, actor.id);
  assert.equal(renamedProduct.slug, `badge-nouveau-${suffix}`);
  assert.deepEqual(renamedProduct.formerSlugs, [product.slug]);
  assert.equal(await resolveLegacyPublicSlug("boutique", product.slug), null, "un produit non publié reste privé");
});
