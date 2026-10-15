/** Narrow local gates: no installation, external recipe, provider API or global test campaign. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const root='output/dcn-launch';await mkdir(root,{recursive:true});
const profile=JSON.parse(await readFile('.private/dcn-consolidation-config.json','utf8'));
const url=new URL(profile.DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55473');assert.equal(url.pathname,'/lnx_dcn_consolidation_test');
assert.equal(profile.DCN_MODE,'TEST');assert.equal(profile.DCN_NEW_PAYMENTS_ENABLED,'false');
for(const key of Object.keys(profile))assert.ok(!/STRIPE|PAYPAL|RESEND|RAILWAY|AWS|R2|SMTP/i.test(key));
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR??'/private/tmp',...profile,
  DCN_EXTERNAL_TEST_AUTHORIZED:'false',DCN_NEW_PAYMENTS_ENABLED:'false',ADS_ENABLED:'false',NEXT_TELEMETRY_DISABLED:'1'};
const files=[
  'domain','completion','completion-repository','album-ownership',
  'formats','audio-formats','audio-validation','audio-revalidation',
  'admin','real-album-admin','fulfillment','initial-delivery','pinned-media',
  'finance-incident-preservation','accounting-export','library-labels','presentation',
  'error-presentation','checkout-jurisdiction','local-review-security','scoped-jobs',
].map(name=>`tests/digital/${name}.test.ts`);
const results=[];
// Resume is reserved for this lot's type-only test-fixture correction. A normal
// invocation always reruns the selected suite; it is not a cross-revision cache.
const resume=process.argv.includes('--resume-type-fixture');
if(resume){
  const prior=JSON.parse(await readFile(`${root}/final-checks.json`,'utf8'));
  assert.deepEqual(prior.results.map(r=>[r.name,r.status]),[['targeted-tests','PASS'],['lint','PASS'],['typecheck','FAIL']]);
  const tests=JSON.parse(await readFile(`${root}/targeted-tests.json`,'utf8'));assert.equal(tests.fail,0);assert.deepEqual(tests.files,files);
  await copyFile(`${root}/final-checks.json`,`${root}/first-attempt.json`);await copyFile(`${root}/typecheck.log`,`${root}/typecheck-first-attempt.log`);
  results.push(...prior.results.filter(r=>r.status==='PASS'));
}
const clean=text=>Object.values(profile).filter(v=>typeof v==='string'&&v.length>=10).reduce((t,v)=>t.replaceAll(v,'[PRIVATE_PROFILE_VALUE]'),text)
  .replaceAll('\r','').split('\n').map(line=>line.trimEnd()).join('\n').trimEnd()+'\n';
async function run(name,cmd,args,timeout){
  const r=spawnSync(cmd,args,{encoding:'utf8',env,maxBuffer:5*1024*1024,timeout});
  const output=clean((r.stdout??'')+(r.stderr??''));await writeFile(`${root}/${name}.log`,output);
  const result={name,status:r.status===0?'PASS':'FAIL',exitCode:r.status,signal:r.signal,command:[cmd,...args].join(' ')};
  results.push(result);console.log(JSON.stringify(result));
  if(r.status!==0){await writeFile(`${root}/final-checks.json`,JSON.stringify({environment:'LOCAL_ONLY',results},null,2));process.exitCode=1;return false;}
  if(name==='targeted-tests'){
    const count=label=>Number(output.match(new RegExp(`^# ${label} (\\d+)$`,'m'))?.[1]??0);
    const proof={environment:'LOCAL_UNIT_REPOSITORY_DOUBLES_PGLITE_AND_REAL_FFMPEG_NOT_PROVIDER_RECIPES',files,
      tests:count('tests'),pass:count('pass'),fail:count('fail'),skip:count('skipped'),exitCode:r.status};
    assert.ok(proof.tests>0);assert.equal(proof.fail,0);await writeFile(`${root}/targeted-tests.json`,JSON.stringify(proof,null,2));console.log(JSON.stringify({...proof,files:files.length}));
  }
  return true;
}
if(resume){
  if(!await run('revalidation-fixture-recheck',process.execPath,['--conditions=react-server','--import','tsx','--test','tests/digital/audio-revalidation.test.ts'],30000))process.exit(1);
}else if(!await run('targeted-tests',process.execPath,['--conditions=react-server','--import','tsx','--test','--test-reporter=tap',...files],180000))process.exit(1);
for(const[name,args,timeout]of[
  ...(!resume?[['lint',['run','lint'],180000]]:[]),['typecheck',['run','typecheck'],180000],
  ['build-web',['run','build'],300000],['build-digital-worker',['run','dcn:worker:build'],180000],
])if(!await run(name,'npm',args,timeout))process.exit(1);
if(!await run('diff-check','git',['diff','--check'],30000))process.exit(1);
await writeFile(`${root}/final-checks.json`,JSON.stringify({environment:'LOCAL_ONLY',installationRepeated:false,
  prismaSchemaUnchanged:true,dependencyLockUnchanged:true,providerRecipesRepeated:false,results},null,2));
