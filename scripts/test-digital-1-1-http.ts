/** Real loopback HTTP/auth/file-stream test, NOT a browser or provider recipe. Secrets remain memory-only. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
const config=JSON.parse(await readFile(".private/dcn-review-config.json","utf8"));
assert.equal(assertSafeLocalPostgresUrl(config.DATABASE_URL).pathname,"/lnx_dcn_runtime_test");
assert.equal(config.AUTH_URL,"http://127.0.0.1:3140");assert.equal(config.DCN_MODE,"TEST");assert.equal(config.DCN_NEW_PAYMENTS_ENABLED,"false");
const credentials=JSON.parse(await readFile(".private/dcn-review-credentials.json","utf8")),review=JSON.parse(await readFile(".private/dcn-1-1-review-index.json","utf8"));
assert.equal(credentials.dcn11MemberEmail,"dcn11-review-member@example.invalid");
Object.assign(process.env,config);const{prisma}=await import("@/lib/prisma");
const cookies=new Map<string,string>();
async function call(route:string,options:RequestInit={}){
  assert.ok(route.startsWith("/")&&!route.startsWith("//"),"Loopback path only.");
  const response=await fetch(`${config.AUTH_URL}${route}`,{...options,redirect:"manual",headers:{Origin:config.AUTH_URL,Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join("; "),...options.headers},signal:AbortSignal.timeout(120000)});
  for(const cookie of response.headers.getSetCookie()){const first=cookie.split(";",1)[0],i=first.indexOf("=");cookies.set(first.slice(0,i),first.slice(i+1));}
  return response;
}
try{
  const signIn=await call("/api/auth/sign-in/email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:credentials.dcn11MemberEmail,password:credentials.password})});assert.equal(signIn.status,200,"QA sign-in must succeed.");await signIn.body?.cancel();
  const line=await prisma.digitalOrderLine.findFirstOrThrow({where:{orderId:review.orderId,order:{user:{email:credentials.dcn11MemberEmail}}},include:{entitlements:{where:{status:"ACTIVE"},include:{master:{include:{masterAsset:true}}}}}});
  const asset=line.entitlements[0].master.masterAsset;
  const request=await call("/api/digital/library/download",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({lineId:line.id,masterId:line.entitlements[0].masterId})});assert.equal(request.status,200);
  const {url}=await request.json() as {url:string};assert.match(url,/^\/api\/digital\/download\/[a-f0-9-]{36}$/);const ticketId=url.split("/").at(-1)!;
  const head=await call(url,{method:"HEAD"});assert.equal(head.status,200);assert.equal(Number(head.headers.get("content-length")),Number(asset.sizeBytes));assert.equal((await prisma.digitalDownloadTicket.findUniqueOrThrow({where:{id:ticketId}})).usesLeft,32);
  const range=await call(url,{headers:{Range:"bytes=0-99"}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,100);
  const response=await call(url);assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"private, no-store");
  const hash=createHash("sha256"),reader=response.body!.getReader();let bytes=0;
  for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;hash.update(next.value);}reader.releaseLock();
  assert.equal(bytes,Number(asset.sizeBytes));assert.equal(hash.digest("hex"),asset.checksumSha256);
  const terminal=await prisma.digitalEvent.findMany({where:{orderId:review.orderId,kind:{in:["DOWNLOAD_TRANSFER_FINISHED","DOWNLOAD_INTERRUPTED"]},details:{path:["ticketId"],equals:ticketId}}});
  assert.equal(terminal.filter(e=>e.kind==="DOWNLOAD_TRANSFER_FINISHED").length,2,"Range and full response are distinct successful transfers.");assert.equal(terminal.filter(e=>e.kind==="DOWNLOAD_INTERRUPTED").length,0);
  const anonymous=await fetch(`${config.AUTH_URL}${url}`,{redirect:"manual"});assert.equal(anonymous.status,404);await anonymous.body?.cancel();
  console.log(JSON.stringify({environment:"LOCAL_LOOPBACK_ONLY",signIn:200,head:200,range:206,fullFile:200,bytes,checksum:"PASS",anonymous:404,contradictoryTerminalAudit:false,deviceStorage:"NOT_RUN",externalProviderCalls:0}));
}finally{await call("/api/auth/sign-out",{method:"POST"}).then(r=>r.body?.cancel()).catch(()=>undefined);cookies.clear();credentials.password="";await prisma.$disconnect();}
