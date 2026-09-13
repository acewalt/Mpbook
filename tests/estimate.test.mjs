import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./_extract.mjs";

const { sanitizeFilename, exportEstimate } = load(["sanitizeFilename", "exportEstimate"]);

test("檔名清洗:Windows 非法字元換底線、長度截斷、空值兜底", () => {
  assert.equal(sanitizeFilename('第1章:導論/緒論?<>*|"\\'), "第1章_導論_緒論_______");
  assert.equal(sanitizeFilename("   "), "未命名");
  assert.equal(sanitizeFilename("a".repeat(99)).length, 60);
});

test("按字計費引擎:只算未快取字數", () => {
  // OpenAI tts-1 $15/M chars;10 萬字、5 萬已快取 → 5 萬新字 = $0.75
  const e = exportEstimate(100000, 50000, "openai", "tts-1");
  assert.equal(e.newChars, 50000);
  assert.ok(Math.abs(e.usd - 0.75) < 1e-9);
  assert.ok(e.sizeMB > 0 && e.minutes > 0 && e.timeMin >= 1);
  assert.ok(Math.abs(exportEstimate(100000, 50000, "openai", "tts-1-hd").usd - 1.5) < 1e-9); // hd 翻倍
});

test("全部已快取 → $0", () => {
  assert.equal(exportEstimate(80000, 80000, "google", "").usd, 0);
});

test("按時計費引擎（gemini）按分鐘估,WAV 大小用高估率", () => {
  const e = exportEstimate(50000, 0, "gemini", "gemini-2.5-flash-preview-tts");
  // 50000 字 ÷ 3.3 字/秒 ÷ 60 ≈ 252.5 分鐘;$0.015/分 ≈ $3.79
  assert.ok(e.usd > 3 && e.usd < 4.5);
  assert.ok(e.sizeMB > e.minutes * 2); // WAV ~2.9 MB/分 > MP3 0.5
});

test("azure 按字計費", () => {
  assert.ok(Math.abs(exportEstimate(1000000, 0, "azure", "").usd - 15) < 1e-9);
});
