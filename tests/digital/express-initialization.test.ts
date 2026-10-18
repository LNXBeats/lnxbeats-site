import test from "node:test";
import assert from "node:assert/strict";
import { expressEditorLocked } from "../../lib/digital/express-presentation";

test("R3: server form and pre-recovery editor cannot accept input that cached state would overwrite", () => {
  for (const busy of [false, true]) for (const active of [false, true]) for (const uncertain of [false, true]) {
    assert.equal(expressEditorLocked(false, busy, active, uncertain), true);
  }
});
test("R3: recovered idle draft is editable without waiting for an extra action", () => {
  assert.equal(expressEditorLocked(true, false, false, false), false);
});
test("recovery guard preserves busy/uncertain locks without locking all other offers of a live album", () => {
  assert.equal(expressEditorLocked(true, true, false, false), true);
  assert.equal(expressEditorLocked(true, false, true, false), false);
  assert.equal(expressEditorLocked(true, false, false, true), true);
});
