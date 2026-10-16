/** Bounded isolated media/ZIP process; no payment or refund client is imported. */
import { processDigitalMedia } from "@/lib/digital/media-worker";
import { processDigitalArchives } from "@/lib/digital/archive-worker";
import { prisma } from "@/lib/prisma";
import assert from "node:assert/strict";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
const initialMemory=process.memoryUsage();let peak = initialMemory.rss, external = initialMemory.external, arrayBuffers = initialMemory.arrayBuffers;
const timer = setInterval(() => { const m = process.memoryUsage(); peak = Math.max(peak, m.rss); external = Math.max(external, m.external); arrayBuffers = Math.max(arrayBuffers, m.arrayBuffers); }, 25);
const shutdown=new AbortController();for(const signal of ["SIGTERM","SIGINT"] as const)process.once(signal,()=>shutdown.abort());
try { const kind=process.argv[2];assert.ok(["audio","zip","audio-crash","zip-crash"].includes(kind),"A bounded media job kind is required.");const crash=kind==="audio-crash"||kind==="zip-crash";if(crash)assert.match(assertSafeLocalPostgresUrl(process.env.DATABASE_URL??"").pathname,/^\/lnx_dcn11_/);
  const result = kind.startsWith("zip") ? await processDigitalArchives({signal:shutdown.signal,...(kind==="zip-crash"?{afterChunk:async()=>{process.exit(86);}}:{})}) : await processDigitalMedia({signal:shutdown.signal,...(crash?{afterSource:async()=>{process.exit(86);}}:{})}); console.log(JSON.stringify({ ...result, nodeRssPeak: peak, externalPeak: external, arrayBuffersPeak: arrayBuffers })); }
finally { clearInterval(timer); await prisma.$disconnect(); }
