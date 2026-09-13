// 從 index.html 抽 inline script 與 top-level 函式原始碼，給 node --test 用。
// 限制:用大括號配對定位函式結尾，函式內字串不得含未配對大括號。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");

export function scriptSource() {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("index.html 裡找不到 inline script");
  return m[1];
}

export function fnSource(name) {
  const sig = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(");
  const m = sig.exec(html);
  if (!m) throw new Error("function not found: " + name);
  const open = html.indexOf("{", m.index);
  let depth = 0, j = open;
  for (; j < html.length; j++) {
    if (html[j] === "{") depth++;
    else if (html[j] === "}") { depth--; if (!depth) break; }
  }
  if (depth !== 0) throw new Error("fnSource: 找不到 " + name + " 的結尾大括號");
  return html.slice(m.index, j + 1);
}

// 把多個函式抽出來放進同一個作用域回傳（後面的函式可以呼叫前面的）
export function load(names) {
  const src = names.map(fnSource).join("\n");
  return new Function(src + "\nreturn { " + names.join(", ") + " };")();
}
