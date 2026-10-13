/** Additive preparation ONLY. Album/tracks/offers/uploads are created through the authenticated browser. */
import assert from "node:assert/strict";
import { readFile,writeFile,mkdir,mkdtemp,stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { hashPassword } from "@/lib/auth/password";
import { LOCAL_REVIEW_BUYER } from "@/lib/digital/local-review-policy";
import { catalogFfmpegPath } from "@/lib/catalog/ffmpeg";
const cfg=JSON.parse(await readFile(".private/dcn-review-config.json","utf8"));
const target=assertSafeLocalPostgresUrl(cfg.DATABASE_URL);assert.equal(target.hostname,"127.0.0.1");assert.equal(target.port,"55473");assert.equal(target.pathname,"/lnx_dcn_runtime_test");assert.equal(target.username,"dcn_runtime_a");assert.equal(cfg.DCN_MODE,"TEST");assert.equal(cfg.MEDIA_STORAGE_DRIVER,"local");assert.equal(cfg.DCN_NEW_PAYMENTS_ENABLED,"false");
const own=new URL(target);own.username="dcn_owner";
const sql=new Client({connectionString:own.toString()});await sql.connect();
await sql.query('GRANT INSERT ON projects,tracks,project_assets TO dcn_runtime_a');
await sql.query('GRANT UPDATE (title,slug,subtitle,type,status,"publicVisible",featured,"jukeboxPlacement","jukeboxPosition","trackCount","catalogPosition","releaseDate","shortDescription",description,"seoTitle","seoDescription","formerSlugs","legacySourceVersion","updatedAt") ON projects TO dcn_runtime_a');
await sql.query('GRANT UPDATE (title,"durationSeconds",status,position,"updatedAt") ON tracks TO dcn_runtime_a');
await sql.query('GRANT UPDATE ("assetId",position) ON project_assets TO dcn_runtime_a');
const db=new PrismaClient({adapter:new PrismaPg({connectionString:own.toString()})});
const creds=JSON.parse(await readFile(".private/dcn-review-credentials.json","utf8"));
const buyer=await db.user.upsert({where:{email:LOCAL_REVIEW_BUYER},create:{email:LOCAL_REVIEW_BUYER,displayName:"Acquéreur QA DCN‑1.2",status:"ACTIVE",emailVerified:true,emailVerifiedAt:new Date()},update:{}});
await db.account.upsert({where:{providerId_accountId:{providerId:"credential",accountId:buyer.id}},create:{userId:buyer.id,providerId:"credential",accountId:buyer.id,password:await hashPassword(creds.password)},update:{}});
await writeFile(".private/dcn-review-credentials.json",JSON.stringify({...creds,dcn12MemberEmail:LOCAL_REVIEW_BUYER},null,2),{mode:0o600});
let index:{root:string;files:string[];invalid:string;localOnly:boolean;replacement?:string};
try{index=JSON.parse(await readFile(".private/dcn-1-2-assets.json","utf8"));assert.ok(index.root.startsWith("/private/tmp/lnx-dcn12-browser-"));await stat(index.files[0]);}catch{
 const root=await mkdtemp("/private/tmp/lnx-dcn12-browser-");await mkdir(`${root}/invalid`);
 const files:string[]=[];
 for(let i=1;i<=12;i++){const file=`${root}/${String(i).padStart(2,"0")}-Piste-QA-${String(i).padStart(2,"0")}.wav`;
   const run=spawnSync(catalogFfmpegPath(),["-nostdin","-hide_banner","-loglevel","error","-f","lavfi","-i",`sine=frequency=${180+i*17}:sample_rate=${i===1?48000:16000}`,"-t",String(i===12?8:65+i),"-ac",i===1?"2":"1","-c:a","pcm_s16le","-threads","1",file],{timeout:30000,stdio:"pipe"});assert.equal(run.status,0,"Bounded synthetic WAV generation failed");files.push(file);}
 const invalid=`${root}/invalid/12-Piste-QA-12.wav`;await writeFile(invalid,Buffer.alloc(256,23));
 index={root,files,invalid,localOnly:true};await writeFile(".private/dcn-1-2-assets.json",JSON.stringify(index,null,2),{mode:0o600});
}
if(!index.replacement){const file=`${index.root}/01-Piste-QA-01-v2.wav`;const run=spawnSync(catalogFfmpegPath(),["-nostdin","-hide_banner","-loglevel","error","-f","lavfi","-i","sine=frequency=990:sample_rate=48000","-t","67","-ac","2","-c:a","pcm_s16le","-threads","1",file],{timeout:30000,stdio:"pipe"});assert.equal(run.status,0,"Bounded replacement fixture failed");index.replacement=file;await writeFile(".private/dcn-1-2-assets.json",JSON.stringify(index,null,2),{mode:0o600});}
await sql.end();await db.$disconnect();
console.log(JSON.stringify({localOnly:true,browserCreatesCatalogue:true,files:12,syntheticOnly:true,invalidFixture:1,root:index.root,providerCalls:0,existingAcquisitionsPreserved:true}));
