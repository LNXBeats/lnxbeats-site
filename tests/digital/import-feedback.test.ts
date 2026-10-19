import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expressBatchPercent } from "../../lib/digital/express-presentation";

const upload = readFileSync(new URL("../../components/digital-admin.tsx", import.meta.url), "utf8");
const review = readFileSync(new URL("../../components/express-version-review.tsx", import.meta.url), "utf8");

test("a rejected upload never reports a verified file or completed batch", () => {
  assert.equal(expressBatchPercent({ source: { percent: 100 } }, ["source"], { source: "error" }), 95);
  assert.match(upload, /state === "error" \? "Traitement arrêté — voir le motif ci-dessous"/);
  assert.match(upload, /role=\{state === "error" \? "alert" : "status"\}/);
});

test("invalid audio explains the failure without encouraging an identical blind retry", () => {
  assert.match(upload, /result\.errorCode === "INVALID_AUDIO"/);
  assert.match(upload, /Aucun nouveau master n’a été associé/);
  assert.match(upload, /Vérifiez le fichier ou choisissez un autre export complet avant de recommencer/);
  assert.doesNotMatch(upload, /ou réessayez ce fichier/);
  assert.match(upload, /Un MP3 ne devient vendable que si cette version exacte est explicitement autorisée/);
});

test("already-validated copy requires a nonempty selection of ready versions", () => {
  assert.match(review, /selected\.includes\(t\.masterId\) && t\.ready/);
  assert.match(review, /: chosen\.length \? <p>Les extraits sélectionnés sont déjà validés/);
  assert.match(review, /project\.tracks\.some\(t => t\.ready\) \? "Sélectionnez une version techniquement prête/);
  assert.match(review, /Aucun extrait prêt à valider\./);
  assert.match(review, /seuls les formats contrôlés et autorisés de cette version seront proposés/);
});
