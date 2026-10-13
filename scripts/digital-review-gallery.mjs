/** Loopback-only visual evidence, never an Internet preview or private-media server. */
import { createServer } from "node:http";
import { readdir, mkdir, copyFile, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const screenshots="/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/dcn-1-1";
const output=path.resolve("output/dcn-1-1");await mkdir(output,{recursive:true});
// Earlier full-page bridge captures are retained on disk, but not offered as final visual evidence.
const names=(await readdir(screenshots)).filter(n=>/^[a-z0-9-]+\.jpg$/.test(n)&&!n.includes("avant-reception")&&!n.includes("-viewport")&&!n.includes("album-possedes")&&!n.includes("-desktop-1440")).sort();
for(const n of names)await copyFile(path.join(screenshots,n),path.join(output,n));
const samples=(await readdir("output/pdf")).filter(n=>/^dcn-qa-[a-z0-9_-]+\.(pdf|html|txt)$/.test(n));
for(const n of samples)await copyFile(path.join("output/pdf",n),path.join(output,n));
const sha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const tree=execFileSync("git",["rev-parse","HEAD^{tree}"],{encoding:"utf8"}).trim();
await writeFile(path.join(output,"release.json"),JSON.stringify({sha,tree,localOnly:true,screenshotBrowser:"Codex in-app",providers:"LOCAL_DOUBLES_ONLY"},null,2));
const html=`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>DCN‑1.1 — captures réelles</title><style>body{margin:0;padding:24px;background:#080b0d;color:#f6f0df;font:16px/1.6 system-ui}a{color:#f0ce7a}h1{margin:0;color:#f0ce7a}main{max-width:1500px;margin:auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:20px}figure{margin:0;padding:16px;background:#121719;border:1px solid #b99a58;border-radius:12px}img{width:100%;height:auto;display:block}figcaption{overflow-wrap:anywhere}code{overflow-wrap:anywhere}ul{padding-left:20px}</style><main><h1>DCN‑1.1 — revue locale réelle</h1><p>Captures de l’application livrée, pas des maquettes. Local TEST, aucun paiement prestataire réel.</p><p>Code : <code>${sha}</code>. Viewports indiqués dans chaque nom ; navigateur Codex intégré.</p><p><a href="http://127.0.0.1:3140/album/dcn-local-test">Album</a> · <a href="http://127.0.0.1:3140/musique/panier">Panier</a> · <a href="http://127.0.0.1:3140/compte/musique">Bibliothèque authentifiée</a> · <a href="http://127.0.0.1:3140/admin/musique">Admin authentifié</a></p><h2>Exemples QA, sans valeur comptable</h2><ul>${samples.map(n=>`<li><a href="/${n}">${n}</a></li>`).join("")}</ul><h2>Interfaces desktop et mobile</h2><div class="grid">${names.map(n=>`<figure><figcaption><a href="/${n}">${n}</a></figcaption><a href="/${n}"><img loading="lazy" src="/${n}" alt="Capture réelle ${n}"></a></figure>`).join("")}</div></main></html>`;
await writeFile(path.join(output,"index.html"),html);
const styleHash=createHash("sha256").update(html.match(/<style>([\s\S]*?)<\/style>/)?.[1]??"").digest("base64");
const allowed=new Set(["index.html","release.json",...names,...samples]);
createServer(async(req,res)=>{try{const u=new URL(req.url??"/","http://127.0.0.1:3141"),name=u.pathname==="/"?"index.html":decodeURIComponent(u.pathname.slice(1));
  if(!["GET","HEAD"].includes(req.method??"")||!allowed.has(name)){res.writeHead(404);res.end();return;}
  const type=name.endsWith(".jpg")?"image/jpeg":name.endsWith(".pdf")?"application/pdf":name.endsWith(".html")?"text/html; charset=utf-8":"text/plain; charset=utf-8";
  const bytes=await readFile(path.join(output,name));res.writeHead(200,{"Content-Type":type,"Content-Length":bytes.length,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff",...(name.endsWith(".html")&&name!=="index.html"?{"Content-Disposition":`attachment; filename="${name}"`}:{}),"Content-Security-Policy":`default-src 'none'; img-src 'self'; style-src 'sha256-${styleHash}'; base-uri 'none'; frame-ancestors 'none'`});res.end(req.method==="HEAD"?undefined:bytes);
}catch{res.writeHead(404);res.end();}}).listen(3141,"127.0.0.1",()=>console.log("Local DCN evidence: http://127.0.0.1:3141 — screenshots and synthetic QA documents only."));
