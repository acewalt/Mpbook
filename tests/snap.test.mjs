import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./_extract.mjs";

const { snapToSentence } = load(["snapToSentence"]);
const T = "甲甲甲。乙乙乙。丙丙丙。"; // 長度 12，句界在 3、7、11

test("中段比例吸附到整句", () => {
  assert.deepEqual(snapToSentence(T, 0.4), { start: 4, end: 8 }); // 乙乙乙。
});
test("比例 0 取第一句", () => {
  assert.deepEqual(snapToSentence(T, 0), { start: 0, end: 4 });
});
test("比例 1 取最後一句", () => {
  assert.deepEqual(snapToSentence(T, 1), { start: 8, end: 12 });
});
test("無標點整段算一句", () => {
  assert.deepEqual(snapToSentence("abcdef", 0.5), { start: 0, end: 6 });
});
test("換行也是句界", () => {
  assert.deepEqual(snapToSentence("ab\ncd", 0.9), { start: 3, end: 5 });
});
test("空字串不爆炸", () => {
  assert.deepEqual(snapToSentence("", 0.5), { start: 0, end: 0 });
});
test("吸附後跳過句首空白", () => {
  assert.deepEqual(snapToSentence("a。 b。", 0.8), { start: 3, end: 5 });
});
test("ratio NaN 傳回整段（安全 fallback）", () => {
  assert.deepEqual(snapToSentence(T, NaN), { start: 0, end: 12 });
});
test("連續換行中間的空段回傳 start===end（安全但空）", () => {
  const r = snapToSentence("a\n\nb", 0.5);
  assert.equal(r.start, r.end);
});
