import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./_extract.mjs";

const { canResumeSrc } = load(["canResumeSrc"]);

test("src 屬於當前段才能續播", () => {
  assert.equal(canResumeSrc("blob:x", 3, 3), true);
});

test("src 是舊段（段號不符）不能續播，要重新取段", () => {
  assert.equal(canResumeSrc("blob:x", 2, 3), false);
});

test("沒有 src 不能續播", () => {
  assert.equal(canResumeSrc("", 3, 3), false);
});

test("換書後 srcIndex 已重設為 -1，即使殘留 src 也不能續播", () => {
  assert.equal(canResumeSrc("blob:x", -1, -1), false);
});
