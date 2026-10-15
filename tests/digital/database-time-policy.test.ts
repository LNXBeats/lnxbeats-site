/** Session guard unit doubles only; real epoch proof belongs to the local PG recipe. */
import {test} from "node:test";
import assert from "node:assert/strict";
import type {Prisma} from "@/generated/prisma/client";
import {assertDigitalDatabaseUtc} from "@/lib/digital/database-time-policy";

const database=(result:unknown)=>({$queryRaw:async(strings:TemplateStringsArray)=>{
  assert.equal(strings.join(""),"SELECT current_setting('TimeZone')::text AS timezone");
  return result;
}}) as unknown as Pick<Prisma.TransactionClient,"$queryRaw">;

test("database time guard checks the actual session read-only and accepts only explicitly UTC zones",async()=>{
  for(const timezone of["UTC","Etc/UTC"])await assertDigitalDatabaseUtc(database([{timezone}]));
});
test("database time guard rejects civil/DST zones, offset aliases, malformed or missing state",async()=>{
  for(const result of[[{timezone:"Europe/Paris"}],[{timezone:"Europe/London"}],[{timezone:"+00"}],[{timezone:"GMT"}],[{timezone:null}],[{timezone:false}],[],[{}],null,[{timezone:"UTC"},{timezone:"UTC"}]]){
    await assert.rejects(()=>assertDigitalDatabaseUtc(database(result)),{code:"DIGITAL_DATABASE_TIMEZONE_UNSAFE",status:503});
  }
});
test("database time guard converts a failed session check into a bounded fail-closed error without provider or raw DB details",async()=>{
  const db={$queryRaw:async()=>{throw Error("private connection details must not escape");}} as unknown as Pick<Prisma.TransactionClient,"$queryRaw">;
  await assert.rejects(()=>assertDigitalDatabaseUtc(db),{message:"DIGITAL_DATABASE_TIMEZONE_UNSAFE",status:503});
});
