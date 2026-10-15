/** Allowlisted local delivery; never exports profiles, audio, databases or acquired private files. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,readdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const artifacts='/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42';
const destination=`${artifacts}/DCN_LAUNCH_PREPARATION_20261015`;
const reportNames=['DCN_LAUNCH_PREPARATION_20261015.md','DCN_LAUNCH_COMPLETION.md','DCN_LAUNCH_AUDIO.md','DCN_REAL_ALBUM_IMPORT.md','DCN_WORLDWIDE_B2C_OPTIONS_20261015.md'];
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const base='21a790fe1668ba9b113c439dbe320c792a1c6b88';assert.equal(git('branch','--show-current'),'feature/dcn-1-0');
assert.equal(git('merge-base',base,'HEAD'),base);
assert.equal(git('diff',base,'--','prisma','package.json','package-lock.json'),'');
const proofRoot='output/dcn-launch';await mkdir(proofRoot,{recursive:true});
try{await readFile(`${proofRoot}/security-scan.json`);}catch{await writeFile(`${proofRoot}/security-scan.json`,'{}');}
const fixture=JSON.parse(await readFile('.private/dcn-consolidation-fixture.json','utf8'));
assert.match(fixture.slug,/^[a-z0-9-]+$/);
const checks=[];
for(const route of process.argv.includes('--package-only')?[]:['/api/health',`/album/${fixture.slug}`,'/connexion','/compte/musique']){
  const response=await fetch(`http://127.0.0.1:3140${route}`,{redirect:'manual',signal:AbortSignal.timeout(20000)});
  await response.arrayBuffer();assert.ok(route==='/compte/musique'?[302,303,307].includes(response.status):response.status===200,`Unexpected local smoke status ${route} ${response.status}`);
  checks.push({route,status:response.status,result:'PASS',authenticated:false});
}
if(checks.length)await writeFile(`${proofRoot}/built-local-smoke.json`,JSON.stringify({environment:'BUILT_LOCAL_LOOPBACK_ONLY',checks,
  note:'Anonymous library must redirect to login; authenticated historical downloads not rerun in this lot.',providerCalls:0},null,2));
else assert.equal(JSON.parse(await readFile(`${proofRoot}/built-local-smoke.json`,'utf8')).checks.length,4);
const privateValues=new Set();
function collect(value,key=''){
  if(value&&typeof value==='object')for(const[k,v]of Object.entries(value))collect(v,k);
  else if(typeof value==='string'&&/password|secret|token|database_url/i.test(key)&&value.length>=10){privateValues.add(value);if(/database_url/i.test(key)){const u=new URL(value);if(u.password)privateValues.add(decodeURIComponent(u.password));}}
}
for(const file of ['dcn-consolidation-config.json','dcn-consolidation-owner-config.json','dcn-consolidation-browser-credentials.json','dcn-review-config.json'])collect(JSON.parse(await readFile(`.private/${file}`,'utf8')));
const patterns=[/\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{16,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\bgh[opsu]_[A-Za-z0-9]{30,}/,/postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/];
const paths=[...new Set([...git('diff','--name-only',base).split('\n'),...git('ls-files','--others','--exclude-standard','app','lib','scripts','tests','docs','output/dcn-launch').split('\n')])].filter(Boolean);
const failed=[];let scanned=0;
for(const file of paths){assert.ok((await lstat(file)).isFile());const bytes=await readFile(file);assert.ok(!/\.(wav|mp3|zip|dump|pdf|png|jpg)$/i.test(file));const text=bytes.toString('utf8');
  if(patterns.some(p=>p.test(text))||[...privateValues].some(v=>text.includes(v)))failed.push(file);scanned++;}
privateValues.clear();assert.deepEqual(failed,[],'Secret scan reports paths only, never values');
await writeFile(`${proofRoot}/security-scan.json`,JSON.stringify({status:'PASS',filesScanned:scanned,matches:0,secretsPrinted:false,
  method:'Changed allowlisted files + known QA credential literals + private-key/provider-token/credentialed-URL patterns',limitation:'Targeted scan, not a full historical security audit'},null,2));
for(const dir of ['reports','proofs'])await mkdir(`${destination}/${dir}`,{recursive:true});
for(const name of reportNames)await copyFile(`docs/${name}`,`${destination}/reports/${name}`);
for(const name of await readdir(proofRoot)){assert.match(name,/^[a-z0-9-]+\.(json|log)$/);await copyFile(`${proofRoot}/${name}`,`${destination}/proofs/${name}`);}
const revision={branch:git('branch','--show-current'),sha:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),base,
  trackedStatus:git('status','--short','--untracked-files=no'),push:false,merge:false,deployment:false,providerRecipeRepeated:false,productionMutation:false};
await writeFile(`${destination}/FINAL_REVISION.json`,JSON.stringify(revision,null,2));
const escape=t=>t.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const links=reportNames.map(n=>`<li><a href="#${n}">${escape(n)}</a> — <a href="reports/${n}">fichier source</a></li>`).join('');
const articles=[];for(const name of reportNames)articles.push(`<article id="${name}"><h2>${escape(name)}</h2><pre>${escape(await readFile(`docs/${name}`,'utf8'))}</pre></article>`);
await writeFile(`${destination}/index.html`,`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>DCN — préparation lancement — 15 octobre 2026</title><style>body{max-width:1000px;margin:32px auto;padding:0 20px;background:#111;color:#eee;font:16px/1.6 system-ui}h1,h2,a{color:#e7c66b}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.65 ui-monospace,monospace}article{margin-top:48px;border-top:1px solid #555}strong{color:#ffd}</style><h1>DCN — préparation finale du lancement</h1><p><strong>LOCAL UNIQUEMENT — pas prêt Production.</strong> Aucun nouveau tarif/territoire/texte LIVE approuvé. 135 tests ciblés et 7 contrôles PostgreSQL ; aucune recette prestataire rejouée. Aucun master, base ou secret dans ce dossier.</p><p>SHA ${revision.sha}<br>Tree ${revision.tree}</p><ul>${links}</ul><p><a href="FINAL_REVISION.json">État Git</a> · <a href="proofs/final-checks.json">Gates finaux</a> · <a href="proofs/completion-complex-runtime.json">PostgreSQL réel</a> · <a href="proofs/targeted-tests.json">Tests ciblés</a></p>${articles.join('')}</html>`);
const names=['index.html','FINAL_REVISION.json',...reportNames.map(n=>`reports/${n}`),...(await readdir(proofRoot)).map(n=>`proofs/${n}`)];
const manifest=[];for(const name of names){assert.ok(!/(?:\.env|\.private|\.dump|\.wav|\.mp3|\.zip|credentials)/i.test(name));const b=await readFile(`${destination}/${name}`);manifest.push({path:name,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});}
await writeFile(`${destination}/MANIFEST_SHA256.json`,JSON.stringify({files:manifest},null,2));
const zip=`${artifacts}/LNX_DCN_LAUNCH_PREPARATION_20261015.zip`;
execFileSync('zip',['-q',zip,'MANIFEST_SHA256.json',...names],{cwd:destination,stdio:'pipe'});execFileSync('unzip',['-t',zip],{stdio:'pipe'});
const entries=execFileSync('unzip',['-Z1',zip],{encoding:'utf8'}).trim().split('\n');assert.equal(entries.length,names.length+1);
for(const f of manifest)assert.equal(createHash('sha256').update(execFileSync('unzip',['-p',zip,f.path],{maxBuffer:10*1024*1024})).digest('hex'),f.sha256);
console.log(JSON.stringify({zip,files:entries.length,sha256:createHash('sha256').update(await readFile(zip)).digest('hex'),zipIntegrity:'PASS',securityScan:'PASS',revision}));
