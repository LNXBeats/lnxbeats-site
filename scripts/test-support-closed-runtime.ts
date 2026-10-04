import assert from "node:assert/strict";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { provisionCreationsRuntimePrivileges, provisionAdminOrderVisibilityAuditPrivileges } from "@/lib/database/creations-runtime-privileges";
import { provisionSupportRuntimePrivileges, SUPPORT_RUNTIME_TABLES } from "@/lib/support/runtime-privileges";

// Local disposable restore only. Never accepts a Production or default-port URL.
const url = assertSafeLocalPostgresUrl(process.env.MIGRATION_DATABASE_URL ?? "");
assert.match(url.pathname, /_test$/);
const owner = new Client({ connectionString: url.toString() });
let checks = 0;
await owner.connect();
try {
  const historicalAcl = async () => (await owner.query(`SELECT relname,relacl::text FROM pg_class
    WHERE relnamespace='public'::regnamespace AND relkind='r'
      AND relname NOT LIKE 'support_%' ORDER BY relname`)).rows;
  const originalAcl = await historicalAcl();
  for (const role of ["lnx_support_qa_runtime_a", "lnx_support_qa_runtime_b"]) {
    await owner.query(`CREATE ROLE "${role}" LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await provisionCreationsRuntimePrivileges(owner, role);
    await provisionAdminOrderVisibilityAuditPrivileges(owner);
    await provisionSupportRuntimePrivileges(owner, role);
    await provisionSupportRuntimePrivileges(owner, role);
    const runtimeUrl = new URL(url); runtimeUrl.username = role; runtimeUrl.password = "";
    const runtime = new Client({ connectionString: runtimeUrl.toString() });
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: runtimeUrl.toString() }) });
    await runtime.connect();
    const denied = async (sql: string) => {
      await assert.rejects(runtime.query(sql), (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === "42501"); checks++;
    };
    try {
      assert.deepEqual(await prisma.supportContribution.findMany({ select: {
        id: true, amountCents: true, currency: true, provider: true, mode: true, status: true,
        createdAt: true, providerReference: true, paymentReference: true, refundReference: true,
        userId: true, events: { select: { id: true, type: true, createdAt: true, actorId: true }, orderBy: { createdAt: "asc" } },
      }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 200 }), []); checks++;
      for (const table of SUPPORT_RUNTIME_TABLES) {
        if (table !== "support_contribution_attempts") { await runtime.query(`SELECT * FROM "${table}" LIMIT 0`); checks++; }
        else await denied(`SELECT * FROM "${table}" LIMIT 0`);
        for (const sql of [`INSERT INTO "${table}" DEFAULT VALUES`, `UPDATE "${table}" SET id=id WHERE false`, `DELETE FROM "${table}" WHERE false`, `TRUNCATE "${table}"`]) await denied(sql);
      }
      await denied("SELECT * FROM _prisma_migrations LIMIT 0");
      await denied("CREATE TABLE public.support_unauthorized_qa(id int)");
      assert.equal((await runtime.query("SELECT has_table_privilege(current_user,'support_contributions','SELECT WITH GRANT OPTION') AS allowed")).rows[0].allowed, false); checks++;
      const audit = (await runtime.query("SELECT has_table_privilege(current_user,'order_current_view_visibility_events','SELECT') s,has_table_privilege(current_user,'order_current_view_visibility_events','INSERT') i,has_table_privilege(current_user,'order_current_view_visibility_events','UPDATE,DELETE') excess")).rows[0];
      assert.deepEqual(audit, { s: true, i: true, excess: false }); checks++;
    } finally { await prisma.$disconnect(); await runtime.end(); }
  }
  assert.deepEqual(await historicalAcl(), originalAcl); checks++;
  for (const table of SUPPORT_RUNTIME_TABLES) {
    assert.equal((await owner.query(`SELECT has_table_privilege('lnx_creations_runtime',$1,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS allowed`, [`public.${table}`])).rows[0].allowed, false); checks++;
    assert.equal((await owner.query(`SELECT count(*)::int n FROM "${table}"`)).rows[0].n, 0); checks++;
  }
  console.log(JSON.stringify({ status: "PASS", checks, distinctRoles: 2, provisioningRuns: 4, historicalAclPreserved: true, supportRows: 0 }));
} finally { await owner.end(); }
