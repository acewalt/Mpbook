import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./_extract.mjs";

const { crc32, zipStore, zipEntries, zipExtract } = load(["crc32", "zipStore", "zipEntries", "zipExtract"]);

test("crc32 已知測試向量", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xCBF43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test("zipStore round-trip:自家 parser 能讀回（含中文檔名）", async () => {
  const a = new TextEncoder().encode("hello mp3 bytes");
  const b = new Uint8Array([0, 1, 2, 255, 254]);
  const zip = zipStore([
    { name: "01-第一章.mp3", data: a },
    { name: "02-第二章.mp3", data: b },
  ]);
  const entries = zipEntries(zip.buffer);
  assert.deepEqual([...entries.keys()], ["01-第一章.mp3", "02-第二章.mp3"]);
  const ea = entries.get("01-第一章.mp3");
  assert.equal(ea.method, 0); // store 模式
  assert.deepEqual(await zipExtract(zip.buffer, ea), a);
  assert.deepEqual(await zipExtract(zip.buffer, entries.get("02-第二章.mp3")), b);
});

test("zipStore: 0-byte entry round-trips", async () => {
  const zip = zipStore([{ name: "empty.mp3", data: new Uint8Array(0) }]);
  const entries = zipEntries(zip.buffer);
  assert.deepEqual(await zipExtract(zip.buffer, entries.get("empty.mp3")), new Uint8Array(0));
});
