import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { memberMessages } from "../../lib/i18n/messages-members";

// Actual React rendering and response parsing; not an authenticated browser vote.
registerHooks({ load(url, context, next) {
  if (url.endsWith(".css")) return { format: "module", source: "export default new Proxy({}, { get: (_target, key) => String(key) });", shortCircuit: true };
  return next(url, context);
} });
const { PremiereVote, PremiereVoteView, readPremiereVoteSnapshot } = await import("../../components/premiere-vote");
const noMutation = () => { throw Error("Static rendering must never submit a vote"); };
const view = (choice: "UP" | "DOWN" | null, loaded = true, pending = false) => renderToStaticMarkup(<PremiereVoteView snapshot={{ choice, up: 12, down: 3 }} loaded={loaded} pending={pending} error={null} onChoice={noMutation} onRetry={noMutation} />);

test("A member vote never exists optimistically: the server must return a valid choice and nonnegative integer totals", () => {
  for (const choice of [null, "UP", "DOWN"] as const) assert.deepEqual(readPremiereVoteSnapshot({ ok: true, choice, up: 12, down: 3, ignoredPersonalData: "must not be retained" }), { choice, up: 12, down: 3 });
  for (const bad of [null, {}, { ok: false, choice: "UP", up: 0, down: 0 }, { ok: true, choice: "OTHER", up: 0, down: 0 }, { ok: true, choice: undefined, up: 0, down: 0 },
    { ok: true, choice: null, up: -1, down: 0 }, { ok: true, choice: null, up: 0.5, down: 0 }, { ok: true, choice: null, up: 0, down: "1" }, { ok: true, choice: null, up: Infinity, down: 0 }]) assert.throws(() => readPremiereVoteSnapshot(bad));
});
test("Initial real component rendering is read-only, disabled until its server response and does not expose totals", () => {
  const html = renderToStaticMarkup(<PremiereVote projectId="synthetic-project-only" binding={"a".repeat(64)} />);
  assert.match(html, /Souhaitez-vous une sortie sur les plateformes/); assert.match(html, /<fieldset[^>]*disabled=""/);
  assert.match(html, /Chargement de votre avis/); assert.doesNotMatch(html, /Votre avis est enregistré|Retirer mon avis|Plutôt oui :/);
  assert.match(html, /ne déclenche ni achat ni publication/);
});
test("Choices are keyboard buttons with explicit pressed states; aggregate results appear only after a server-confirmed vote", () => {
  const empty = view(null); assert.match(empty, /<button[^>]*type="button"[^>]*aria-pressed="false"/); assert.doesNotMatch(empty, /Plutôt oui :|Retirer mon avis/);
  for (const choice of ["UP", "DOWN"] as const) {
    const html = view(choice); assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
    assert.match(html, /Votre avis est enregistré/); assert.match(html, /Plutôt oui :/); assert.match(html, />12</); assert.match(html, />3</);
    assert.match(html, /Retirer mon avis/); assert.doesNotMatch(html, /email|@|synthetic-project/);
  }
  assert.doesNotMatch(view("UP", false), /Votre avis est enregistré|Retirer mon avis|Plutôt oui :/);
});
test("Busy and error states are accessible and never claim an unconfirmed new vote", () => {
  const busy = view("UP", true, true); assert.match(busy, /aria-busy="true"/); assert.match(busy, /<fieldset[^>]*disabled=""/); assert.match(busy, /Enregistrement de votre avis/);
  const error = renderToStaticMarkup(<PremiereVoteView snapshot={{ choice: null, up: 12, down: 3 }} loaded={false} pending={false} error="session" onChoice={noMutation} onRetry={noMutation} />);
  assert.match(error, /role="alert"/); assert.match(error, /compte membre vérifié/); assert.match(error, /Réessayer de charger mon avis/); assert.doesNotMatch(error, /Votre avis est enregistré|Plutôt oui :/);
});
test("The client only sends explicit choices through the same-origin API, protects double-clicks and does not submit on mount", async () => {
  const source = await readFile(new URL("../../components/premiere-vote.tsx", import.meta.url), "utf8");
  const effect = source.slice(source.indexOf("useEffect(() =>"), source.indexOf("async function vote("));
  assert.match(effect, /cache: "no-store", credentials: "same-origin"/); assert.doesNotMatch(effect, /method: "PATCH"|JSON\.stringify|void vote\(/);
  assert.match(source, /if \(inFlight\.current \|\| loadedFor !== versionKey \|\| error === "changed" \|\| choice === snapshot\.choice\) return/);
  assert.match(source, /method: "PATCH", credentials: "same-origin"/); assert.match(source, /body: JSON\.stringify\(\{ projectId, binding, choice \}\)/);
  assert.match(source, /version=\$\{encodeURIComponent\(binding\)\}/);
  assert.match(source, /readPremiereVoteSnapshot\(await response\.json\(\)\)/);
  assert.doesNotMatch(source, /humanListened|rightsDeclaration|confirmReplacement|localStorage|active: true|published: true/);
});
test("A changed version disables voting, hides obsolete totals and requires explicit page reload rather than automatically moving a vote", () => {
  const html = renderToStaticMarkup(<PremiereVoteView snapshot={{ choice: "UP", up: 12, down: 3 }} loaded={true} pending={false} error="changed" onChoice={noMutation} onRetry={noMutation} />);
  assert.match(html, /<fieldset[^>]*disabled=""/); assert.match(html, /Cette avant-première a changé/); assert.match(html, /Recharger cette avant-première/);
  assert.doesNotMatch(html, /Votre avis est enregistré|Retirer mon avis|Plutôt oui :/);
});
test("All newly displayed vote labels have five translations and preserve aggregate placeholders", async () => {
  const source = await readFile(new URL("../../components/premiere-vote.tsx", import.meta.url), "utf8");
  const labels = [...source.matchAll(/<T text="([^"]+)"/g)].map(match => match[1]);
  for (const label of labels) { assert.equal(memberMessages[label]?.length, 5, label); for (const text of memberMessages[label]) assert.ok(text.trim(), label); }
  for (const text of memberMessages["Plutôt oui : {up} · Pas encore : {down}"]) { assert.match(text, /\{up\}/); assert.match(text, /\{down\}/); }
});
