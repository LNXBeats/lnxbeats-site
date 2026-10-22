import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("additive migration records old public resources without subscribing or mailing anyone; constraints hold", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE projects (id uuid PRIMARY KEY, title varchar(240), slug varchar(160), status text, "publicVisible" boolean, type text);
      CREATE TABLE products (id uuid PRIMARY KEY, title varchar(240), slug varchar(160), status text);
      CREATE TABLE product_audit_events (id uuid PRIMARY KEY, "productId" uuid, action text);
      CREATE TABLE creations (id uuid PRIMARY KEY, title varchar(240), slug varchar(160), status text);
      INSERT INTO users VALUES ('3dfde946-d72b-465b-b53c-a7878cac9d37');
      INSERT INTO projects VALUES ('11111111-1111-4111-8111-111111111111','Ancien album','ancien-album','PUBLISHED',true,'ALBUM'),
        ('22222222-2222-4222-8222-222222222222','Brouillon privé','brouillon-prive','DRAFT',false,'SINGLE');
      INSERT INTO products VALUES ('33333333-3333-4333-8333-333333333333','Ancien produit','ancien-produit','PUBLISHED');
      INSERT INTO creations VALUES ('44444444-4444-4444-8444-444444444444','Actualité publiée','actualite-publiee','PUBLISHED');`);
    const before = await db.query("SELECT * FROM projects ORDER BY id");
    await db.exec(await readFile(new URL("../../prisma/migrations/20261022020000_release_alert_preferences/migration.sql", import.meta.url), "utf8"));
    assert.deepEqual((await db.query("SELECT * FROM projects ORDER BY id")).rows, before.rows);
    assert.equal((await db.query<{ total: number }>("SELECT count(*)::int AS total FROM release_publications WHERE baseline AND expanded")).rows[0].total, 3);
    assert.equal((await db.query<{ total: number }>("SELECT count(*)::int AS total FROM release_alert_preferences")).rows[0].total, 0);
    assert.equal((await db.query<{ total: number }>("SELECT count(*)::int AS total FROM release_alert_deliveries")).rows[0].total, 0);
    await assert.rejects(db.query(`INSERT INTO release_alert_preferences ("userId", music, "consentVersion", "updatedAt") VALUES ('3dfde946-d72b-465b-b53c-a7878cac9d37', true, 'v1', now())`));
    await db.query(`INSERT INTO release_alert_preferences ("userId", music, "musicConsentedAt", "consentVersion", "updatedAt") VALUES ('3dfde946-d72b-465b-b53c-a7878cac9d37', true, now(), 'v1', now())`);
    await assert.rejects(db.query(`INSERT INTO release_publications (id,kind,"resourceId",title,path) VALUES (gen_random_uuid(),'MUSIC','11111111-1111-4111-8111-111111111111','Duplicate','/album/duplicate')`));
    await assert.rejects(db.query(`INSERT INTO release_publications (id,kind,"resourceId",title,path) VALUES (gen_random_uuid(),'PAYMENT',gen_random_uuid(),'No payment','/no')`));
  } finally { await db.close(); }
});
