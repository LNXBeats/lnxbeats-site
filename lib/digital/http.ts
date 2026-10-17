import "server-only";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { isAllowedOrderMutation, orderActorFromHeaders, readOrderJson } from "@/lib/orders/request";
import type { OrderActor } from "@/lib/orders/domain";
import { prisma } from "@/lib/prisma";
import { DigitalError, requireDigitalEnvironment } from "./domain";
import {digitalErrorMessage} from "./error-presentation";
export const digitalJson=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"private, no-store","X-Robots-Tag":"noindex","X-Content-Type-Options":"nosniff"}});
export function digitalHttpError(e:unknown){const code=e instanceof DigitalError?e.code:"DIGITAL_UNAVAILABLE";const status=e instanceof DigitalError?e.status:503;
  return digitalJson({code,error:digitalErrorMessage(code,e instanceof DigitalError?e.publicDetails?.ownedTitles:[])},status);}
export async function digitalActor(request:Request,admin=false){requireDigitalEnvironment();if(!["GET","HEAD"].includes(request.method)&&!isAllowedOrderMutation(request))throw new DigitalError("ORIGIN_REFUSED",403);
  const actor=await orderActorFromHeaders(request.headers);if(!actor)throw new DigitalError("AUTH_REQUIRED",401);if(admin&&actor.role!=="ADMIN")throw new DigitalError("ADMIN_REQUIRED",403);return actor;}
export async function digitalRateLimit(identity:string,family:string,max=30){
  const key=`dcn:${family}:${createHash("sha256").update(identity).digest("hex")}`;
  const allowed=await prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key})) IS NULL AS locked`;
    const now=BigInt(Date.now()),old=await tx.rateLimit.findUnique({where:{key}});
    if(!old||now-old.lastRequest>=60000n){await tx.rateLimit.upsert({where:{key},create:{key,count:1,lastRequest:now},update:{count:1,lastRequest:now}});return true;}
    if(old.count>=max)return false;await tx.rateLimit.update({where:{key},data:{count:{increment:1}}});return true;});
  if(!allowed)throw new DigitalError("RATE_LIMITED",429);
}
export async function digitalBody(request:Request,keys:string[],maximumBytes=16384){let v;try{v=await readOrderJson(request,maximumBytes);}catch{throw new DigitalError("INVALID_BODY");}
  if(!v||typeof v!=="object"||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))throw new DigitalError("INVALID_BODY");return v as Record<string,unknown>;}
export async function withDigitalApi(request:Request,handler:(actor:OrderActor)=>Promise<Response>,admin=false){try{const actor=await digitalActor(request,admin);await digitalRateLimit(actor.id,"mutation");return await handler(actor);}catch(e){return digitalHttpError(e);}}
