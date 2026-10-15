/** Presentation-only gates. Previously acquired financial/audio recipes are not repeated. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const root='output/dcn-france-validation-20261015';await mkdir(root,{recursive:true});
const file='.private/dcn-france-commercial-config.json';assert.equal((await stat(file)).mode&0o077,0);
const cfg=JSON.parse(await readFile(file,'utf8')),url=new URL(cfg.DATABASE_URL);
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55473');assert.equal(url.pathname,'/lnx_dcn_france_commercial_test_20261015');assert.equal(url.username,'dcn_runtime_a');assert.equal(url.searchParams.get('options'),'-c timezone=UTC');
for(const key of Object.keys(cfg))assert.ok(!/STRIPE|PAYPAL|RESEND|RAILWAY|AWS|R2|SMTP/i.test(key));
for(const name of['.env','.env.local','.env.production','.env.production.local'])await assert.rejects(stat(name),{code:'ENOENT'});
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR??'/private/tmp',NODE_ENV:'test',...cfg,DCN_ENABLED:'false',DCN_NEW_PAYMENTS_ENABLED:'false',DCN_EXTERNAL_TEST_AUTHORIZED:'false',ADS_ENABLED:'false',NEXT_TELEMETRY_DISABLED:'1'};
const privateValues=Object.values(cfg).filter(v=>typeof v==='string'&&v.length>=10);privateValues.push(decodeURIComponent(url.password));
const clean=value=>privateValues.filter(v=>v.length>=8).reduce((s,v)=>s.replaceAll(v,'[PRIVATE_PROFILE_VALUE]'),value).replace(/\r/g,'').replace(/[ \t]+$/gm,'').trimEnd();
const files=['admin-presentation','admin','master-equivalences-admin'].map(n=>`tests/digital/${n}.test.ts`);
const checks=[['targeted-tests',process.execPath,['--conditions=react-server','--import','tsx','--test','--test-reporter=tap',...files],120000],
  ['lint','npm',['run','lint'],180000],['typecheck','npm',['run','typecheck'],180000],['build-web','npm',['run','build'],300000],['diff-check','git',['diff','--check'],30000]];
const results=[];
for(const[name,cmd,args,timeout]of checks){
  const run=spawnSync(cmd,args,{encoding:'utf8',env:{...env,NODE_ENV:name==='build-web'?'production':'test'},timeout,maxBuffer:8*1024*1024}),output=clean((run.stdout??'')+(run.stderr??''));
  await writeFile(`${root}/${name}.log`,output?output+'\n':'');
  const item={name,status:run.status===0?'PASS':'FAIL',exitCode:run.status,signal:run.signal,command:[cmd,...args].join(' ')};results.push(item);console.log(JSON.stringify(item));
  if(name==='targeted-tests'){const count=n=>Number(output.match(new RegExp(`^# ${n} (\\d+)$`,'m'))?.[1]??0);await writeFile(`${root}/targeted-tests.json`,JSON.stringify({environment:'LOCAL_PRESENTATION_TESTS_WITH_DOUBLES_NO_PROVIDER_RECIPES',files,pass:count('pass'),fail:count('fail'),skip:count('skipped')},null,2)+'\n');}
  await writeFile(`${root}/checks.json`,JSON.stringify({environment:'LOCAL_QA',base:'d0e995e612e353230a318ad4214daa9cb3697795',providerRecipesRepeated:false,productionMutation:false,prisma:'NOT_RUN_SCHEMA_UNCHANGED',workerBuild:'REUSED_FROM_UNCHANGED_WORKER_BASE',results},null,2)+'\n');
  if(run.status!==0){process.exitCode=1;break;}
}
