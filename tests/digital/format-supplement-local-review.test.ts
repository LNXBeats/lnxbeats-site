import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { digitalBody } from "@/lib/digital/http";
import { DIGITAL_MP3_ONLY_FORMAT_SUPPLEMENT } from "@/lib/digital/format-supplement";

/** Route/body contract only: no route is invoked, no DB, gateway or synthetic purchase is created. */
test("local-review checkout accepts and forwards the exact same prospective format hash as normal checkout",async()=>{
  const normal=await readFile(new URL("../../app/api/digital/checkout/route.ts",import.meta.url),"utf8");
  const local=await readFile(new URL("../../app/api/digital/local-review/checkout/route.ts",import.meta.url),"utf8");
  const hash=DIGITAL_MP3_ONLY_FORMAT_SUPPLEMENT.hashSha256;
  const validation='if(b.formatSupplementHash!==undefined&&(typeof b.formatSupplementHash!=="string"||!/^[a-f0-9]{64}$/.test(b.formatSupplementHash)))throw new DigitalError("INVALID_CHECKOUT");';
  const forwarding='...(b.formatSupplementHash===undefined?{}:{formatSupplementHash:b.formatSupplementHash as string})';
  for(const source of [normal,local]){
    const raw=source.match(/digitalBody\(request,(\[[^\]]+\])/);assert.ok(raw);
    const keys=JSON.parse(raw[1]) as string[];assert.ok(keys.includes("formatSupplementHash"));
    const request=new Request("http://127.0.0.1:3140/api/digital/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({formatSupplementHash:hash})});
    assert.deepEqual(await digitalBody(request,keys),{formatSupplementHash:hash});
    const unchanged=new Request("http://127.0.0.1:3140/api/digital/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
    assert.deepEqual(await digitalBody(unchanged,keys),{});
    for(const field of ["merchantId","authenticated","actorId","formatSupplement","gateway","provider"]){
      if(keys.includes(field))continue; // The normal route legitimately chooses STRIPE/PAYPAL; local simulation never does.
      const untrusted=new Request("http://127.0.0.1:3140/api/digital/checkout",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({formatSupplementHash:hash,[field]:"untrusted"})});
      await assert.rejects(()=>digitalBody(untrusted,keys),{code:"INVALID_BODY"});
    }
    assert.ok(source.includes(validation),"same strict optional-string/64-lowercase-hex guard");
    assert.ok(source.includes(forwarding),"no omission, coercion or default acceptance hash");
    assert.ok(source.indexOf(validation)<source.indexOf(forwarding));
  }
  assert.ok(local.includes('if(!localDigitalReviewCheckoutAllowed(actor.email,LOCAL_REVIEW_MERCHANT,true))throw new DigitalError("NOT_FOUND",404);'));
  assert.ok(local.includes('mode:"TEST"'));
  assert.ok(local.includes('simulated:true,externalProviderCalls:0'));
});
