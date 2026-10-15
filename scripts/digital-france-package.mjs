/** Explicit local allowlist: no profiles, databases, masters or confidential evidence. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,readdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const artifacts='/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42';
const destination=`${artifacts}/DCN_FRANCE_LAUNCH_PREPARATION_20261015`;
const proofRoot='output/dcn-france-launch',base='ee5ace65dff096545cbf1622291e55280cc4d8ae';
const reports=['DCN_FRANCE_LAUNCH_CHECKLIST_20261015.md','DCN_FRANCE_TERRITORY_PLAN.md','DCN_FRANCE_CGV_REVIEW.md','DCN_FRANCE_FISCAL_REVIEW_20261015.md','DCN_COMMERCIAL_DECISIONS_20261015.md','DCN_RIGHTS_REVIEW_20261015.md'];
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
assert.equal(git('branch','--show-current'),'feature/dcn-1-0');assert.equal(git('merge-base',base,'HEAD'),base);
assert.equal(git('diff',base,'--','prisma','package.json','package-lock.json','data/legal.ts','lib/digital/digital-legal.ts','lib/billing','lib/payments','lib/support'),'');
await mkdir(proofRoot,{recursive:true});
try{await readFile(`${proofRoot}/security-scan.json`);}catch{await writeFile(`${proofRoot}/security-scan.json`,'{}');}
const final=JSON.parse(await readFile(`${proofRoot}/final-final-checks.json`,'utf8'));
assert.ok(final.results.length===6&&final.results.every(result=>result.status==='PASS'));
const tests=JSON.parse(await readFile(`${proofRoot}/targeted-tests.json`,'utf8'));
const affected=JSON.parse(await readFile(`${proofRoot}/final-targeted-tests.json`,'utf8'));
assert.equal(tests.pass,123);assert.equal(tests.fail,0);assert.equal(affected.pass,17);assert.equal(affected.fail,0);
if(!process.argv.includes('--package-only')){
  const fixture=JSON.parse(await readFile('.private/dcn-consolidation-fixture.json','utf8'));assert.match(fixture.slug,/^[a-z0-9-]+$/);
  const checks=[];
  for(const route of ['/api/health',`/album/${fixture.slug}`,'/musique/conditions','/connexion','/compte/musique','/api/admin/digital/rights-reviews']){
    const response=await fetch(`http://127.0.0.1:3140${route}`,{redirect:'manual',signal:AbortSignal.timeout(20000)});
    const body=await response.text();
    const expected=route==='/compte/musique'?[302,303,307]:route==='/api/admin/digital/rights-reviews'?[401,403]:[200];
    assert.ok(expected.includes(response.status),`Unexpected local smoke status ${route} ${response.status}`);
    if(route==='/musique/conditions')assert.ok(body.includes('digital-music-france-cgv-20261015-draft-01'));
    checks.push({route,status:response.status,result:'PASS',authenticated:false});
  }
  await writeFile(`${proofRoot}/built-local-smoke.json`,JSON.stringify({environment:'BUILT_LOCAL_LOOPBACK_ONLY',checks,
    note:'Anonymous library redirects and Admin API refuses. No authenticated Admin UI, payment or acquired download recipe repeated.',providerCalls:0},null,2));
}else assert.equal(JSON.parse(await readFile(`${proofRoot}/built-local-smoke.json`,'utf8')).checks.length,6);
const privateValues=new Set();
function collect(value,key=''){
  if(value&&typeof value==='object')for(const[k,v]of Object.entries(value))collect(v,k);
  else if(typeof value==='string'&&/password|secret|token|database_url/i.test(key)&&value.length>=10){privateValues.add(value);if(/database_url/i.test(key)){const url=new URL(value);if(url.password)privateValues.add(decodeURIComponent(url.password));}}
}
for(const file of ['dcn-consolidation-config.json','dcn-consolidation-owner-config.json','dcn-consolidation-browser-credentials.json','dcn-review-config.json'])collect(JSON.parse(await readFile(`.private/${file}`,'utf8')));
const patterns=[/\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{16,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\bgh[opsu]_[A-Za-z0-9]{30,}/,/postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/];
const paths=[...new Set([...git('diff','--name-only',base).split('\n'),...git('ls-files','--others','--exclude-standard','app','components','lib','scripts','tests','docs',proofRoot).split('\n')])].filter(Boolean);
const failed=[];let scanned=0;
for(const file of paths){
  assert.ok((await lstat(file)).isFile());assert.ok(!/\.(wav|mp3|zip|dump|pdf|png|jpg)$/i.test(file));const raw=await readFile(file,'utf8');
  // Only pre-existing, explicit never-connect unit fixtures are exempt from the URL pattern.
  let scan=file==='tests/digital/checkout-jurisdiction.test.ts'?raw.replace(/postgresql:\/\/(?:dcn_runtime_a|dcn_owner):fixture_never_connect_20261015@(?:127\.0\.0\.1:55473\/lnx_dcn_consolidation_test|remote\.example\.invalid:5432\/qa)/g,'[NEVER_CONNECT_UNIT_FIXTURE]'):raw;
  if(file==='tests/digital/commercial-refund-policy.test.ts')scan=scan.replace(/postgresql:\/\/unit:[a-z]{4}@127\.0\.0\.1:1\/unit/g,'[MOCKED_UNIT_REPOSITORY_PORT_1]');
  if(patterns.some(pattern=>pattern.test(scan))||[...privateValues].some(value=>raw.includes(value)))failed.push(file);scanned++;
}
privateValues.clear();assert.deepEqual(failed,[],'Targeted scan paths only; no secret values printed');
await writeFile(`${proofRoot}/security-scan.json`,JSON.stringify({status:'PASS',filesScanned:scanned,matches:0,secretsPrinted:false,
  method:'Changed allowlisted files + known private-profile credential literals + token/private-key/credentialed-URL patterns',
  exception:'Only explicit fixture_never_connect_20261015 URLs and the mocked unit repository at 127.0.0.1:1/unit; known private credential literals still checked without exemptions',limitation:'Targeted local scan, not a historical audit'},null,2));
for(const dir of ['reports','proofs'])await mkdir(`${destination}/${dir}`,{recursive:true});
for(const name of reports)await copyFile(`docs/${name}`,`${destination}/reports/${name}`);
const proofNames=await readdir(proofRoot);for(const name of proofNames){assert.match(name,/^[a-z0-9-]+\.(json|log)$/);await copyFile(`${proofRoot}/${name}`,`${destination}/proofs/${name}`);}
const revision={branch:git('branch','--show-current'),sha:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),base,
  trackedStatus:git('status','--short','--untracked-files=no'),push:false,merge:false,deployment:false,providerRecipeRepeated:false,productionMutation:false};
await writeFile(`${destination}/FINAL_REVISION.json`,JSON.stringify(revision,null,2));
const escape=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const links=reports.map(name=>`<li><a href="#${name}">${escape(name)}</a> — <a href="reports/${name}">source</a></li>`).join('');
const articles=[];for(const name of reports)articles.push(`<article id="${name}"><h2>${escape(name)}</h2><pre>${escape(await readFile(`docs/${name}`,'utf8'))}</pre></article>`);
await writeFile(`${destination}/index.html`,`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>DCN — lancement France — préparation locale</title><style>body{max-width:1000px;margin:32px auto;padding:0 20px;background:#111;color:#eee;font:16px/1.6 system-ui}h1,h2,a{color:#e7c66b}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.65 ui-monospace,monospace}article{margin-top:48px;border-top:1px solid #555}</style><h1>DCN — préparation France métropolitaine / Corse</h1><p>LOCAL UNIQUEMENT — pas prêt Production. Trois décisions commerciales intégrées, sans approbation juridique. 123 tests ciblés ; sous-ensemble final de 17 non additionné. Aucun master, document confidentiel, base ou secret.</p><p>SHA ${revision.sha}<br>Tree ${revision.tree}</p><ul>${links}</ul><p><a href="FINAL_REVISION.json">Révision</a> · <a href="proofs/final-final-checks.json">Gates finaux</a> · <a href="proofs/targeted-tests.json">Tests ciblés</a> · <a href="proofs/built-local-smoke.json">Smoke local</a></p>${articles.join('')}</html>`);
const names=['index.html','FINAL_REVISION.json',...reports.map(name=>`reports/${name}`),...proofNames.map(name=>`proofs/${name}`)];
const manifest=[];for(const name of names){assert.ok(!/(?:\.env|\.private|\.dump|\.wav|\.mp3|\.zip|credentials)/i.test(name));const bytes=await readFile(`${destination}/${name}`);manifest.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
await writeFile(`${destination}/MANIFEST_SHA256.json`,JSON.stringify({files:manifest},null,2));
const zip=`${artifacts}/LNX_DCN_FRANCE_LAUNCH_PREPARATION_20261015.zip`;
execFileSync('zip',['-q',zip,'MANIFEST_SHA256.json',...names],{cwd:destination,stdio:'pipe'});execFileSync('unzip',['-t',zip],{stdio:'pipe'});
const entries=execFileSync('unzip',['-Z1',zip],{encoding:'utf8'}).trim().split('\n');assert.equal(entries.length,names.length+1);
for(const file of manifest)assert.equal(createHash('sha256').update(execFileSync('unzip',['-p',zip,file.path],{maxBuffer:10*1024*1024})).digest('hex'),file.sha256);
console.log(JSON.stringify({zip,files:entries.length,sha256:createHash('sha256').update(await readFile(zip)).digest('hex'),zipIntegrity:'PASS',securityScan:'PASS',revision}));
