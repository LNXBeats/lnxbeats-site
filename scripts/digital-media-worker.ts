import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "@/lib/prisma";
import { processDigitalDocuments } from "@/lib/digital/documents";
import { processDigitalNotifications } from "@/lib/digital/notifications";
let stopping=false;
const exec=promisify(execFile);
async function child(kind:string){await exec(process.execPath,["--conditions=react-server","--import","tsx","scripts/digital-worker-once.ts",kind],{env:process.env,timeout:20*60000,maxBuffer:4096});}
for(const signal of ["SIGTERM","SIGINT"] as const) process.once(signal,()=>{stopping=true;});
while(!stopping) { try {
  const now=new Date(),pending=await prisma.digitalUpload.count({where:{OR:[{status:"QUARANTINE",OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]},{status:{in:["VALIDATING","COMPLETING"]},leaseUntil:{lte:now}}]}});
  if(pending)await child("audio");
  if(await prisma.digitalArchive.count({where:{OR:[{status:"PENDING"},{status:"PROCESSING",leaseUntil:{lte:now}}]}}))await child("zip");
  await processDigitalDocuments(2);await processDigitalNotifications(2); await new Promise(r=>setTimeout(r,1500)); }
  catch { console.error("[digital-media] Local worker cycle failed; no private data logged."); await new Promise(r=>setTimeout(r,3000)); } }
await prisma.$disconnect();
