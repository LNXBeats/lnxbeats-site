/** Local, explicit allowlist exporter. Never reads profiles, databases, masters or raw logs. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

const cwd = await realpath(process.cwd());
const docs = ["DCN_1_1.md", "DCN_1_1_DECISIONS.md", "DCN_1_1_EXTERNAL_RECIPES.md", "DCN_1_2.md", "DCN_1_2_LIMITS.md", "DCN_1_2_DECISIONS.md", "DCN_1_2_EXTERNAL_AUTHORIZATION.md", "DCN_1_2_LOCAL_START.md"];
const baseSha = "eef4c3c37ddf1392203dfd9900d6b286621d085a";
const safeName = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}$/;
const shaPattern = /^[a-f0-9]{40}$/;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const escape = text => String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const relHref = value => value.split("/").map(encodeURIComponent).join("/");

function textCheck(value, label) {
  // Public identifier/variable names are allowed, credential VALUES and signed URLs are not.
  const secrets = [/(?:sk|rk)_(?:live|test)_[a-zA-Z0-9]{12,}/, /whsec_[a-zA-Z0-9]{12,}/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /(?:Authorization\s*:\s*Bearer|Bearer)\s+[a-zA-Z0-9._-]{20,}/i,
    /postgres(?:ql)?:\/\/[^\s@]+:[^\s@]+@/i, /(?:X-Amz-(?:Signature|Credential|Security-Token)|access_token|client_secret)\s*[=:]\s*["']?[^\s`"']{12,}/i,
    /(?:AUTH_SECRET|PAYPAL_CLIENT_SECRET|DCN_PAYPAL_CLIENT_SECRET|DCN_STRIPE_SECRET_KEY)\s*[=:]\s*["'][^"']{16,}["']/i];
  assert(!secrets.some(pattern => pattern.test(value)), `Sensitive credential pattern refused in ${label}; value not printed.`);
  const emails = value.match(/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
  assert(emails.every(email => email.endsWith("@example.invalid")), `Non-fictitious email refused in ${label}; value not printed.`);
  assert(!/\b(?:FR\d{2}(?:\s?[A-Z0-9]){20,}|\+33\s?[1-9](?:[\s.-]?\d{2}){4})\b/.test(value), `Personal/payment identifier refused in ${label}; value not printed.`);
}
function parseReviewedJson(text, label) {
  try { return JSON.parse(text); }
  catch { throw Error(`Invalid reviewed JSON in ${label}; content not printed.`); }
}
function imageDimensions(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  assert(bytes[0] === 255 && bytes[1] === 216, "Screenshot is not PNG/JPEG.");
  for (let at = 2; at + 9 < bytes.length;) {
    if (bytes[at++] !== 255) continue;
    while (bytes[at] === 255) at++;
    const marker = bytes[at++];
    if (marker === 217 || marker === 218) break;
    if (marker === 1 || marker >= 208 && marker <= 215) continue;
    const length = bytes.readUInt16BE(at);
    assert(length >= 2 && at + length <= bytes.length, "Invalid screenshot marker.");
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) return { height: bytes.readUInt16BE(at + 3), width: bytes.readUInt16BE(at + 5) };
    at += length;
  }
  throw Error("Screenshot dimensions could not be verified.");
}

const args = process.argv.slice(2);
assert(args.length === 2 && args[0] === "--evidence", "Usage: node scripts/digital-1-2-export.mjs --evidence output/dcn-1-2/evidence.json");
const evidencePath = path.resolve(args[1]);
assert(evidencePath.startsWith(`${cwd}/output/`) && path.extname(evidencePath) === ".json", "Evidence must be a reviewed JSON under local output/.");
const evidenceStat = await lstat(evidencePath);
assert(evidenceStat.isFile() && !evidenceStat.isSymbolicLink() && evidenceStat.size > 0 && evidenceStat.size < 1048576 && await realpath(evidencePath) === evidencePath, "Invalid evidence input or symlinked parent.");
const input = parseReviewedJson(await readFile(evidencePath, "utf8"), "evidence input");
assert(input.reviewedForExport === true && input.containsNoCustomerData === true, "Explicit human/agent export review is required.");
const actualSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd }).trim();
const actualTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8", cwd }).trim();
assert.equal(execFileSync("git", ["branch", "--show-current"], { encoding: "utf8", cwd }).trim(), "feature/dcn-1-0", "Exporter may not mislabel another branch.");
assert(input.sha === actualSha && input.tree === actualTree && shaPattern.test(input.testedSha), "Evidence does not identify the current final commit/tree and tested code.");
execFileSync("git", ["merge-base", "--is-ancestor", baseSha, actualSha], { cwd, stdio: "pipe" });
execFileSync("git", ["merge-base", "--is-ancestor", input.testedSha, actualSha], { cwd, stdio: "pipe" });
const afterTestChanges = execFileSync("git", ["diff", "--name-only", input.testedSha, actualSha], { cwd, encoding: "utf8" }).trim().split("\n").filter(Boolean);
assert(afterTestChanges.every(file => file.startsWith("docs/DCN_1_2") || file === "scripts/digital-1-2-export.mjs" || file === ".gitignore"), "Application changes after the stated tested code require updated test evidence.");
assert(Array.isArray(input.screenshots) && input.screenshots.length >= 4 && input.screenshots.length <= 100, "Reviewed before/after screenshots required.");
assert(Array.isArray(input.samples) && input.samples.filter(s => s.kind === "pdf").length === 3, "Exactly three reviewed synthetic PDF samples required.");
assert(Array.isArray(input.tests) && input.tests.length > 0 && input.tests.length < 100, "Filtered test summary required.");
assert(input.tests.every(t => ["PASS", "FAIL", "NOT_RUN", "BLOCKED", "PARTIAL", "REUSED"].includes(t.status) && typeof t.id === "string" && typeof t.environment === "string" && shaPattern.test(t.sha)), "Every test needs status, environment and tested SHA.");

// Root directories are deliberately fixed, not supplied by an input that could approve /.private.
const roots = [path.join(cwd, "output"), "/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/dcn-1-1", "/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/dcn-1-2"];
async function safeBytes(source, limit) {
  assert(typeof source === "string" && path.isAbsolute(source), "Explicit absolute source path required.");
  const resolved = path.resolve(source);
  assert(roots.some(root => resolved.startsWith(`${root}/`)) && !/[\\/](?:\.private|\.git|node_modules|masters)(?:[\\/]|$)/.test(resolved), "Source outside evidence allowlist.");
  const st = await lstat(resolved);
  assert(st.isFile() && !st.isSymbolicLink() && st.size > 0 && st.size <= limit && await realpath(resolved) === resolved, "Regular non-symlink bounded evidence only.");
  return readFile(resolved);
}
const parent = path.join(cwd, "output/dcn-1-2");
await mkdir(parent, { recursive: true });
const destination = await mkdtemp(path.join(parent, "restitution-"));
const pack = path.join(destination, "LNX_DCN_1_2_RESTITUTION");
await mkdir(pack);
const files = [];
async function write(relative, bytes) {
  assert(!relative.includes("..") && !path.isAbsolute(relative) && !files.includes(relative), "Unsafe or duplicate output path.");
  await mkdir(path.dirname(path.join(pack, relative)), { recursive: true });
  await writeFile(path.join(pack, relative), bytes, { flag: "wx" });
  files.push(relative);
}
for (const name of docs) {
  const source = path.join(cwd, "docs", name);
  const docStat = await lstat(source);
  assert(docStat.isFile() && !docStat.isSymbolicLink() && docStat.size < 1024 * 1024 && await realpath(source) === source, "Bounded original report, no symlink, required.");
  const bytes = await readFile(source);
  if (name.startsWith("DCN_1_1")) assert(bytes.equals(execFileSync("git", ["show", `${baseSha}:docs/${name}`], { cwd, maxBuffer: 1024 * 1024 })), "Original DCN-1.1 report changed; do not silently redact or substitute it.");
  textCheck(bytes.toString("utf8"), name);
  await write(`rapports/${name}`, bytes); // Originals remain byte-identical, no silent redaction.
}
const screenshots = [];
for (const item of input.screenshots) {
  textCheck(String(item.name), "screenshot filename");
  assert(safeName.test(item.name) && /\.(?:jpg|jpeg|png)$/.test(item.name) && item.privacyReviewed === true && ["before", "after"].includes(item.phase) && shaPattern.test(item.sha), "Invalid screenshot metadata.");
  assert(typeof item.browser === "string" && typeof item.scenario === "string" && Number.isSafeInteger(item.width) && Number.isSafeInteger(item.height), "Actual screenshot/browser/scenario dimensions required.");
  const bytes = await safeBytes(item.source, 15 * 1024 * 1024);
  assert.deepEqual(imageDimensions(bytes), { width: item.width, height: item.height }, `Image dimensions differ from the claim: ${item.name}`);
  const relative = `captures/${item.phase}/${item.name}`;
  await write(relative, bytes);
  const codeState = typeof item.codeState === "string" ? item.codeState : "Committed application source; generated runtime outputs are not a release mutation.";
  textCheck(codeState, "screenshot code-state note");
  screenshots.push({ file: relative, phase: item.phase, width: item.width, height: item.height, browser: item.browser, scenario: item.scenario, sha: item.sha, codeState });
}
assert(screenshots.some(s => s.phase === "before") && screenshots.some(s => s.phase === "after"), "Before and after evidence both required.");
const samples = [];
for (const item of input.samples) {
  textCheck(String(item.name), "sample filename");
  assert(safeName.test(item.name) && ["pdf", "html", "txt"].includes(item.kind) && item.name.endsWith(`.${item.kind}`) && item.syntheticOnly === true && item.privacyReviewed === true, "Synthetic, privacy-reviewed samples only.");
  const bytes = await safeBytes(item.source, 3 * 1024 * 1024);
  if (item.kind === "pdf") {
    assert(bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) && typeof item.reviewTextSource === "string", "PDF requires decoded-text review evidence.");
    const text = (await safeBytes(item.reviewTextSource, 1024 * 1024)).toString("utf8");
    textCheck(text, item.name);
    assert(/QA|TEST/.test(text), "PDF must visibly identify QA/TEST.");
  } else {
    const text = bytes.toString("utf8"); textCheck(text, item.name);
    assert(/QA|TEST|démonstration|test/i.test(text), "QA notice required in emails.");
    if (item.kind === "html") assert(!/<(?:script|iframe|object|embed|form)\b|\son[a-z]+\s*=|(?:src|srcset)\s*=\s*["']\s*(?:https?:|\/\/|file:)|href\s*=\s*["']\s*javascript:|@import|url\s*\(\s*["']?(?:https?:|\/\/|file:)/i.test(text), "Email example must not execute code or fetch remote resources.");
  }
  const relative = `exemples-qa/${item.name}`;
  await write(relative, bytes);
  samples.push({ file: relative, kind: item.kind, syntheticOnly: true, sourceOriginalPreserved: true });
}
assert(samples.some(s => s.kind === "html") && samples.some(s => s.kind === "txt"), "HTML and text QA email examples required.");
const filteredTests = input.tests.map(t => ({ id: t.id, status: t.status, environment: t.environment, sha: t.sha, ...(typeof t.command === "string" ? { command: t.command } : {}), ...(typeof t.notes === "string" ? { notes: t.notes } : {}), ...(Number.isFinite(t.durationMs) ? { durationMs: t.durationMs } : {}), ...(t.counts && typeof t.counts === "object" ? { counts: Object.fromEntries(Object.entries(t.counts).filter(([k, v]) => /^[a-zA-Z]+$/.test(k) && Number.isSafeInteger(v) && v >= 0)) } : {}) }));
const proofPaths = [];
for (const item of input.proofs ?? []) {
  textCheck(String(item.name), "proof filename");
  assert(safeName.test(item.name) && item.name.endsWith(".json") && item.privacyReviewed === true && item.exportFiltered === true, "Explicitly filtered JSON proof only, never raw logs.");
  const bytes = await safeBytes(item.source, 1024 * 1024);
  textCheck(bytes.toString("utf8"), item.name);
  parseReviewedJson(bytes.toString("utf8"), "filtered proof");
  const relative = `preuves/${item.name}`;
  await write(relative, bytes);
  proofPaths.push(relative);
}
const testsJson = JSON.stringify({ purpose: "Filtered evidence, no duplicate totals or raw logs", tests: filteredTests }, null, 2);
textCheck(testsJson, "tests.json");
await write("preuves/tests.json", `${testsJson}\n`);
const release = { date: "2026-10-13", initialSha: baseSha, sha: actualSha, tree: actualTree, testedSha: input.testedSha,
  branch: "feature/dcn-1-0", localOnly: true, financialEvidence: "LOCAL_DOUBLES_ONLY", physicalSafari: "NOT_RUN", externalProviderRecipes: "NOT_RUN", readyForProduction: false,
  mutations: { push: false, main: false, deployment: false, railway: false, production: false, livePayment: false, liveRefund: false, realClientEmail: false, publicTunnel: false }, screenshots, samples };
const releaseJson = JSON.stringify(release, null, 2); textCheck(releaseJson, "release.json");
await write("preuves/release.json", `${releaseJson}\n`);
const readme = `# LNX STUDIO — DCN-1.2, restitution locale\n\n## Améliorations visibles proposées\n\nFiche album rééquilibrée et pistes regroupées ; accès panier numérique visible ; Ma musique avec albums, pistes, formats réellement connus et documents ; détails techniques QA secondaires, bandeau « Démonstration — aucun paiement réel » conservé. Parcours Admin de douze pistes, association explicite, échec puis reprise ciblée, prix QA et avertissement comparatif : consulter captures et bilan pour les scénarios effectivement observés. Ce visuel reste à valider par Ludovic.\n\n## Limites restant à valider\n\nFinance simulée seulement ; PostgreSQL/FFmpeg/ZIP/HTTP réels lorsque le test l’indique. Pas de recette Stripe TEST, PayPal SANDBOX ou R2 distante ni Safari physique. Autorisation externe NON APPROUVÉE, prix fictifs, licence/futures versions/album partiellement possédé/CGV/fiscalité non approuvés. Les limites opérationnelles exactes sont détaillées séparément. Pas prêt Production.\n\n## Preuves et état Git\n\nVersion ${actualSha}; tree ${actualTree}. Code testé : ${input.testedSha}.\n\nOuvrir index.html hors ligne, puis lire rapports/DCN_1_2.md et les limites/décisions. Les trois rapports 1.1 sont byte-identiques aux originaux. Les captures sont réelles, indexées avec dimensions/navigateur/scénario/SHA. Les PDF et emails QA exportés sont des copies intégralement synthétiques ; aucune valeur comptable/fiscale ni validation juridique. Les sources locales antérieures restent intactes.\n\nAucun push, main, déploiement, Railway/Production, paiement/remboursement LIVE ou email client. Pas de masters, dump, credentials, cookies ou .env.\n\nOrdre : bilan 1.2 → captures avant/après → limites/décisions → preuves tests → exemples QA → demande externe complète → lancement local. Le pack ne contient pas la base ni le code complet et ne démarre pas le site sur une autre machine.\n\nmanifest-sha256.json contient les empreintes de tous les fichiers livrés sauf lui-même ; verification.json décrit les contrôles de construction/listing.\n`;
await write("README.md", readme);
const style = "body{margin:0;background:#080b0d;color:#f6f0df;font:16px/1.6 system-ui}main{max-width:1440px;margin:auto;padding:24px}h1,h2,a{color:#f0ce7a}a{overflow-wrap:anywhere}p,li{overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:20px}figure{margin:0;padding:16px;background:#121719;border:1px solid #b99a58;border-radius:12px}img{display:block;width:100%;height:auto}figcaption{margin-bottom:12px}small{display:block;color:#c9c3b4}code{overflow-wrap:anywhere}";
const styleHash = createHash("sha256").update(style).digest("base64");
const links = list => `<ul>${list.map(f => `<li><a href="${relHref(f)}">${escape(f)}</a></li>`).join("")}</ul>`;
const cards = phase => `<div class="grid">${screenshots.filter(s => s.phase === phase).map(s => `<figure><figcaption>${escape(s.scenario)}<small>${s.width} × ${s.height} — ${escape(s.browser)}<br>SHA : ${escape(s.sha)}<br>${escape(s.codeState)}</small></figcaption><a href="${relHref(s.file)}"><img loading="lazy" src="${relHref(s.file)}" alt="Capture réelle ${escape(s.scenario)}"></a></figure>`).join("")}</div>`;
const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'sha256-${styleHash}'; base-uri 'none'; form-action 'none'"><title>LNX STUDIO — DCN-1.2 — dossier local</title><style>${style}</style></head><body><main><h1>DCN-1.2 — proposition et preuves locales</h1><p><strong>Démonstration — aucun paiement réel.</strong> Prix fictifs, décisions non approuvées. Pas prêt Production. Captures réelles, pas maquettes ; aucune annonce, API prestataire ou ressource distante chargée par cet index.</p><p>Version <code>${actualSha}</code><br>Tree <code>${actualTree}</code><br>Code testé <code>${escape(input.testedSha)}</code></p><h2>Rapports et décisions</h2>${links(["README.md", ...docs.map(n => `rapports/${n}`)])}<h2>Après — DCN-1.2</h2>${cards("after")}<h2>Avant — DCN-1.1</h2>${cards("before")}<h2>Exemples QA entièrement synthétiques</h2><p>Sans valeur comptable/fiscale. Email capturé, pas envoyé/délivré/lu ; document QA, pas preuve de remise juridique LIVE.</p>${links(samples.map(s => s.file))}<h2>Résultats et empreintes</h2>${links(["preuves/tests.json", "preuves/release.json", ...proofPaths, "manifest-sha256.json", "verification.json"])}</main></body></html>`;
await write("index.html", html);
const relativeLinks = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => decodeURIComponent(m[1]));
assert(relativeLinks.every(link => files.includes(link) || ["manifest-sha256.json", "verification.json"].includes(link)), "Every offline link must resolve inside the pack.");
assert(!/<script\b|(?:src|href)="(?:https?:|\/\/|file:|\/)/i.test(html), "Offline index must not fetch remote or absolute resources.");
const verify = { schema: "DCN-1.2-export-v1", allowlistOnly: true, secretPatternScan: "PASS", privacyReviewRequiredAndRecorded: true, actualScreenshotDimensionsVerified: true,
  offlineLinksVerified: true, original11ReportsPreserved: true, decodedPdfReviewPerformedBeforeExport: true, originalsUntouched: true, rawLogsExcluded: true,
  note: "Automated pattern scanning is not a universal PII/secret detector; explicit review of screenshots and decoded synthetic PDFs is mandatory. ZIP test/list verification is performed by the exporter after this file is written." };
await write("verification.json", `${JSON.stringify(verify, null, 2)}\n`);
const manifest = [];
for (const file of [...files].sort()) { const bytes = await readFile(path.join(pack, file)); manifest.push({ file, bytes: bytes.length, sha256: hash(bytes) }); }
await write("manifest-sha256.json", `${JSON.stringify({ algorithm: "SHA-256", excludesSelf: true, entries: manifest }, null, 2)}\n`);
const archive = path.join(destination, "LNX_DCN_1_2_RESTITUTION.zip");
execFileSync("zip", ["-q", "-r", "-X", archive, path.basename(pack)], { cwd: destination, stdio: "pipe" });
execFileSync("unzip", ["-tqq", archive], { stdio: "pipe" });
const zipped = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n").filter(n => !n.endsWith("/")).sort();
assert.deepEqual(zipped, files.map(f => `${path.basename(pack)}/${f}`).sort(), "ZIP inventory must match every announced file exactly.");
const zippedManifest = JSON.parse(execFileSync("unzip", ["-p", archive, `${path.basename(pack)}/manifest-sha256.json`], { encoding: "utf8" }));
for (const entry of zippedManifest.entries) assert.equal(hash(execFileSync("unzip", ["-p", archive, `${path.basename(pack)}/${entry.file}`], { maxBuffer: 20 * 1024 * 1024 })), entry.sha256, "ZIP member SHA-256 mismatch.");
const zipHash = hash(await readFile(archive));
await writeFile(path.join(destination, "LNX_DCN_1_2_RESTITUTION.zip.sha256"), `${zipHash}  LNX_DCN_1_2_RESTITUTION.zip\n`, { flag: "wx" });
// Output paths only: no input credentials, raw metadata or data contents are printed.
console.log(JSON.stringify({ archive, offlineIndex: path.join(pack, "index.html"), files: files.length, screenshots: screenshots.length, zipSha256: zipHash, zipOpenTest: "PASS", exactInventory: "PASS", memberHashes: "PASS" }, null, 2));
