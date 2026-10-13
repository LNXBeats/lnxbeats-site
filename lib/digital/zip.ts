import { Readable } from "node:stream";
export type ZipInput = { name: string; size: number; open(): Promise<ReadableStream<Uint8Array>> };
const table=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crcUpdate(crc:number,b:Uint8Array){for(const v of b)crc=table[(crc^v)&255]^(crc>>>8);return crc>>>0;}
function nameBytes(raw:string){const n=raw.replace(/[\x00-\x1f\\/]/g,"-").replace(/^\.+/,"-").slice(0,180);if(!n)throw Error("Invalid archive name");return Buffer.from(n,"utf8");}
export function validateDigitalZip(entries:ZipInput[]){
  if(!entries.length||entries.length>100)throw Error("Invalid archive size");
  const names=new Set<string>();let size=22;
  for(const e of entries){if(!Number.isSafeInteger(e.size)||e.size<1||e.size>0xffffffff)throw Error("Invalid ZIP entry size");
    const name=nameBytes(e.name);if(names.has(name.toString()))throw Error("Duplicate ZIP name");names.add(name.toString());size+=e.size+30+16+46+2*name.length;}
  if(size>0xffffffff)throw Error("ZIP64 required; download tracks individually");
}
/** ZIP STORE + data descriptors: bounded streaming, no full master/album buffer. */
export async function* digitalZip(entries:ZipInput[]){
  validateDigitalZip(entries);
  let offset=0;const central:Buffer[]=[];const names=new Set<string>();
  for(const e of entries){if(!Number.isSafeInteger(e.size)||e.size<1||e.size>0xffffffff)throw Error("Invalid ZIP entry size");
    const name=nameBytes(e.name);if(names.has(name.toString()))throw Error("Duplicate ZIP name");names.add(name.toString());
    const start=offset, h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x0808,6);h.writeUInt16LE(name.length,26);
    yield h;yield name;offset+=h.length+name.length;
    let size=0,crc=0xffffffff;const reader=(await e.open()).getReader();
    try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>e.size)throw Error("Archive entry changed");crc=crcUpdate(crc,value);offset+=value.byteLength;yield value;}}
    finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
    if(size!==e.size)throw Error("Archive entry incomplete");crc=(crc^0xffffffff)>>>0;
    const d=Buffer.alloc(16);d.writeUInt32LE(0x08074b50);d.writeUInt32LE(crc,4);d.writeUInt32LE(size,8);d.writeUInt32LE(size,12);yield d;offset+=16;
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x0808,8);c.writeUInt32LE(crc,16);c.writeUInt32LE(size,20);c.writeUInt32LE(size,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(start,42);central.push(Buffer.concat([c,name]));
    if(offset>0xffffffff)throw Error("ZIP64 required; archive exceeds local limit");
  }
  const start=offset;for(const c of central){yield c;offset+=c.length;}const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(offset-start,12);end.writeUInt32LE(start,16);yield end;
}
export function digitalZipStream(entries:ZipInput[]){validateDigitalZip(entries);return Readable.toWeb(Readable.from(digitalZip(entries))) as ReadableStream<Uint8Array>;}
