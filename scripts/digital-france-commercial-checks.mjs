/** Affected local boundaries only; never provider recipes or production configuration. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const root='output/dcn-france-commercial';await mkdir(root,{recursive:true});
const file='.private/dcn-france-commercial-config.json';assert.equal((await stat(file)).mode&0o077,0);
const cfg=JSON.parse(await readFile(file,'utf8')),url=new URL(cfg.DATABASE_URL);
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55473');assert.equal(url.pathname,'/lnx_dcn_france_commercial_test_20261015');assert.equal(url.username,'dcn_runtime_a');assert.equal(url.searchParams.get('options'),'-c timezone=UTC');
for(const key of Object.keys(cfg))assert.ok(!/STRIPE|PAYPAL|RESEND|RAILWAY|AWS|R2|SMTP/i.test(key));
for(const name of['.env','.env.local','.env.production','.env.production.local'])await assert.rejects(stat(name),{code:'ENOENT'},'Build must not implicitly load an unreviewed dotenv profile.');
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR??'/private/tmp',NODE_ENV:'test',...cfg,DCN_ENABLED:'false',DCN_NEW_PAYMENTS_ENABLED:'false',DCN_EXTERNAL_TEST_AUTHORIZED:'false',ADS_ENABLED:'false',NEXT_TELEMETRY_DISABLED:'1'};
// Audio/import already passed before the final equivalence/contact changes; retain those proofs.
const files=['completion','completion-repository','album-ownership','free-completion','master-equivalence','master-equivalences-admin','france-contract-binding','france-checkout-contract','france-legal','fulfillment','initial-delivery','domain','library-labels','local-review-security','checkout-jurisdiction','error-presentation'].map(n=>`tests/digital/${n}.test.ts`);
const secrets=Object.values(cfg).filter(v=>typeof v==='string'&&v.length>=10);secrets.push(decodeURIComponent(url.password));
const clean=value=>secrets.filter(v=>v.length>=8).reduce((s,v)=>s.replaceAll(v,'[PRIVATE_PROFILE_VALUE]'),value);
const resume=process.argv[2]==='--from-typecheck';assert.ok(process.argv.length===2||process.argv.length===3&&resume);
const results=resume?JSON.parse(await readFile(`${root}/final-checks.json`,'utf8')).results.slice(0,3):[];
if(resume)assert.deepEqual(results.map(r=>[r.name,r.status]),[['targeted-tests','PASS'],['prisma-validate','PASS'],['lint','PASS']]);
const checks=[['targeted-tests',process.execPath,['--conditions=react-server','--import','tsx','--test','--test-reporter=tap',...files],180000],
  ['prisma-validate','./node_modules/.bin/prisma',['validate'],120000],['lint','npm',['run','lint'],180000],['typecheck','npm',['run','typecheck'],180000],
  ['build-web','npm',['run','build'],300000],['build-digital-worker','npm',['run','dcn:worker:build'],180000],['diff-check','git',['diff','--check'],30000]];
for(const[name,cmd,args,timeout]of(resume?checks.slice(3):checks)){
  const run=spawnSync(cmd,args,{encoding:'utf8',env:{...env,NODE_ENV:name==='build-web'?'production':'test'},timeout,maxBuffer:8*1024*1024}),output=clean((run.stdout??'')+(run.stderr??'')).replace(/\r/g,'').replace(/[ \t]+$/gm,'').trimEnd()+'\n';await writeFile(`${root}/${name}.log`,output);
  const result={name,status:run.status===0?'PASS':'FAIL',exitCode:run.status,signal:run.signal,command:[cmd,...args].join(' ')};results.push(result);console.log(JSON.stringify(result));
  if(name==='targeted-tests'){const count=n=>Number(output.match(new RegExp(`^# ${n} (\\d+)$`,'m'))?.[1]??0);await writeFile(`${root}/targeted-tests.json`,JSON.stringify({environment:'LOCAL_UNIT_REPOSITORY_AND_PROVIDER_DOUBLES_NOT_EXTERNAL_RECIPES',files,pass:count('pass'),fail:count('fail'),skip:count('skipped'),tests:count('tests')},null,2));}
  await writeFile(`${root}/final-checks.json`,JSON.stringify({environment:'LOCAL_QA_ONLY',providerRecipesRepeated:false,productionMutation:false,results},null,2));
  if(run.status!==0){process.exitCode=1;break;}
}
