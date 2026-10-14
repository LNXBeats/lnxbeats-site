/** Reproducible, allowlisted offline review package. No provider or Production access. */
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir,copyFile,readdir,lstat} from "node:fs/promises";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {Client} from "pg";
import {assertSafeLocalPostgresUrl} from "@/lib/database/local-postgres-url";
const root="/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/DCN_CONSOLIDATION_RESTITUTION";
const reports=["DCN_CONSOLIDATION_20261015.md","DCN_CONSOLIDATION_LOCAL_START.md","DCN_CONSOLIDATION_DECISIONS.md","DCN_CONSOLIDATION_FORMATS.md","DCN_CONSOLIDATION_TERRITORIES_AND_LEGAL.md","DCN_1_1.md","DCN_1_1_DECISIONS.md","DCN_1_1_EXTERNAL_RECIPES.md","DCN_1_2_EXTERNAL_AUTHORIZATION.md"];
for(const dir of["reports","proofs","migrations","source-dossier"])await mkdir(`${root}/${dir}`,{recursive:true});
for(const name of reports)await copyFile(`docs/${name}`,`${root}/reports/${name}`);
for(const name of(await readdir("output/dcn-consolidation")).filter(n=>/\.(json|tap)$/.test(n)))await copyFile(`output/dcn-consolidation/${name}`,`${root}/proofs/${name}`);
const migrations=["20261015010000_digital_formats","20261015020000_digital_completion_credit","20261015030000_digital_country_tax_rules"];
for(const m of migrations)await copyFile(`prisma/migrations/${m}/migration.sql`,`${root}/migrations/${m}.sql`);
const source="/Users/lnxbeats/Downloads/LNX_DCN_RECONCILIE_20261014_CODEX.zip",prefix="LNX_DCN_RECONCILIE_20261014/";
const names=execFileSync("unzip",["-Z1",source],{encoding:"utf8"}).trim().split("\n");assert.equal(names.length,14);
for(const name of names){assert.ok(name.startsWith(prefix)&&!name.includes(".."));const target=name.slice(prefix.length);assert.ok(!target.includes("/"));await writeFile(`${root}/source-dossier/${target}`,execFileSync("unzip",["-p",source,name]));}
const config=JSON.parse(await readFile(".private/dcn-consolidation-config.json","utf8"));const url=assertSafeLocalPostgresUrl(config.DATABASE_URL);assert.equal(url.pathname,"/lnx_dcn_consolidation_test");assert.equal(url.port,"55473");
const db=new Client({connectionString:config.DATABASE_URL});await db.connect();
const rows=(await db.query('SELECT "countryCode","subdivisionCode",version,status,decision,"customerType","taxRule","paymentApproved","legalApproved","fiscalApproved" FROM digital_country_tax_rules ORDER BY "countryCode","subdivisionCode",version')).rows;await db.end();assert.equal(rows.length,249);assert.equal(rows.filter(r=>r.decision==="ALLOW").length,0);
const columns=Object.keys(rows[0]),cell=(v:unknown)=>`"${String(v??"").replaceAll('"','""')}"`;await writeFile(`${root}/territories.csv`,[columns.map(cell).join(","),...rows.map(r=>columns.map(c=>cell(r[c])).join(","))].join("\n")+"\n");
const git=(...args:string[])=>execFileSync("git",args,{encoding:"utf8"}).trim();
const revision={branch:git("branch","--show-current"),sha:git("rev-parse","HEAD"),tree:git("rev-parse","HEAD^{tree}"),base:"5ad9fe3073c971c1403197ccfcffe83abc84c760",trackedStatus:git("status","--short","--untracked-files=no"),push:false,merge:false,deployment:false,remoteStateRefreshed:false};assert.equal(revision.branch,"feature/dcn-1-0");await writeFile(`${root}/release-state.json`,JSON.stringify(revision,null,2));
const excluded=new Set(["captures/album-desktop-viewport.jpg","captures/admin-territoires-desktop.jpg","proofs-browser.json"]);
async function files(dir:string,relative=""):Promise<string[]>{const out:string[]=[];for(const entry of await readdir(dir,{withFileTypes:true})){const p=relative?`${relative}/${entry.name}`:entry.name;if(excluded.has(p)||p==="MANIFEST_SHA256.json")continue;assert.ok(!entry.isSymbolicLink());if(entry.isDirectory())out.push(...await files(`${dir}/${entry.name}`,p));else out.push(p);}return out;}
let paths=await files(root);for(const p of paths)assert.ok(!/(?:\.env|\.private|\.dump|\.bin|\.wav|\.mp3|\.zip|database|credentials)/i.test(p),`Forbidden package path ${p}`);
const privateValues=new Set<string>();for(const name of["dcn-consolidation-config.json","dcn-consolidation-owner-config.json","dcn-consolidation-browser-credentials.json"]){const o=JSON.parse(await readFile(`.private/${name}`,"utf8"));for(const[k,v]of Object.entries(o))if(/secret|password|token|database_url/i.test(k)&&typeof v==="string"&&v.length>=10)privateValues.add(v);}
const patterns=[/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\bgh[opsu]_[A-Za-z0-9]{30,}/];
const failures:string[]=[];let scanned=0;
async function scan(label:string,bytes:Buffer){const text=label.endsWith(".pdf")?execFileSync("pdftotext",[`${root}/${label}`,"-"],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}):bytes.toString("utf8");if(/\.(jpg|png)$/.test(label))return;scanned++;if(patterns.some(p=>p.test(text))||[...privateValues].some(v=>text.includes(v)))failures.push(label);}
for(const p of paths)await scan(p,await readFile(`${root}/${p}`));
const repoPaths=[...new Set([...git("diff","--name-only","5ad9fe3").split("\n"),...git("ls-files","--others","--exclude-standard","app","components","lib","prisma","scripts","tests","docs","output/dcn-consolidation").split("\n")])].filter(Boolean);
for(const p of repoPaths){assert.ok((await lstat(p)).isFile());await scan(p,await readFile(p));}
privateValues.clear();assert.deepEqual(failures,[],"Scan found sensitive content: paths only, never values");
const scanProof={result:"PASS",date:new Date().toISOString(),filesScanned:scanned,method:"allowlisted paths + known private credential literals + provider/private-key token patterns",matches:0,secretsPrinted:false,limitation:"Targeted scan, not a guarantee or full historical repository audit"};await writeFile("output/dcn-consolidation/security-scan.json",JSON.stringify(scanProof,null,2));await writeFile(`${root}/proofs/security-scan.json`,JSON.stringify(scanProof,null,2));
paths=await files(root);const manifest=[];for(const p of paths){const b=await readFile(`${root}/${p}`);manifest.push({path:p,bytes:b.length,sha256:createHash("sha256").update(b).digest("hex")});}await writeFile(`${root}/MANIFEST_SHA256.json`,JSON.stringify({files:manifest.sort((a,b)=>a.path.localeCompare(b.path))},null,2));
const zip="/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/LNX_DCN_CONSOLIDATION_RESTITUTION_20261015.zip";
// zip receives an explicit allowlist; it never recursively adds private/audio/database files.
execFileSync("zip",["-q",zip,"MANIFEST_SHA256.json",...paths],{cwd:root,stdio:"pipe"});execFileSync("unzip",["-t",zip],{stdio:"pipe"});
const entries=execFileSync("unzip",["-Z1",zip],{encoding:"utf8"}).trim().split("\n");assert.equal(entries.length,paths.length+1);
for(const f of manifest){const b=execFileSync("unzip",["-p",zip,f.path],{maxBuffer:10*1024*1024});assert.equal(createHash("sha256").update(b).digest("hex"),f.sha256);}
console.log(JSON.stringify({package:zip,files:entries.length,checksum:createHash("sha256").update(await readFile(zip)).digest("hex"),zipIntegrity:"PASS",everyManifestEntryVerified:true,scan:scanProof,revision}));
