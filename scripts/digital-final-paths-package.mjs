/** Local-only handoff: fresh smoke/read-only source canaries, then explicit packaging allowlist. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,readdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import pg from 'pg';
const artifacts='/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42';
const destination=`${artifacts}/DCN_FINAL_PATHS_20261015`,proofRoot='output/dcn-final-paths';
const base='3a015d380e876e885feceb9c9e0bb603dbcc8fb3';
const reports=['DCN_FINAL_PATHS_20261015.md','DCN_WITHDRAWAL_20261015.md','DCN_FRANCE_RESIDENCE_V2.md','DCN_FIRST_REAL_ALBUM_LAUNCH.md','DCN_FRANCE_CGV_REVIEW.md','DCN_FRANCE_FISCAL_REVIEW_20261015.md'];
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const quote=value=>`"${value.replaceAll('"','""')}"`;
assert.equal(git('branch','--show-current'),'feature/dcn-1-0');assert.equal(git('merge-base',base,'HEAD'),base);
assert.equal(git('diff',base,'--','package.json','package-lock.json','data/legal.ts','lib/digital/digital-legal.ts','lib/digital/france-legal.ts','lib/billing','lib/payments','lib/support'),'');
const upgrade=JSON.parse(await readFile(`${proofRoot}/upgrade-runtime.json`,'utf8'));
assert.equal(upgrade.status,'PASS');assert.equal(upgrade.runtime.checkCount,33);assert.equal(upgrade.restore.restoredCanaryTables,106);
const runtime=JSON.parse(await readFile(`${proofRoot}/functional-runtime.json`,'utf8'));
assert.ok(runtime.checks.length>=11);assert.ok(runtime.checks.every(c=>c.status==='PASS'));assert.equal(runtime.providerCalls,0);assert.equal(runtime.emailsSent,0);
const gates=JSON.parse(await readFile(`${proofRoot}/final-final-checks.json`,'utf8'));
assert.equal(gates.results.length,6);assert.ok(gates.results.every(c=>c.status==='PASS'));
for(const name of ['targeted-tests','final-targeted-tests']){
  const tests=JSON.parse(await readFile(`${proofRoot}/${name}.json`,'utf8'));assert.ok(tests.pass>=45);assert.equal(tests.fail,0);assert.equal(tests.skip,0);
}
const finalTestProof=JSON.parse(await readFile(`${proofRoot}/final-targeted-tests.json`,'utf8'));
await mkdir(proofRoot,{recursive:true});
if(!process.argv.includes('--package-only')){
  const fixture=JSON.parse(await readFile('.private/dcn-consolidation-fixture.json','utf8'));assert.match(fixture.slug,/^[a-z0-9-]+$/);
  const checks=[];
  for(const route of ['/api/health',`/album/${fixture.slug}`,'/musique/conditions','/retractation?contrat=digital','/api/digital/residence','/api/admin/digital/consumer-requests','/api/admin/digital/residence-reviews','/compte/musique']){
    const method=route.startsWith('/api/admin/')?'POST':'GET';
    const response=await fetch(`http://127.0.0.1:3140${route}`,{method,...(method==='POST'?{headers:{origin:'http://127.0.0.1:3140','content-type':'application/json'},body:'{}'}:{}),redirect:'manual',signal:AbortSignal.timeout(20000)}),body=await response.text();
    const expected=route==='/compte/musique'?[302,303,307]:route.startsWith('/api/')&&route!=='/api/health'?[401,403]:[200];
    assert.ok(expected.includes(response.status),`Unexpected local smoke status ${route} ${response.status}`);
    if(route==='/retractation?contrat=digital')assert.ok(body.includes('Musique numérique'));
    checks.push({route,method,status:response.status,result:'PASS',authenticated:false});
  }
  await writeFile(`${proofRoot}/built-local-smoke.json`,JSON.stringify({environment:'BUILT_NEW_LOCAL_POSTGRESQL_COPY_LOOPBACK',checks,providerCalls:0,note:'Anonymous Admin/residence APIs refuse and library redirects. Initial smoke used GET on POST-only Admin route (405); harness corrected to actual POST, without changing application. No provider recipe or authenticated Admin browser claim.'},null,2));
  const owner=JSON.parse(await readFile('.private/dcn-consolidation-owner-config.json','utf8')),url=new URL(owner.DATABASE_URL);
  assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55473');assert.equal(url.pathname,'/lnx_dcn_consolidation_test');
  const db=new pg.Client({connectionString:url.toString(),options:'-c default_transaction_read_only=on'});await db.connect();
  try{
    assert.equal((await db.query('SHOW transaction_read_only')).rows[0].transaction_read_only,'on');
    const canaries=[];
    for(const saved of upgrade.sourceRecheck.canaries){
      assert.match(saved.table,/^[a-z_]+$/);
      const columns=(await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",[saved.table])).rows.map(r=>r.column_name);
      const row=(await db.query(`SELECT count(*)::int AS count,md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY to_jsonb(p)::text)::text,'[]')) AS hash FROM (SELECT ${columns.map(c=>`t.${quote(c)}`).join(',')} FROM public.${quote(saved.table)} t) p`)).rows[0];
      assert.deepEqual({table:saved.table,...row},saved,`Historical local source drift: ${saved.table}`);canaries.push({table:saved.table,result:'PASS'});
    }
    await writeFile(`${proofRoot}/source-final-recheck.json`,JSON.stringify({status:'PASS',connectionReadOnly:true,canaryTables:canaries.length,canaries,sourceMutation:false,productionAccess:false},null,2));
  }finally{await db.end();}
  const cfg=JSON.parse(await readFile('.private/dcn-final-paths-config.json','utf8')),targetUrl=new URL(cfg.DATABASE_URL);
  assert.equal(targetUrl.hostname,'127.0.0.1');assert.equal(targetUrl.port,'55473');assert.equal(targetUrl.pathname,'/lnx_dcn_final_paths_test_20261015');
  assert.equal(targetUrl.searchParams.get('options'),'-c timezone=UTC');targetUrl.searchParams.delete('options');
  const target=new pg.Client({connectionString:targetUrl.toString(),options:'-c timezone=UTC -c default_transaction_read_only=on'});await target.connect();
  try{
    assert.equal((await target.query("SHOW TimeZone")).rows[0].TimeZone,'UTC');
    assert.equal((await target.query("SHOW transaction_read_only")).rows[0].transaction_read_only,'on');
    const browserInput=JSON.parse(await readFile(`${proofRoot}/browser-receipt-input.json`,'utf8'));
    assert.match(browserInput.requestNumber,/^LNX-RET-2026-[A-F0-9]{12}$/);assert.match(browserInput.downloadPath,/^\/Users\/lnxbeats\/Downloads\/LNX-RET-2026-[A-F0-9]{12}\.txt$/);
    const request=(await target.query('SELECT id,"requestNumber","identityMatch","eligibilityReview","receivedAt",extract(epoch FROM "receivedAt")::numeric*1000 AS milliseconds,"acknowledgementSnapshot"->>\'receivedAt\' AS "snapshotTime","acknowledgementHashSha256" FROM consumer_withdrawal_requests WHERE "requestNumber"=$1',[browserInput.requestNumber])).rows[0];
    assert.ok(request);assert.equal(request.identityMatch,'UNMATCHED');assert.equal(request.eligibilityReview,'PENDING_REVIEW');
    const bytes=await readFile(browserInput.downloadPath),text=bytes.toString('utf8');
    assert.equal(Number(request.milliseconds),Date.parse(request.snapshotTime));
    assert.ok(text.includes(request.requestNumber));assert.ok(text.includes(request.receivedAt.toISOString()));assert.ok(text.includes(request.acknowledgementHashSha256));
    const notices=(await target.query('SELECT status,"sentAt" FROM digital_notifications WHERE "withdrawalRequestId"=$1',[request.id])).rows;
    assert.equal(notices.length,1);assert.ok(['PENDING','CAPTURED_QA'].includes(notices[0].status));assert.equal(notices[0].sentAt,null);
    await writeFile(`${proofRoot}/browser-local-smoke.json`,JSON.stringify({status:'PASS',method:'Real Codex in-app browser UI + actual downloaded TXT + independent native SQL epoch / JSON snapshot / Prisma UTC crosscheck',environment:'LOCAL_ONLY_SYNTHETIC_UNMATCHED_REQUEST',checks:['digital_default_selection','review_before_confirmation','modify_preserves_form','explicit_confirmation','content_date_time_receipt','actual_txt_download','no_console_error_or_warning','unmatched_remains_pending','single_durable_outbox_job_not_sent','native_sql_epoch_matches_snapshot'],receiptDownloadSha256:digest(bytes),receiptBytes:bytes.length,requestMatched:false,automaticRefund:false,accessRevocation:false,emailsSent:0,physicalSafariTest:false,initialBeforeUtcReceiptPreserved:true},null,2));
    await mkdir(`${destination}/examples`,{recursive:true});await copyFile(browserInput.downloadPath,`${destination}/examples/QA-consumer-acknowledgement.txt`);
  }finally{await target.end();}
}
for(const name of ['built-local-smoke','source-final-recheck','browser-local-smoke'])assert.ok(await readFile(`${proofRoot}/${name}.json`));
try{await readFile(`${proofRoot}/security-scan.json`);}catch{await writeFile(`${proofRoot}/security-scan.json`,'{}');}
const privateValues=new Set();
function collect(value,key=''){
  if(value&&typeof value==='object')for(const[k,v]of Object.entries(value))collect(v,k);
  else if(typeof value==='string'&&/password|secret|token|database_url/i.test(key)&&value.length>=10){privateValues.add(value);if(/database_url/i.test(key)){const url=new URL(value);if(url.password)privateValues.add(decodeURIComponent(url.password));}}
}
for(const name of ['dcn-consolidation-config.json','dcn-consolidation-owner-config.json','dcn-consolidation-browser-credentials.json','dcn-final-paths-config.json'])collect(JSON.parse(await readFile(`.private/${name}`,'utf8')));
const patterns=[/\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{16,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\bgh[opsu]_[A-Za-z0-9]{30,}/,/postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/];
const paths=[...new Set([...git('diff','--name-only',base).split('\n'),...git('ls-files','--others','--exclude-standard','app','components','lib','scripts','tests','docs',proofRoot,'prisma').split('\n')])].filter(Boolean);
const failed=[];let scanned=0;
for(const file of paths){
  assert.ok((await lstat(file)).isFile());assert.ok(!/\.(wav|mp3|zip|dump|pdf|png|jpg)$/i.test(file));const raw=await readFile(file,'utf8');
  let scan=raw;
  if(file==='tests/digital/france-residence-v2.test.ts')scan=scan.replace(/postgresql:\/\/unit:unit@127\.0\.0\.1:1\/unit/g,'[UNIT_FIXTURE]').replace(/postgresql:\/\/dcn_runtime_a:fake-qa-not-a-secret@127\.0\.0\.1:55473\/lnx_dcn_consolidation_test/g,'[NEVER_CONNECT_UNIT_FIXTURE]');
  if(file==='tests/legal/digital-withdrawal.test.ts')scan=scan.replace(/postgresql:\/\/invalid:invalid@127\.0\.0\.1:1\/invalid/g,'[UNIT_FIXTURE]');
  if(patterns.some(pattern=>pattern.test(scan))||[...privateValues].some(value=>raw.includes(value)))failed.push(file);scanned++;
}
privateValues.clear();assert.deepEqual(failed,[],'Targeted secret scan: file names only, no credential values printed');
await writeFile(`${proofRoot}/security-scan.json`,JSON.stringify({status:'PASS',filesScanned:scanned,matches:0,secretsPrinted:false,method:'All changed allowlisted files + exact private-profile credential values in memory + token/private-key/credentialed-URL patterns',exception:'Only explicit never-connect mocked DSNs in the two new unit tests; known private values have no exemptions',limitation:'Targeted local scan, not a dependency or historical audit'},null,2));
for(const dir of ['reports','proofs','images'])await mkdir(`${destination}/${dir}`,{recursive:true});
for(const name of reports)await copyFile(`docs/${name}`,`${destination}/reports/${name}`);
const proofNames=await readdir(proofRoot);for(const name of proofNames){assert.match(name,/^[a-z0-9-]+\.(json|log)$/);await copyFile(`${proofRoot}/${name}`,`${destination}/proofs/${name}`);}
await copyFile(`${artifacts}/DCN_FINAL_PATHS_receipt_UTC_20261015.jpg`,`${destination}/images/QA-consumer-acknowledgement.jpg`);
const revision={branch:git('branch','--show-current'),sha:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),base,trackedStatus:git('status','--short','--untracked-files=no'),push:false,merge:false,deployment:false,providerRecipeRepeated:false,productionMutation:false};
await writeFile(`${destination}/FINAL_REVISION.json`,JSON.stringify(revision,null,2));
const escape=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const articles=[];for(const name of reports)articles.push(`<article><h2>${escape(name)}</h2><pre>${escape(await readFile(`docs/${name}`,'utf8'))}</pre></article>`);
await writeFile(`${destination}/index.html`,`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>DCN — deux parcours finaux locaux</title><style>body{max-width:1000px;margin:32px auto;padding:0 20px;background:#111;color:#eee;font:16px/1.6 system-ui}h1,h2,a{color:#e7c66b}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.65 ui-monospace,monospace}article{margin-top:48px;border-top:1px solid #555}img{max-width:100%;height:auto}</style><h1>DCN — rétractation et résidence</h1><p>LOCAL UNIQUEMENT — pas prêt Production. 128 tests initiaux, puis ${finalTestProof.pass} tests affectés finaux, non additionnés. PostgreSQL réel : 33 ACL + ${runtime.checks.length} scénarios, copie isolée et 106 canaris historiques. Aucun master, document confidentiel, base ou secret.</p><p>SHA ${revision.sha}<br>Tree ${revision.tree}</p><p><a href="FINAL_REVISION.json">Révision</a> · <a href="proofs/final-final-checks.json">Gates finaux</a> · <a href="examples/QA-consumer-acknowledgement.txt">Accusé QA téléchargé</a></p><img src="images/QA-consumer-acknowledgement.jpg" alt="Accusé de la demande synthétique locale">${articles.join('')}</html>`);
const names=['index.html','FINAL_REVISION.json','images/QA-consumer-acknowledgement.jpg','examples/QA-consumer-acknowledgement.txt',...reports.map(name=>`reports/${name}`),...proofNames.map(name=>`proofs/${name}`)];
const manifest=[];for(const name of names){assert.ok(!/(?:\.env|\.private|\.dump|\.wav|\.mp3|\.zip|credentials)/i.test(name));const bytes=await readFile(`${destination}/${name}`);manifest.push({path:name,bytes:bytes.length,sha256:digest(bytes)});}
await writeFile(`${destination}/MANIFEST_SHA256.json`,JSON.stringify({files:manifest},null,2));
const zip=`${artifacts}/LNX_DCN_FINAL_PATHS_20261015.zip`;
execFileSync('zip',['-q',zip,'MANIFEST_SHA256.json',...names],{cwd:destination,stdio:'pipe'});execFileSync('unzip',['-t',zip],{stdio:'pipe'});
const entries=execFileSync('unzip',['-Z1',zip],{encoding:'utf8'}).trim().split('\n');assert.equal(entries.length,names.length+1);
for(const file of manifest)assert.equal(digest(execFileSync('unzip',['-p',zip,file.path],{maxBuffer:10*1024*1024})),file.sha256);
console.log(JSON.stringify({zip,files:entries.length,sha256:digest(await readFile(zip)),zipIntegrity:'PASS',securityScan:'PASS',revision}));
