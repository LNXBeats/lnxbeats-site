/** Allowlisted offline validation bundle. No private documents or audio are collected. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const proof='output/dcn-france-validation-20261015',base='d0e995e612e353230a318ad4214daa9cb3697795';
const artifacts='/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42';
const target=`${artifacts}/DCN_VALIDATION_FRANCE_20261015`,zip=`${artifacts}/LNX_DCN_VALIDATION_FRANCE_20261015.zip`;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
assert.equal(git('branch','--show-current'),'feature/dcn-1-0');assert.equal(git('merge-base',base,'HEAD'),base);
const protectedPaths=['package.json','package-lock.json','data/legal.ts','lib/digital/france-legal.ts','lib/digital/digital-legal.ts','lib/digital/fulfillment-policy.ts','lib/digital/commerce.ts','lib/digital/documents.ts','prisma','lib/billing','lib/payments','lib/support','lib/shop','lib/auth','next.config.ts','app/boutique','app/commander','app/creations'];
assert.equal(git('diff',base,'--',...protectedPaths),'','Protected code, acquired contract versions and migrations unchanged.');
const checks=JSON.parse(await readFile(`${proof}/checks.json`,'utf8'));assert.equal(checks.results.length,5);assert.ok(checks.results.every(r=>r.status==='PASS'));
const entries=[
  ['DOSSIER_VALIDATION_PROFESSIONNELLE_DRAFT.pdf',`${proof}/DOSSIER_VALIDATION_PROFESSIONNELLE_DRAFT.pdf`],
  ['CGV_DCN_FRANCE_DRAFT_02.txt',`${proof}/CGV_DCN_FRANCE_DRAFT_02.txt`],
  ['CONFIDENTIALITE_DCN_DRAFT_01.txt',`${proof}/CONFIDENTIALITE_DCN_DRAFT_01.txt`],
  ['CONSENTEMENTS_ET_CHAINE_DE_PREUVES.json',`${proof}/CONSENTEMENTS_ET_CHAINE_DE_PREUVES.json`],
  ['EXEMPLE_CONFIRMATION_QA.pdf',`${proof}/EXEMPLE_CONFIRMATION_QA.pdf`],
  ['DCN_FRANCE_PROFESSIONAL_VALIDATION_20261015.md','docs/DCN_FRANCE_PROFESSIONAL_VALIDATION_20261015.md'],
  ['DCN_ADMIN_FIRST_ALBUM_VALIDATION_20261015.md','docs/DCN_ADMIN_FIRST_ALBUM_VALIDATION_20261015.md'],
  ['DCN_FRANCE_LAUNCH_VALIDATION_CHECKLIST_20261015.md','docs/DCN_FRANCE_LAUNCH_VALIDATION_CHECKLIST_20261015.md'],
  ['DCN_FRANCE_VALIDATION_REPORT_20261015.md','docs/DCN_FRANCE_VALIDATION_REPORT_20261015.md'],
  ['annexes/DCN_FRANCE_CONTRACT_REVIEW_20261015.md','docs/DCN_FRANCE_CONTRACT_REVIEW_20261015.md'],
  ['annexes/DCN_FRANCE_COMMERCIAL_FISCAL_DOSSIER_20261015.md','docs/DCN_FRANCE_COMMERCIAL_FISCAL_DOSSIER_20261015.md'],
  ['annexes/DCN_WITHDRAWAL_20261015.md','docs/DCN_WITHDRAWAL_20261015.md'],
  ['annexes/DCN_FRANCE_RESIDENCE_V2.md','docs/DCN_FRANCE_RESIDENCE_V2.md'],
  ['annexes/DCN_FRANCE_PRODUCTION_RUNBOOK_20261015.md','docs/DCN_FRANCE_PRODUCTION_RUNBOOK_20261015.md'],
  ...['checks.json','targeted-tests.json','targeted-tests.log','lint.log','typecheck.log','build-web.log','diff-check.log','pdf-review.json','browser-review.json'].map(n=>[`preuves/${n}`,`${proof}/${n}`]),
  ...['admin-single-desktop-1440.jpg','admin-single-mobile-390.jpg','admin-offers-single-mobile-390.jpg','admin-rights-mobile-390.jpg'].map(n=>[`captures/${n}`,`${proof}/images/${n}`]),
];
const cfg=JSON.parse(await readFile('.private/dcn-france-commercial-config.json','utf8'));
const privateValues=Object.entries(cfg).filter(([k,v])=>/secret|token|cookie|database_url/i.test(k)&&typeof v==='string').map(([,v])=>v);
const u=new URL(cfg.DATABASE_URL);if(u.password)privateValues.push(decodeURIComponent(u.password));
const patterns=[/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\bgh[opsu]_[A-Za-z0-9]{30,}/,/postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/];
const changed=[...new Set([...git('diff','--name-only',base).split('\n'),...git('ls-files','--others','--exclude-standard','app','components','lib','tests','scripts','docs').split('\n')])].filter(Boolean);
let scanned=0;for(const file of new Set([...changed,...entries.map(([,s])=>s)])){
  if(!/\.(?:json|log|txt|html|md|ts|tsx|mjs|py)$/.test(file))continue;const raw=await readFile(file,'utf8');
  assert.ok(!patterns.some(p=>p.test(raw))&&!privateValues.some(v=>v.length>=8&&raw.includes(v)),`Secret scan refused file ${file}; no value printed.`);scanned++;
}
await writeFile(`${proof}/security-scan.json`,JSON.stringify({status:'PASS',filesScanned:scanned,matches:0,privateQaValuesCheckedInMemory:true,protectedPathsUnchanged:true,noPrivateEvidenceCollected:true},null,2)+'\n');
if(process.argv[2]==='--scan-only'){console.log(JSON.stringify({securityScan:'PASS',filesScanned:scanned,protectedPathsUnchanged:true}));process.exit(0);}
assert.equal(process.argv.length,2);await assert.rejects(stat(zip),{code:'ENOENT'},'Existing restitution must be preserved.');
await mkdir(target,{recursive:true});for(const[name,source]of entries){assert.ok(!/(?:\.private|\.env|credentials|\.wav|\.mp3|\.dump)/i.test(source));await mkdir(`${target}/${name.includes('/')?name.slice(0,name.lastIndexOf('/')):''}`,{recursive:true});await copyFile(source,`${target}/${name}`);}
await mkdir(`${target}/preuves`,{recursive:true});await copyFile(`${proof}/security-scan.json`,`${target}/preuves/security-scan.json`);
const revision={branch:git('branch','--show-current'),sha:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),base,gitStatus:git('status','--short'),push:false,merge:false,deployment:false,productionMutation:false,ovhMutation:false,externalProviderRecipesRepeated:false};
await writeFile(`${target}/REVISION.json`,JSON.stringify(revision,null,2)+'\n');
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const names=[...entries.map(([n])=>n),'preuves/security-scan.json','REVISION.json'];
const inlineDocs=[];for(const n of['DCN_FRANCE_PROFESSIONAL_VALIDATION_20261015.md','DCN_ADMIN_FIRST_ALBUM_VALIDATION_20261015.md','DCN_FRANCE_LAUNCH_VALIDATION_CHECKLIST_20261015.md','DCN_FRANCE_VALIDATION_REPORT_20261015.md'])inlineDocs.push(`<details><summary>${escape(n)}</summary><pre>${escape(await readFile(`${target}/${n}`,'utf8'))}</pre></details>`);
await writeFile(`${target}/index.html`,`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Validation du commerce musical DCN France</title><style>body{max-width:1040px;margin:32px auto;padding:0 20px;font:16px/1.65 system-ui;background:#fafafa;color:#242424}h1,h2,a{color:#71571d}li{margin:8px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.7 system-ui}details{margin:24px 0;padding:18px;border:1px solid #c8b782}summary{font-weight:600;cursor:pointer}img{max-width:100%;height:auto}</style><h1>Validation du commerce musical DCN France</h1><p>DRAFT - dossier non envoyé, aucune approbation. Vente France métropolitaine et Corse uniquement préparée ; pas prêt Production.</p><p>Commencer par le PDF de validation, puis les trois annexes de conditions/confidentialité/consentements. Joindre les pièces privées uniquement au professionnel concerné par un canal sécurisé. Les captures et preuves QA ne valident ni la fiscalité ni les contrats.</p><ul>${names.map(n=>`<li><a href="${escape(n)}">${escape(n)}</a></li>`).join('')}</ul>${inlineDocs.join('')}<h2>Captures locales des libellés</h2>${names.filter(n=>n.startsWith('captures/')).map(n=>`<figure><img src="${escape(n)}" alt="Capture réelle locale DCN"><figcaption>${escape(n)}</figcaption></figure>`).join('')}<p>Aucun script distant, serveur, secret, master complet ou base n’est nécessaire à cette lecture.</p></html>`);
names.push('index.html');const manifest=[];for(const name of names){const b=await readFile(`${target}/${name}`);manifest.push({path:name,bytes:b.length,sha256:sha(b)});}
await writeFile(`${target}/MANIFEST_SHA256.json`,JSON.stringify({files:manifest},null,2)+'\n');
execFileSync('zip',['-q',zip,'MANIFEST_SHA256.json',...names],{cwd:target,stdio:'pipe'});execFileSync('unzip',['-t',zip],{stdio:'pipe'});
assert.equal(execFileSync('unzip',['-Z1',zip],{encoding:'utf8'}).trim().split('\n').length,names.length+1);
for(const f of manifest)assert.equal(sha(execFileSync('unzip',['-p',zip,f.path],{maxBuffer:12*1024*1024})),f.sha256);
console.log(JSON.stringify({zip,files:names.length+1,sha256:sha(await readFile(zip)),integrity:'PASS',securityScan:'PASS',revision}));
