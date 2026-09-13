import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./_extract.mjs";

const { openaiChunkLimit, chunkForProvider } = load(["openaiChunkLimit", "chunkForProvider"]);

test("gpt-4o-mini-tts 上限 2000 token，分塊壓到 1000 字元", () => {
  assert.equal(openaiChunkLimit("gpt-4o-mini-tts"), 1000);
});

test("tts-1 系列維持 4000 字元", () => {
  assert.equal(openaiChunkLimit("tts-1"), 4000);
  assert.equal(openaiChunkLimit("tts-1-hd"), 4000);
});

test("2500 字中文段在 mini-tts 限制下切成多塊且每塊不超限", () => {
  const text = ("甲".repeat(48) + "。").repeat(51); // 2499 字
  const chunks = chunkForProvider(text, openaiChunkLimit("gpt-4o-mini-tts"));
  assert.ok(chunks.length >= 3);
  for (const c of chunks) assert.ok(c.length <= 1000);
  assert.equal(chunks.join(""), text); // 內容無遺漏
});
