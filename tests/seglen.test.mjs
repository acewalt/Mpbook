import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./_extract.mjs";

const { autoSegLen } = load(["autoSegLen"]);

test("OpenAI 依模型分流：mini-tts 1000、tts-1 系列 4000", () => {
  assert.equal(autoSegLen("openai", "gpt-4o-mini-tts"), 1000);
  assert.equal(autoSegLen("openai", "tts-1"), 4000);
  assert.equal(autoSegLen("openai", "tts-1-hd"), 4000);
});

test("各引擎的單次請求甜蜜點", () => {
  assert.equal(autoSegLen("google", ""), 1300);
  assert.equal(autoSegLen("azure", ""), 1800);
  assert.equal(autoSegLen("gemini", "gemini-2.5-flash-preview-tts"), 4000);
  assert.equal(autoSegLen("browser", ""), 800);
});

test("未知引擎回預設 2500", () => {
  assert.equal(autoSegLen("unknown", ""), 2500);
});
