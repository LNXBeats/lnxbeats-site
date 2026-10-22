import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

registerHooks({ load(url, context, next) {
  if (url.endsWith(".css")) return { format: "module", source: "export default new Proxy({}, { get: (_target, key) => String(key) });", shortCircuit: true };
  return next(url, context);
} });
const { DigitalAudioDropzone } = await import("../../components/digital-audio-dropzone");
const mustNotStart = () => { throw Error("Rendering cannot select or send a file"); };
test("The audio dropzone visibly offers local WAV/MP3 selection before any upload action", () => {
  const html = renderToStaticMarkup(<DigitalAudioDropzone onFiles={mustNotStart} />);
  assert.match(html, /Glissez vos fichiers WAV ou MP3 ici/); assert.match(html, /ou choisir des fichiers/);
  assert.match(html, /type="file"/); assert.match(html, /multiple=""/);
  assert.match(html, /accept="\.wav,\.mp3,audio\/wav,audio\/x-wav,audio\/mpeg"/);
  assert.match(html, /La sélection reste sur cet appareil\. Aucun envoi à ce stade\./);
  const inputId = html.match(/<input id="([^"]+)"/)?.[1];
  assert.ok(inputId); assert.ok(html.includes(`for="${inputId}"`)); assert.ok(html.includes(`aria-describedby="${inputId}-help"`));
  assert.doesNotMatch(html, /<form|action=|<button/);
});
test("Compact or disabled dropzones retain their real accessible file control and explicit local-selection warning", () => {
  const html = renderToStaticMarkup(<DigitalAudioDropzone onFiles={mustNotStart} disabled compact heading="Audio à préparer" description="Vos fichiers restent locaux avant confirmation." />);
  assert.match(html, /Audio à préparer/); assert.match(html, /Vos fichiers restent locaux avant confirmation\./);
  assert.match(html, /data-disabled="true"/); assert.match(html, /<input[^>]+disabled=""/);
  assert.match(html, /class="root compact /);
});
test("Minimal per-title selection shows one compact action without instructions and retains its accessible native input", () => {
  for (const disabled of [false, true]) {
    const html = renderToStaticMarkup(<DigitalAudioDropzone onFiles={mustNotStart} minimal compact multiple={false} disabled={disabled} heading="Audio du titre 03" description="Explication à masquer" />);
    assert.match(html, />Choisir un fichier<\/span>/);
    assert.match(html, /aria-label="Choisir un fichier — Audio du titre 03"/);
    assert.match(html, /type="file"/); assert.match(html, /accept="\.wav,\.mp3,audio\/wav,audio\/x-wav,audio\/mpeg"/);
    assert.doesNotMatch(html, /multiple=|<h3|<strong|<p|Glissez|Explication à masquer|↑|aria-labelledby=|aria-describedby=/);
    assert.equal(/<input[^>]+disabled=""/.test(html), disabled);
    const inputId = html.match(/<input id="([^"]+)"/)?.[1];
    assert.ok(inputId); assert.ok(html.includes(`for="${inputId}"`));
  }
});
