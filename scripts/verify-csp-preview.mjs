// Read-only checks against a local/isolated Preview. Never contacts Production.
import assert from "node:assert/strict";
const origin = new URL(process.argv[2] ?? "http://127.0.0.1:3131");
assert.ok(["localhost", "127.0.0.1"].includes(origin.hostname) || (origin.hostname.includes("preview") && origin.hostname.endsWith(".up.railway.app")));
assert.equal(origin.username + origin.password, "");
const album = process.argv[3] ?? "qa-histoire-a-ecouter";
assert.match(album, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const seen = new Set();
for (const path of ["/", "/", "/boutique", `/album/${album}`, "/soutenir", "/commander", "/compte", "/admin", "/boutique/panier"]) {
  const response = await fetch(new URL(path, origin), { headers: { "x-lnx-csp-nonce": "untrusted-probe", "content-security-policy": "script-src *" } });
  const html = await response.text();
  // The existing Preview commerce kill switch legitimately returns 404 here.
  // It is not changed for a CSP test; the exclusion must still be verified.
  assert.ok(response.status === 200 || (path === "/boutique/panier" && response.status === 404), `${path}: unexpected HTTP ${response.status}`);
  const csp = response.headers.get("content-security-policy") ?? "";
  const nonce = csp.match(/'nonce-([A-Za-z0-9+/]{43}=)'/)?.[1];
  const eligible = path === "/" || path === "/boutique" || path.startsWith("/album/");
  assert.equal(Boolean(nonce), eligible, path);
  assert.ok(!csp.includes("untrusted-probe"));
  assert.doesNotMatch(html, /<script[^>]+src=["'][^"']*(?:googlesyndication|fundingchoices|doubleclick)/i);
  let executableScripts = 0;
  if (nonce) {
    assert.ok(!seen.has(nonce)); seen.add(nonce);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.doesNotMatch(csp.split(";").find(d => d.includes("script-src")), /unsafe-inline|unsafe-eval|\*/);
    for (const match of html.matchAll(/<script\b([^>]*)>/g)) {
      if (match[1].includes('type="application/ld+json"')) continue;
      assert.ok(match[1].includes(`nonce="${nonce}"`), `${path}: executable script missing matching nonce`);
      executableScripts++;
    }
    assert.ok(executableScripts > 0);
  }
  for (const required of ["object-src 'none'", "frame-ancestors 'none'", "form-action 'self'"]) assert.ok(csp.includes(required));
  console.log(JSON.stringify({ path, status: response.status, nonce: nonce ? "UNIQUE_MATCHING" : "EXCLUDED", executableScripts, googleScripts: 0 }));
}
const ads = await fetch(new URL("/ads.txt", origin));
assert.equal(ads.status, 200);
assert.equal(await ads.text(), "google.com, pub-2056594730161751, DIRECT, f08c47fec0942fa0\n");
console.log("ADS_TXT_EXACT=PASS");
