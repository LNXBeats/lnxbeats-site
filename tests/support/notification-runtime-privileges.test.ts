import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { SUPPORT_NOTIFICATION_CONSUMER_COLUMNS } from "@/lib/support/notification-runtime-privileges";
test("consumer mutates only notification state; no enqueue, contribution write or sequence", async()=>{
  const source=await readFile(new URL('../../lib/support/notifications.ts',import.meta.url),'utf8');
  const dispatcher=source.split('export async function dispatchSupportNotifications')[1];
  assert.doesNotMatch(dispatcher,/supportNotification\.create|supportContribution\.(update|create|delete)|nextval/);
  assert.match(dispatcher,/pg_advisory_xact_lock/); assert.match(dispatcher,/leaseToken: claim.leaseToken/);
  assert.deepEqual([...SUPPORT_NOTIFICATION_CONSUMER_COLUMNS],['status','recipient','attempts','firstAttemptAt','availableAt','leaseToken','leaseUntil','providerMessageId','sentAt']);
});
test("versioned ACL requires explicit distinct consumer, stable group and effective denials",async()=>{
  const source=await readFile(new URL('../../lib/support/notification-runtime-privileges.ts',import.meta.url),'utf8');
  assert.match(source,/assert.notEqual\(role, webRole/); assert.match(source,/rolname<>current_user/);
  assert.match(source,/INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN/);
  assert.doesNotMatch(source,/lnx_notifications_rot_|GRANT ALL|TO PUBLIC/);
  const script=await readFile(new URL('../../scripts/provision-creations-runtime-privileges.ts',import.meta.url),'utf8');
  assert.match(script,/NOTIFICATIONS_RUNTIME_ROLE/); assert.match(script,/provisionSupportNotificationConsumer/);
});
