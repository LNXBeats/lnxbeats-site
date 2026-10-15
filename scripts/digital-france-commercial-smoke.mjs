/** Read-only HTTP smoke of the compiled, loopback-only DCN demonstration. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:3140';
const results=[];
for(const [path,expected]of[['/api/health',200],['/musique/conditions',200],['/musique/panier',200],['/musique/checkout',307],['/album/dcn-edition-privee-9d063091-fe2e-432a-bdae-53dd46988e2f',404]]){
  const response=await fetch(base+path,{redirect:'manual',signal:AbortSignal.timeout(15000)});
  const html=await response.text();
  const item={path,status:response.status,expected,pass:response.status===expected};
  if(path==='/musique/conditions'){
    item.franceDraftPresent=html.includes('digital-music-france-cgv-20261015-draft-02');
    item.guaranteeBoxPresent=html.includes('garantie légale de conformité');
    item.adsScriptAbsent=!/<script[^>]+src=["'][^"']*(?:adsbygoogle|pagead2)/.test(html);
    item.pass&&=item.franceDraftPresent&&item.guaranteeBoxPresent&&item.adsScriptAbsent;
  }
  if(path==='/musique/checkout')item.loginRedirect=response.headers.get('location')?.startsWith('/connexion')??false;
  results.push(item);
}
await writeFile('output/dcn-france-commercial/local-http-smoke.json',JSON.stringify({environment:'COMPILED_LOCAL_LOOPBACK_ONLY',browserTests:false,providerCalls:0,results},null,2));
console.log(JSON.stringify(results));assert.ok(results.every(r=>r.pass));
