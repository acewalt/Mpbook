import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./_extract.mjs";

const { stepRate } = load(["stepRate"]);

test("加速一格：1 → 1.25", () => {
  assert.equal(stepRate(1, 1), 1.25);
});

test("減速一格：1 → 0.75", () => {
  assert.equal(stepRate(1, -1), 0.75);
});

test("上限封頂 3.0：3 再加速仍是 3", () => {
  assert.equal(stepRate(3, 1), 3);
});

test("下限封底 0.5：0.5 再減速仍是 0.5", () => {
  assert.equal(stepRate(0.5, -1), 0.5);
});

test("越界輸入被拉回範圍內", () => {
  assert.equal(stepRate(9, 1), 3);
  assert.equal(stepRate(0.1, -1), 0.5);
});

test("非數字輸入當 1 處理", () => {
  assert.equal(stepRate(NaN, 1), 1.25);
  assert.equal(stepRate(undefined, -1), 0.75);
});

test("浮點誤差被修整到兩位小數", () => {
  assert.equal(stepRate(1.05, 1), 1.3);
  assert.equal(stepRate(stepRate(0.75, 1), 1), 1.25);
});
