import { processDigitalMedia } from "@/lib/digital/media-worker";
import { prisma } from "@/lib/prisma";
let stopping=false;
for(const signal of ["SIGTERM","SIGINT"] as const) process.once(signal,()=>{stopping=true;});
while(!stopping) { try { const result=await processDigitalMedia(); if(!result.processed) await new Promise(r=>setTimeout(r,1500)); }
  catch { console.error("[digital-media] Local worker cycle failed; no private data logged."); await new Promise(r=>setTimeout(r,3000)); } }
await prisma.$disconnect();
