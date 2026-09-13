import { test } from "node:test";
import assert from "node:assert/strict";
import { scriptSource, load } from "./_extract.mjs";

test("inline script 語法可解析", () => {
  assert.doesNotThrow(() => new Function(scriptSource()));
});

test("抽取器能抽既有函式並執行", () => {
  const { chunkForProvider } = load(["chunkForProvider"]);
  assert.deepEqual(chunkForProvider("abc", 10), ["abc"]);
  const chunks = chunkForProvider("一句。二句。三句。", 7);
  assert.equal(chunks.join(""), "一句。二句。三句。"); // 不掉字
  assert.ok(chunks.every(c => c.length <= 7), "每塊不超過 maxChars");
});
