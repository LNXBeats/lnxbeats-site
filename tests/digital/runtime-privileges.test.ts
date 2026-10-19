import assert from "node:assert/strict";
import { test } from "node:test";
import type { Client } from "pg";
import { DIGITAL_RUNTIME_TABLES, DIGITAL_UPDATE_COLUMNS, provisionDigitalRuntime } from "@/lib/digital/runtime-privileges";

function clientDouble(unsafeTable?: string) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = { async query(sql: string, values?: unknown[]) {
    calls.push({ sql, values });
    if (sql.includes("rolcanlogin AND rolinherit")) return { rows: [{ safe: true }] };
    if (sql.includes("NOT rolcanlogin")) return { rows: [{ safe: true }] };
    if (sql.includes("relowner=current_user")) return { rows: DIGITAL_RUNTIME_TABLES.map(relname => ({ relname, owned: true })) };
    if (sql.includes("information_schema.columns")) return { rows: [{ column_name: "status" }] };
    if (sql.includes("has_table_privilege")) return { rows: [{ bad: values?.[1] === `public.${unsafeTable}` }] };
    return { rows: [] };
  } } as unknown as Client;
  return { client, calls };
}

test("DCN preserves the historical withdrawal grant without granting table-wide UPDATE", async () => {
  const { client, calls } = clientDouble();
  await provisionDigitalRuntime(client, "dcn_release_runtime");
  const checks = calls.filter(call => call.sql.includes("has_table_privilege"));
  assert.equal(checks.length, DIGITAL_RUNTIME_TABLES.length);
  for (const call of checks) assert.equal(call.values?.[2], call.values?.[1] === "public.consumer_withdrawal_requests"
    ? "DELETE,TRUNCATE,REFERENCES,TRIGGER" : "UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER");
  assert.ok(calls.some(call => call.sql.startsWith("GRANT UPDATE (")));
  assert.ok(calls.every(call => !/^GRANT UPDATE ON TABLE/.test(call.sql)));
  assert.ok(calls.every(call => !call.sql.includes("FROM \"dcn_release_runtime\"")));
  assert.equal(calls.at(-1)?.sql, "COMMIT");
});

test("Studio artifacts stay append-only and job identity cannot be updated by runtime", () => {
  assert.deepEqual(DIGITAL_UPDATE_COLUMNS.digital_studio_artifacts, []);
  for (const identity of ["title", "album", "metadata", "trackId", "uploadId", "actorId", "attempt", "createdAt"]) assert.ok(!(DIGITAL_UPDATE_COLUMNS.digital_studio_jobs as readonly string[]).includes(identity));
});
for (const table of ["digital_offers", "digital_events", "digital_country_tax_rules", "consumer_withdrawal_requests", "digital_studio_jobs", "digital_studio_artifacts"]) {
  test(`unsafe effective privileges on ${table} roll back provisioning`, async () => {
    const { client, calls } = clientDouble(table);
    await assert.rejects(provisionDigitalRuntime(client, "dcn_release_runtime"));
    assert.equal(calls.at(-1)?.sql, "ROLLBACK");
    assert.ok(!calls.some(call => call.sql === "COMMIT"));
  });
}
