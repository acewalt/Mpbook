import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./_extract.mjs";

const { pcmToWav, mergeWavPcm } = load(["pcmToWav", "mergeWavPcm"]);

test("兩個 WAV 合併:取樣率沿用、PCM 串接、長度正確", async () => {
  const p1 = new Uint8Array([1, 2, 3, 4]);
  const p2 = new Uint8Array([5, 6]);
  const w1 = new Uint8Array(await pcmToWav(p1, 24000).arrayBuffer());
  const w2 = new Uint8Array(await pcmToWav(p2, 24000).arrayBuffer());
  const m = mergeWavPcm([w1, w2]);
  assert.equal(m.rate, 24000);
  assert.deepEqual(m.pcm, new Uint8Array([1, 2, 3, 4, 5, 6]));
  // 再包回 WAV 後總長 = 44 + 6
  const final = await pcmToWav(m.pcm, m.rate).arrayBuffer();
  assert.equal(final.byteLength, 50);
});

test("單一 WAV 也能處理", async () => {
  const w = new Uint8Array(await pcmToWav(new Uint8Array([9]), 16000).arrayBuffer());
  const m = mergeWavPcm([w]);
  assert.equal(m.rate, 16000);
  assert.deepEqual(m.pcm, new Uint8Array([9]));
});
