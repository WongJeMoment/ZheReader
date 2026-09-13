import test from "node:test";
import assert from "node:assert/strict";
import { selectStudyModel } from "../server/model-selection.mjs";

const standard = { model: "gpt-5.6-sol", isDefault: true };
const fast = { model: "gpt-5.6-luna" };

test("translation uses the available fast model independently of saved choices", () => {
  for (const model of ["", standard.model, "custom-model"]) {
    assert.equal(selectStudyModel([standard, fast], { action: "translate", model }), fast);
  }
});

test("translation falls back to the account catalogue without inventing access", () => {
  assert.equal(selectStudyModel([standard], { action: "translate", model: fast.model }), standard);
  assert.equal(selectStudyModel([], { action: "translate" }), undefined);
});

test("analysis, search and guidance preserve explicit and custom models", () => {
  for (const action of ["analyze", "explain", "research", "paper-plan", "paper-read"]) {
    assert.equal(selectStudyModel([standard, fast], { action, model: standard.model }), standard);
    assert.deepEqual(selectStudyModel([standard, fast], { action, model: "custom-model" }), { model: "custom-model" });
    assert.equal(selectStudyModel([standard, fast], { action }), standard);
  }
});
