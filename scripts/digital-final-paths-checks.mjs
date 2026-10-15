/** Only affected withdrawal/residence/provider boundaries, never external recipes. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const root='output/dcn-final-paths';await mkdir(root,{recursive:true});
const finalBoundary=process.argv.includes('--final-boundaries'),prefix=finalBoundary?'final-':'';
const cfg=JSON.parse(await readFile('.private/dcn-consolidation-config.json','utf8'));
const u=new URL(cfg.DATABASE_URL);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55473');assert.equal(u.pathname,'/lnx_dcn_consolidation_test');
for(const key of Object.keys(cfg))assert.ok(!/STRIPE|PAYPAL|RESEND|RAILWAY|R2|AWS|SMTP/i.test(key));
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR??'/private/tmp',NODE_ENV:'test',...cfg,DCN_NEW_PAYMENTS_ENABLED:'false',DCN_EXTERNAL_TEST_AUTHORIZED:'false',ADS_ENABLED:'false',NEXT_TELEMETRY_DISABLED:'1'};
const files=['tests/legal/withdrawal.test.ts','tests/legal/digital-withdrawal.test.ts',...(finalBoundary?['database-time-policy','france-residence-v2','france-provider-billing','providers','paypal-declined','local-review-security']:['database-time-policy','france-residence-v2','france-checkout','france-provider-billing','providers','paypal-declined','checkout-jurisdiction','initial-delivery','fulfillment','local-review-security','commercial-refund-policy','finance-incident-preservation','presentation','error-presentation']).map(n=>`tests/digital/${n}.test.ts`)];
const clean=text=>Object.values(cfg).filter(value=>typeof value==='string'&&value.length>=10).reduce((t,value)=>t.replaceAll(value,'[PRIVATE_PROFILE_VALUE]'),text).replaceAll('\r','').split('\n').map(line=>line.trimEnd()).join('\n').trimEnd()+'\n';
const results=[];
for(const[name,command,args,timeout]of[
  ['targeted-tests',process.execPath,['--conditions=react-server','--import','tsx','--test','--test-reporter=tap',...files],120000],
  ...(finalBoundary?[]:[['prisma-format','./node_modules/.bin/prisma',['format'],120000],['prisma-validate','./node_modules/.bin/prisma',['validate'],120000],['prisma-generate','./node_modules/.bin/prisma',['generate'],120000]]),
  ['lint','npm',['run','lint'],180000],['typecheck','npm',['run','typecheck'],180000],['build-web','npm',['run','build'],300000],['build-digital-worker','npm',['run','dcn:worker:build'],180000],['diff-check','git',['diff','--check'],30000],
]){
  const r=spawnSync(command,args,{encoding:'utf8',env,maxBuffer:5*1024*1024,timeout}),output=clean((r.stdout??'')+(r.stderr??''));await writeFile(`${root}/${prefix}${name}.log`,output);
  const value={name,status:r.status===0?'PASS':'FAIL',exitCode:r.status,signal:r.signal,command:[command,...args].join(' ')};results.push(value);console.log(JSON.stringify(value));
  if(name==='targeted-tests'){const count=label=>Number(output.match(new RegExp(`^# ${label} (\\d+)$`,'m'))?.[1]??0);const proof={environment:'LOCAL_UNIT_REPOSITORY_SESSION_PROVIDER_DOUBLES_NOT_EXTERNAL_RECIPES',files,tests:count('tests'),pass:count('pass'),fail:count('fail'),skip:count('skipped'),exitCode:r.status};await writeFile(`${root}/${prefix}targeted-tests.json`,JSON.stringify(proof,null,2));console.log(JSON.stringify({...proof,files:files.length}));}
  await writeFile(`${root}/${prefix}final-checks.json`,JSON.stringify({environment:'LOCAL_ONLY',phase:finalBoundary?'FINAL_UTC_WITHDRAWAL_RESIDENCE_AND_PROVIDER_BOUNDARIES':'AFFECTED_FINAL_PATHS_SCOPE',providerRecipesRepeated:false,productionMutation:false,results},null,2));if(r.status!==0){process.exitCode=r.status??1;break;}
}
