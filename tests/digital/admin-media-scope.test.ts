import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { prisma } from "@/lib/prisma";
import { processDigitalMedia } from "@/lib/digital/media-worker";

test("audio QA scopes recovery and ingestion to one exact new upload while the normal worker retains its default", async () => {
  const environment = { ...process.env }, find = prisma.digitalUpload.findFirst, received: Array<Record<string, unknown>> = [];
  Object.assign(process.env, { DCN_ENABLED: "true", DCN_MODE: "TEST" });
  delete process.env.RAILWAY_ENVIRONMENT_NAME; delete process.env.MEDIA_DEPLOYMENT_ENV; delete process.env.PAYMENT_DEPLOYMENT_ENV;
  try {
    prisma.digitalUpload.findFirst = (async (args: { where: Record<string, unknown> }) => { received.push(args.where); return null; }) as unknown as typeof find;
    const id = randomUUID();
    assert.deepEqual(await processDigitalMedia({ uploadId: id }), { processed: false });
    assert.equal(received[0].id, id); assert.equal(received[1].id, id);
    await processDigitalMedia(); assert.equal(received[2].id, undefined); assert.equal(received[3].id, undefined);
    await assert.rejects(processDigitalMedia({ uploadId: "../unrelated" }), { code: "INVALID_ID" });
    assert.equal(received.length, 4);
  } finally {
    prisma.digitalUpload.findFirst = find;
    for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
    Object.assign(process.env, environment);
  }
});
