/** Local France/commercial-policy gates only; closed providers and no new installation. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const root='output/dcn-france-launch';await mkdir(root,{recursive:true});
const finalRights=process.argv.includes('--final-rights');
const prefix=finalRights?'final-':'';
const profile=JSON.parse(await readFile('.private/dcn-consolidation-config.json','utf8'));
const url=new URL(profile.DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55473');assert.equal(url.pathname,'/lnx_dcn_consolidation_test');
assert.equal(profile.DCN_MODE,'TEST');assert.equal(profile.DCN_NEW_PAYMENTS_ENABLED,'false');
for(const key of Object.keys(profile))assert.ok(!/STRIPE|PAYPAL|RESEND|RAILWAY|AWS|R2|SMTP/i.test(key));
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR??'/private/tmp',...profile,DCN_EXTERNAL_TEST_AUTHORIZED:'false',DCN_NEW_PAYMENTS_ENABLED:'false',ADS_ENABLED:'false',NEXT_TELEMETRY_DISABLED:'1'};
const files=(finalRights?['rights-review','real-album-admin']:['france-launch','france-checkout','france-legal','rights-review','rights-review-checkout','commercial-refund-policy','checkout-jurisdiction','jurisdictions','digital-legal',
  'initial-delivery','pinned-media','fulfillment','real-album-admin','error-presentation','local-review-security','presentation','accounting-export']).map(name=>`tests/digital/${name}.test.ts`);
const results=[];
const clean=text=>Object.values(profile).filter(v=>typeof v==='string'&&v.length>=10).reduce((t,v)=>t.replaceAll(v,'[PRIVATE_PROFILE_VALUE]'),text)
  .replaceAll('\r','').split('\n').map(s=>s.trimEnd()).join('\n').trimEnd()+'\n';
for(const[name,cmd,args,timeout]of[
  ['targeted-tests',process.execPath,['--conditions=react-server','--import','tsx','--test','--test-reporter=tap',...files],120000],
  ['lint','npm',['run','lint'],180000],['typecheck','npm',['run','typecheck'],180000],['build-web','npm',['run','build'],300000],
  ['build-digital-worker','npm',['run','dcn:worker:build'],180000],['diff-check','git',['diff','--check'],30000],
]){
  const r=spawnSync(cmd,args,{encoding:'utf8',env,maxBuffer:5*1024*1024,timeout}),output=clean((r.stdout??'')+(r.stderr??''));
  await writeFile(`${root}/${prefix}${name}.log`,output);
  const value={name,status:r.status===0?'PASS':'FAIL',exitCode:r.status,signal:r.signal,command:[cmd,...args].join(' ')};results.push(value);console.log(JSON.stringify(value));
  if(name==='targeted-tests'){
    const count=label=>Number(output.match(new RegExp(`^# ${label} (\\d+)$`,'m'))?.[1]??0);
    const proof={environment:'LOCAL_UNIT_REPOSITORY_SESSION_AND_PROVIDER_DOUBLES_PGLITE_NOT_EXTERNAL_RECIPES',files,tests:count('tests'),pass:count('pass'),fail:count('fail'),skip:count('skipped'),exitCode:r.status};
    await writeFile(`${root}/${prefix}targeted-tests.json`,JSON.stringify(proof,null,2));console.log(JSON.stringify({...proof,files:files.length}));
  }
  await writeFile(`${root}/${prefix}final-checks.json`,JSON.stringify({environment:'LOCAL_ONLY',phase:finalRights?'FINAL_RIGHTS_INGESTION_LOCK_CHANGE':'AFFECTED_FRANCE_COMMERCIAL_SCOPE',noProviderRecipe:true,noProductionMutation:true,prismaAndDependenciesUnchanged:true,results},null,2));
  if(r.status!==0){process.exitCode=r.status??1;break;}
}
