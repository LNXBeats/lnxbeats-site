/** Explicit allowlist: no credentials, database, private legal proof or audio master. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,readdir,lstat,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const artifacts='/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42';
const destination=`${artifacts}/DCN_FRANCE_COMMERCIAL_20261015`,proof='output/dcn-france-commercial',base='40f191127e578c74a4724b623a41cbef5b911002';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim(),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(git('branch','--show-current'),'feature/dcn-1-0');assert.equal(git('merge-base',base,'HEAD'),base);
assert.equal(git('diff',base,'--','package.json','package-lock.json','data/legal.ts','lib/billing','lib/payments','lib/support','lib/shop','next.config.ts'),'','Protected domains and dependencies unchanged.');
const reports=['DCN_FRANCE_COMMERCIAL_FINALIZATION_20261015.md','DCN_FRANCE_COMMERCIAL_FISCAL_DOSSIER_20261015.md','DCN_FRANCE_CONTRACT_REVIEW_20261015.md','DCN_ADMIN_PREPARATION_DRAFT_20261015.md','DCN_FRANCE_PRODUCTION_RUNBOOK_20261015.md','DCN_FIRST_REAL_ALBUM_LAUNCH.md','DCN_REAL_ALBUM_IMPORT.md','DCN_FRANCE_FISCAL_REVIEW_20261015.md','DCN_WITHDRAWAL_20261015.md','DCN_FRANCE_RESIDENCE_V2.md'];
const final=JSON.parse(await readFile(`${proof}/final-checks.json`,'utf8'));assert.equal(final.results.length,7);assert.ok(final.results.every(r=>r.status==='PASS'));
const scanFiles=[...new Set([...git('diff','--name-only',base).split('\n'),...git('ls-files','--others','--exclude-standard','app','components','lib','tests','scripts','docs','prisma').split('\n')])].filter(Boolean);
const privateValues=new Set();
function values(o,key=''){if(o&&typeof o==='object')for(const[k,v]of Object.entries(o))values(v,k);else if(typeof o==='string'&&/password|secret|token|cookie|database_url/i.test(key)&&o.length>=10){if(/database_url/i.test(key)){const u=new URL(o);if(u.password){privateValues.add(o);privateValues.add(decodeURIComponent(u.password));}}else privateValues.add(o);}}
for(const name of await readdir('.private'))if(/^dcn-.*(?:config|credentials|review).*\.json$/.test(name)){try{values(JSON.parse(await readFile(`.private/${name}`,'utf8')));}catch(error){if(error?.code!=='EISDIR')throw error;}}
const patterns=[/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\bgh[opsu]_[A-Za-z0-9]{30,}/,/postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/];
let scanned=0;const failed=[];
for(const file of scanFiles){if(!(await lstat(file)).isFile())continue;const raw=await readFile(file,'utf8');let normalized=raw;
  if(file.startsWith('tests/'))normalized=normalized.replace(/postgresql:\/\/dcn_runtime_a:(?:fixture_never_connect_20261015|fake-qa-not-a-secret|synthetic_never_connect)@127\.0\.0\.1:55473\/lnx_dcn_consolidation_test/g,'[NEVER_CONNECT_UNIT_DSN]');
  const patternIndexes=patterns.flatMap((p,i)=>p.test(normalized)?[i]:[]),knownValueMatch=[...privateValues].some(v=>raw.includes(v));
  if(patternIndexes.length||knownValueMatch)failed.push({file,patternIndexes,knownValueMatch});scanned++;
}
assert.deepEqual(failed,[],'Secret scan failed: names only, no values.');
const files=[];
const selected=JSON.parse(await readFile(`${proof}/package-inputs.json`,'utf8'));
const deliveredText=[...reports.map(name=>`docs/${name}`)];
for(const entry of selected){assert.ok(['proofs','images','examples'].includes(entry.category));assert.match(entry.name,/^[A-Za-z0-9_.-]+\.(?:json|log|png|jpg|pdf|txt|html|sql)$/);assert.ok(entry.source.startsWith(`${proof}/`)||entry.source.startsWith(`${artifacts}/DCN_FRANCE_COMMERCIAL_`));
  assert.ok(!/(?:\.env|\.private|\.dump|\.wav|\.mp3|credentials|source\.dump)/i.test(entry.source));const target=`${entry.category}/${entry.name}`;assert.ok(!files.includes(target));files.push(target);deliveredText.push(entry.source);
}
// Scan all delivered text as well, not only source changes. Never print matching values.
for(const file of deliveredText){if(!/\.(?:json|log|txt|html|md|sql)$/.test(file))continue;const raw=await readFile(file,'utf8');if(patterns.some(p=>p.test(raw))||[...privateValues].some(v=>raw.includes(v)))failed.push(file);scanned++;}
privateValues.clear();assert.deepEqual(failed,[],'Restitution secret scan failed: names only, no values.');
await writeFile(`${proof}/security-scan.json`,JSON.stringify({status:'PASS',filesScanned:scanned,matches:0,knownPrivateValuesCheckedInMemory:true,secretsPrinted:false,deliveredTextScanned:true,exception:'Only three named never-connect unit-fixture DSNs in source tests; actual private values have no exemption. Credential-free local URLs are not secrets.',protectedDomainsUnchanged:true},null,2));
if(process.argv[2]==='--scan-only'){console.log(JSON.stringify({securityScan:'PASS',filesScanned:scanned,protectedDomainsUnchanged:true}));process.exit(0);}
assert.equal(process.argv.length,2);
for(const dir of['reports','proofs','images','examples'])await mkdir(`${destination}/${dir}`,{recursive:true});
for(const name of reports){await copyFile(`docs/${name}`,`${destination}/reports/${name}`);files.push(`reports/${name}`);}
for(const entry of selected)await copyFile(entry.source,`${destination}/${entry.category}/${entry.name}`);
await copyFile(`${proof}/security-scan.json`,`${destination}/proofs/security-scan.json`);files.push('proofs/security-scan.json');
const revision={branch:git('branch','--show-current'),sha:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),base,gitStatus:git('status','--short'),push:false,merge:false,deployment:false,providerRecipesRepeated:false,productionMutation:false,ovhMutation:false};
await writeFile(`${destination}/FINAL_REVISION.json`,JSON.stringify(revision,null,2));files.push('FINAL_REVISION.json');
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const bodies=[];for(const name of reports)bodies.push(`<section><h2>${escape(name)}</h2><pre>${escape(await readFile(`docs/${name}`,'utf8'))}</pre></section>`);
const images=files.filter(f=>f.startsWith('images/')).map(f=>`<figure><img src="${escape(f)}" alt="Capture réelle locale DCN"><figcaption>${escape(f)}</figcaption></figure>`).join('');
await writeFile(`${destination}/index.html`,`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DCN France préparation commerciale locale</title><style>body{max-width:1120px;margin:32px auto;padding:0 20px;background:#101112;color:#eee;font:16px/1.65 system-ui}h1,h2,a{color:#e8c763}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.65 system-ui}section,figure{margin:36px 0;border-top:1px solid #555;padding-top:20px}img{max-width:100%;height:auto}li{margin:8px 0}</style><h1>DCN France préparation commerciale locale</h1><p>DRAFT · TEST local uniquement · pas prêt Production. Aucun master, base, secret ou justificatif de droits privé.</p><p>SHA ${revision.sha}<br>Tree ${revision.tree}</p><ul>${files.filter(f=>!f.startsWith('images/')).map(f=>`<li><a href="${escape(f)}">${escape(f)}</a></li>`).join('')}</ul>${images}${bodies.join('')}</html>`);files.push('index.html');
const manifest=[];for(const file of files){const bytes=await readFile(`${destination}/${file}`);manifest.push({path:file,bytes:bytes.length,sha256:sha(bytes)});}
await writeFile(`${destination}/MANIFEST_SHA256.json`,JSON.stringify({files:manifest},null,2));
const zip=`${artifacts}/LNX_DCN_FRANCE_COMMERCIAL_20261015.zip`;try{await stat(zip);throw Error('Preserve an existing restitution ZIP.');}catch(error){if(error?.code!=='ENOENT')throw error;}
execFileSync('zip',['-q',zip,'MANIFEST_SHA256.json',...files],{cwd:destination,stdio:'pipe'});execFileSync('unzip',['-t',zip],{stdio:'pipe'});
const entries=execFileSync('unzip',['-Z1',zip],{encoding:'utf8'}).trim().split('\n');assert.equal(entries.length,files.length+1);
for(const f of manifest)assert.equal(sha(execFileSync('unzip',['-p',zip,f.path],{maxBuffer:12*1024*1024})),f.sha256);
console.log(JSON.stringify({zip,files:entries.length,sha256:sha(await readFile(zip)),zipIntegrity:'PASS',securityScan:'PASS',revision}));
