/** Child processes with doubles only; no actual socket, service or profile read. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const runtime = new URL("./paypal-dcn-qa-runtime.mjs", import.meta.url).href;
const fetchModule = new URL("./paypal-dcn-qa-fetch.mjs", import.meta.url).href;
const fixture = new URL("./paypal-dcn-qa-test-fixture.mjs", import.meta.url).href;
const preload = new URL("./paypal-dcn-qa-preload.mjs", import.meta.url).pathname;
function run(source, extraArgs = []) {
  return execFileSync(process.execPath, [...extraArgs, "--input-type=module", "--eval", source], {
    encoding: "utf8", timeout: 10000, maxBuffer: 4096,
    env: { PATH: process.env.PATH, NODE_ENV: "test" },
  }).trim();
}
const fakeTransports = `
  import assert from 'node:assert/strict';
  import http from 'node:http'; import https from 'node:https';
  import net from 'node:net'; import tls from 'node:tls';
  let rawCalls=0, localFetches=0;
  http.request=http.get=https.request=https.get=()=>{rawCalls++; return 'offline';};
  net.Socket.prototype.connect=()=>{rawCalls++; return 'offline';};
  tls.connect=()=>{rawCalls++; return 'offline';};
  globalThis.fetch=async()=>{localFetches++; return Response.json({local:true});};
`;
test("default preload is closed without reading a credential profile or starting a service", () => {
  const result = run(`
    import assert from 'node:assert/strict';
    import https from 'node:https';
    await assert.rejects(fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token'), /AUTHORIZATION_REQUIRED/);
    assert.throws(()=>https.request('https://api-m.sandbox.paypal.com/v1/oauth2/token'), /UNINSTRUMENTED/);
    console.log('PASS_CLOSED_NO_NETWORK');
  `, ["--import", preload]);
  assert.equal(result, "PASS_CLOSED_NO_NETWORK");
});
test("direct API and alternate transports blocked; approved loopback HTTP path remains usable", () => {
  const result = run(`${fakeTransports}
    const {installPaypalQaNetworkGuard}=await import(${JSON.stringify(runtime)});
    const {PAYPAL_QA_FETCH_ATTESTATION}=await import(${JSON.stringify(fetchModule)});
    installPaypalQaNetworkGuard();
    assert.equal(globalThis.fetch[PAYPAL_QA_FETCH_ATTESTATION].closed,true);
    for(const call of [()=>http.request('http://example.invalid'),
      ()=>https.get('https://api-m.sandbox.paypal.com/v1/oauth2/token'),
      ()=>net.connect({host:'api-m.sandbox.paypal.com',port:443}),
      ()=>tls.connect({host:'api-m.sandbox.paypal.com',port:443}),
      ()=>net.connect({path:'/tmp/unapproved.socket'}),
      ()=>http.request({hostname:'127.0.0.1',port:3141,path:'/stripe'})]) assert.throws(call,/UNINSTRUMENTED/);
    assert.equal(rawCalls,0);
    assert.equal(http.request({hostname:'127.0.0.1',port:3140,path:'/api/digital/webhooks/paypal'}),'offline');
    assert.equal(net.connect({host:'127.0.0.1',port:55473}),'offline');
    await fetch('http://127.0.0.1:3140/api/local');
    await fetch(new Request('http://127.0.0.1:3140/api/local', {method:'POST',body:'synthetic'}));
    assert.equal(rawCalls,2);assert.equal(localFetches,2);
    console.log('PASS_LOOPBACK_AND_BYPASS_REFUSAL');
  `);
  assert.equal(result, "PASS_LOOPBACK_AND_BYPASS_REFUSAL");
});
test("Next-style fetch wrappers cannot bypass sandbox accounting; local requests remain compatible", () => {
  const result = run(`${fakeTransports}
    const {installPaypalQaNetworkGuard}=await import(${JSON.stringify(runtime)});
    const {PAYPAL_QA_FETCH_ATTESTATION}=await import(${JSON.stringify(fetchModule)});
    const {withOfflineBudget,OFFLINE_BINDING,offlineOauthInput,offlineOauthResponse}=await import(${JSON.stringify(fixture)});
    await withOfflineBudget(async({budget})=>{
      let providerCalls=0,cacheWrapperCalls=0;
      installPaypalQaNetworkGuard({budget,binding:OFFLINE_BINDING,fetchTransport:async()=>{
        providerCalls++;assert.equal((await budget.snapshot()).used.OAUTH,providerCalls);return offlineOauthResponse();
      }});
      const base=globalThis.fetch;
      globalThis.fetch=async(...args)=>{cacheWrapperCalls++;return base(...args);};
      await fetch(...offlineOauthInput());
      await fetch('http://127.0.0.1:3140/api/local');
      assert.equal(providerCalls,1);assert.equal(cacheWrapperCalls,1);assert.equal(localFetches,1);
      assert.equal(globalThis.fetch[PAYPAL_QA_FETCH_ATTESTATION].durableReservationBeforeTransport,true);
      globalThis.fetch=async()=>Response.json({unbudgeted:true});
      await fetch(...offlineOauthInput());
      assert.equal(providerCalls,2);assert.equal((await budget.snapshot()).used.REST_TOTAL,2);
      assert.throws(()=>https.request('https://api-m.sandbox.paypal.com/v1/oauth2/token'),/UNINSTRUMENTED/);
      await assert.rejects(fetch('https://api-m.paypal.com/v1/oauth2/token'),/SANDBOX_ONLY/);
      assert.equal(rawCalls,0);
    });
    console.log('PASS_FETCH_WRAPPER_ATTESTED');
  `);
  assert.equal(result, "PASS_FETCH_WRAPPER_ATTESTED");
});
