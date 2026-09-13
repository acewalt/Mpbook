"use strict";

const PIPER_JS = "https://cdn.jsdelivr.net/gh/Mintplex-Labs/piper-tts-web@5f06fa07a4284d846a43a0477a09fb15b4769157/src/piper.js";
const ORT_ESM = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/esm/ort.min.js";
const ORT_WASM_BASE = "https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/";
const PIPER_WASM_BASE = "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize";
const HF_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main";
const FILE_CACHE = "mpbook-piper-files-v1";

const ALLOWED_MODELS = new Set([
  "es_ES-carlfm-x_low",
  "es_ES-davefx-medium",
  "es_ES-mls_10246-low",
  "es_ES-mls_9972-low",
  "es_ES-sharvard-medium",
  "es_MX-ald-medium",
  "es_MX-claude-high",
]);

let ortPromise = null;
let phonemizerPromise = null;
let phonemeResolve = null;
let phonemeReject = null;
let activeModel = "";
let activeSession = null;
let activeConfig = null;
let queue = Promise.resolve();

function postStatus(id, es, en = es) {
  self.postMessage({ type: "status", id, es, en });
}

function parseVoice(raw) {
  const [model, speakerRaw] = String(raw || "").split("#");
  if (!ALLOWED_MODELS.has(model)) throw new Error("Voz Piper no válida: " + model);
  const speaker = speakerRaw == null || speakerRaw === "" ? 0 : Number.parseInt(speakerRaw, 10);
  if (!Number.isInteger(speaker) || speaker < 0) throw new Error("Altavoz Piper no válido");
  return { model, speaker };
}

function modelPath(model) {
  const parts = model.split("-");
  if (parts.length !== 3) throw new Error("Modelo Piper no válido: " + model);
  const [locale, name, quality] = parts;
  const lang = locale.split("_")[0];
  return `${lang}/${locale}/${name}/${quality}/${model}.onnx`;
}

async function fetchCached(url) {
  let cache = null;
  try { cache = await caches.open(FILE_CACHE); } catch (_) {}
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) return hit;
    } catch (_) {}
  }

  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`No se pudo descargar Piper (${response.status})`);
  if (cache) {
    try { await cache.put(url, response.clone()); } catch (_) {}
  }
  return response;
}

async function getOrt() {
  if (!ortPromise) {
    ortPromise = import(ORT_ESM).then((mod) => {
      const ort = mod.default && mod.default.InferenceSession ? mod.default : mod;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = ORT_WASM_BASE;
      return ort;
    });
  }
  return ortPromise;
}

async function getPhonemizer() {
  if (!phonemizerPromise) {
    phonemizerPromise = import(PIPER_JS).then(async ({ createPiperPhonemize }) => {
      if (typeof createPiperPhonemize !== "function") throw new Error("No se pudo cargar Piper phonemize");
      return await createPiperPhonemize({
        print: (data) => {
          if (!phonemeResolve) return;
          const resolve = phonemeResolve;
          const reject = phonemeReject;
          phonemeResolve = null;
          phonemeReject = null;
          try { resolve(JSON.parse(data).phoneme_ids || []); }
          catch (err) { reject?.(err); }
        },
        printErr: (message) => {
          if (!phonemeReject) return;
          const reject = phonemeReject;
          phonemeResolve = null;
          phonemeReject = null;
          reject(new Error(String(message || "Piper phonemize error")));
        },
        locateFile: (url) => {
          if (url.endsWith(".wasm")) return PIPER_WASM_BASE + ".wasm";
          if (url.endsWith(".data")) return PIPER_WASM_BASE + ".data";
          return url;
        },
      });
    });
  }
  return phonemizerPromise;
}

async function phonemize(text, config) {
  const module = await getPhonemizer();
  return await new Promise((resolve, reject) => {
    phonemeResolve = resolve;
    phonemeReject = reject;
    try {
      module.callMain([
        "-l", config.espeak.voice,
        "--input", JSON.stringify([{ text: String(text || "").trim() }]),
        "--espeak_data", "/espeak-ng-data",
      ]);
    } catch (err) {
      phonemeResolve = null;
      phonemeReject = null;
      reject(err);
    }
  });
}

async function loadModel(id, model) {
  if (activeModel === model && activeSession && activeConfig) {
    return { session: activeSession, config: activeConfig };
  }

  postStatus(id, "Cargando voz Piper…", "Loading Piper voice…");
  const path = modelPath(model);
  const configUrl = `${HF_BASE}/${path}.json`;
  const modelUrl = `${HF_BASE}/${path}`;

  const [configResp, modelResp, ort] = await Promise.all([
    fetchCached(configUrl),
    fetchCached(modelUrl),
    getOrt(),
  ]);
  const config = await configResp.json();
  const modelBuffer = await modelResp.arrayBuffer();

  if (activeSession && typeof activeSession.release === "function") {
    try { await activeSession.release(); } catch (_) {}
  }
  activeSession = await ort.InferenceSession.create(modelBuffer, { executionProviders: ["wasm"] });
  activeConfig = config;
  activeModel = model;
  return { session: activeSession, config: activeConfig };
}

function wavFromFloat32(pcm, sampleRate) {
  const dataLen = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);
  const write = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataLen, true);
  let p = 44;
  for (let i = 0; i < pcm.length; i++, p += 2) {
    const v = Math.max(-1, Math.min(1, Number(pcm[i]) || 0));
    view.setInt16(p, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return buffer;
}

function asInt64(values) {
  return BigInt64Array.from(values, (v) => BigInt(v));
}

async function synth(id, text, cfg) {
  if (!String(text || "").trim()) throw new Error("El texto está vacío");
  const { model, speaker } = parseVoice(cfg?.voice);
  const { session, config } = await loadModel(id, model);

  const speakerMap = config.speaker_id_map || {};
  const speakerCount = Number(config.num_speakers || Object.keys(speakerMap).length || 1);
  if (speaker >= speakerCount) throw new Error(`La voz seleccionada no tiene el altavoz ${speaker}`);

  postStatus(id, "Generando voz Piper…", "Generating Piper voice…");
  const phonemeIds = await phonemize(text, config);
  if (!phonemeIds.length) throw new Error("Piper no pudo convertir el texto a fonemas");
  const ort = await getOrt();
  const feeds = {
    input: new ort.Tensor("int64", asInt64(phonemeIds), [1, phonemeIds.length]),
    input_lengths: new ort.Tensor("int64", asInt64([phonemeIds.length]), [1]),
    scales: new ort.Tensor("float32", new Float32Array([
      Number(config.inference.noise_scale),
      Number(config.inference.length_scale),
      Number(config.inference.noise_w),
    ]), [3]),
  };
  if (speakerCount > 1 || Object.keys(speakerMap).length) {
    feeds.sid = new ort.Tensor("int64", asInt64([speaker]), [1]);
  }

  const outputs = await session.run(feeds);
  const out = outputs.output || outputs[Object.keys(outputs)[0]];
  if (!out?.data) throw new Error("Piper no devolvió audio");
  const pcm = out.data instanceof Float32Array ? out.data : new Float32Array(out.data);
  return wavFromFloat32(pcm, Number(config.audio.sample_rate || 22050));
}

self.onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type !== "synth") return;
  const { id, text, cfg } = msg;
  queue = queue.then(async () => {
    try {
      const buffer = await synth(id, text, cfg || {});
      self.postMessage({ type: "result", id, buffer }, [buffer]);
    } catch (err) {
      self.postMessage({ type: "error", id, message: err?.message || String(err) });
    }
  });
};
