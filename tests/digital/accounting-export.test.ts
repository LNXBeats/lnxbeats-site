import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";
import {csvCell} from "@/lib/digital/domain";
test("DCN accounting export includes immutable territory, credit, tax and acquired formats without known-fee inventions",async()=>{
 const source=await readFile(new URL("../../app/api/admin/digital/export/route.ts",import.meta.url),"utf8");
 for(const marker of["jurisdictionSnapshot","completionSnapshot","taxSnapshot","trackSnapshot","digitalActor(request,true)","private, no-store","csvCell","const mode=requireDigitalEnvironment()","where:{mode}","dcn-${mode.toLowerCase()}-registre.csv"])assert.ok(source.includes(marker),marker);
 assert.ok(source.includes('"frais vérifiés","net vérifié"'));assert.ok(source.includes('a.paymentReference,"",""'));
 assert.doesNotMatch(source,/masterAsset|storageKey|checkoutUrl/);
 for(const attack of['=HYPERLINK("https://example.invalid")',' +SUM(1,2)','\t@cmd'])assert.ok(csvCell(attack).startsWith('"\''));
});
