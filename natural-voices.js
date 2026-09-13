(() => {
  "use strict";

  const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
  const VOICE_BASE = `https://huggingface.co/${MODEL_ID}/resolve/main/voices`;
  const DEFAULT_MIGRATION = "mpbook.naturalDefault.v1";
  const VOICE_CACHE_NAME = "mpbook-kokoro-voices-v1";
  const SAMPLE_RATE = 24000;
  const STYLE_DIM = 256;
  const IS_MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const MAX_CHARS = IS_MOBILE ? 180 : 300;

  let runtimePromise = null;
  const voiceMemory = new Map();

  function tr(es, en) {
    return localStorage.getItem("mpbook.uiLanguage") === "en" ? en : es;
  }

  function report(text) {
    try { setStatus("loading", text); } catch (e) {}
  }

  function looksSpanish(text) {
    const s = ` ${String(text || "").toLowerCase()} `;
    if (/[áéíóúüñ¿¡]/.test(s)) return true;
    const words = s.match(/\b(el|la|los|las|de|del|que|y|en|un|una|para|por|con|como|pero|es|se|su|sus|al|lo|le|ya|más|muy|sin|sobre|entre|cuando|también|porque|esta|este|era|hay|tiene|todo|todos)\b/g);
    return (words?.length || 0) >= 2;
  }

  function resolveVoice(text, cfg) {
    if (cfg.voice && cfg.voice !== "natural-auto") return cfg.voice;
    if (cfg.lang === "es") return "ef_dora";
    if (cfg.lang === "en") return "af_heart";
    return looksSpanish(text) ? "ef_dora" : "af_heart";
  }

  function voiceLanguage(voice) {
    if (voice.startsWith("e")) return "es";
    if (voice.startsWith("b")) return "en-gb";
    return "en-us";
  }

  function splitNatural(text, max = MAX_CHARS) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) return [];
    if (clean.length <= max) return [clean];
    const sentences = clean.match(/[^.!?¡¿;:]+[.!?¡¿;:]*/g) || [clean];
    const out = [];
    let buf = "";
    for (let part of sentences) {
      part = part.trim();
      if (!part) continue;
      if (buf && (buf.length + 1 + part.length) <= max) {
        buf += " " + part;
        continue;
      }
      if (buf) { out.push(buf); buf = ""; }
      while (part.length > max) {
        let cut = part.lastIndexOf(" ", max);
        if (cut < Math.floor(max * 0.55)) cut = max;
        out.push(part.slice(0, cut).trim());
        part = part.slice(cut).trim();
      }
      buf = part;
    }
    if (buf) out.push(buf);
    return out;
  }

  function float32ToWav(samples, sampleRate = SAMPLE_RATE) {
    const dataLen = samples.length * 2;
    const buffer = new ArrayBuffer(44 + dataLen);
    const view = new DataView(buffer);
    const write = (offset, value) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
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
    let off = 44;
    for (let i = 0; i < samples.length; i++, off += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  async function loadRuntime() {
    if (runtimePromise) return runtimePromise;
    runtimePromise = (async () => {
      report(tr("Cargando voces naturales…", "Loading natural voices…"));
      const [hf, ph] = await Promise.all([
        import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1"),
        import("https://cdn.jsdelivr.net/npm/phonemizer@1.2.1")
      ]);

      if (hf.env) {
        hf.env.allowLocalModels = false;
        hf.env.useBrowserCache = true;
      }

      const progress_callback = (p) => {
        if (!p || p.status !== "progress" || typeof p.progress !== "number") return;
        report(`${tr("Descargando modelo natural", "Downloading natural model")}… ${Math.round(p.progress)}%`);
      };

      const [model, tokenizer] = await Promise.all([
        hf.StyleTextToSpeech2Model.from_pretrained(MODEL_ID, {
          dtype: IS_MOBILE ? "q4" : "q8",
          device: "wasm",
          progress_callback,
        }),
        hf.AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback }),
      ]);

      return { hf, phonemize: ph.phonemize, model, tokenizer };
    })().catch((err) => {
      runtimePromise = null;
      throw err;
    });
    return runtimePromise;
  }

  async function getVoiceData(voice) {
    if (voiceMemory.has(voice)) return voiceMemory.get(voice);
    const url = `${VOICE_BASE}/${voice}.bin`;
    let buffer = null;
    let cache = null;
    try {
      cache = await caches.open(VOICE_CACHE_NAME);
      const hit = await cache.match(url);
      if (hit) buffer = await hit.arrayBuffer();
    } catch (e) {}

    if (!buffer) {
      report(tr("Cargando perfil de voz…", "Loading voice profile…"));
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Hugging Face voice ${voice}: ${response.status}`);
      buffer = await response.arrayBuffer();
      if (cache) {
        try { await cache.put(url, new Response(buffer)); } catch (e) {}
      }
    }
    const data = new Float32Array(buffer);
    voiceMemory.set(voice, data);
    return data;
  }

  async function synthPart(text, voice, runtime) {
    const language = voiceLanguage(voice);
    const raw = await runtime.phonemize(text, language);
    const phonemes = Array.isArray(raw) ? raw.join(" ") : String(raw || "");
    if (!phonemes.trim()) throw new Error(tr("No se pudo fonetizar el texto.", "Could not phonemize the text."));

    const tokenized = runtime.tokenizer(phonemes, { truncation: true });
    const input_ids = tokenized.input_ids;
    const numTokens = Math.min(Math.max(input_ids.dims.at(-1) - 2, 0), 509);
    const allVoiceData = await getVoiceData(voice);
    const offset = numTokens * STYLE_DIM;
    const styleData = allVoiceData.slice(offset, offset + STYLE_DIM);
    if (styleData.length !== STYLE_DIM) throw new Error(tr("El perfil de voz no es válido.", "The voice profile is invalid."));

    const inputs = {
      input_ids,
      style: new runtime.hf.Tensor("float32", styleData, [1, STYLE_DIM]),
      speed: new runtime.hf.Tensor("float32", [1], [1]),
    };
    const result = await runtime.model(inputs);
    return new Float32Array(result.waveform.data);
  }

  async function synth(text, cfg) {
    const runtime = await loadRuntime();
    const voice = resolveVoice(text, cfg);
    const parts = splitNatural(text);
    if (!parts.length) return float32ToWav(new Float32Array(1));

    const audioParts = [];
    let total = 0;
    for (let i = 0; i < parts.length; i++) {
      report(`${tr("Generando voz natural", "Generating natural voice")}… ${i + 1}/${parts.length}`);
      const samples = await synthPart(parts[i], voice, runtime);
      audioParts.push(samples);
      total += samples.length;
    }
    const joined = new Float32Array(total);
    let pos = 0;
    for (const samples of audioParts) {
      joined.set(samples, pos);
      pos += samples.length;
    }
    return float32ToWav(joined);
  }

  window.MPBookNatural = {
    synth,
    modelId: MODEL_ID,
    clearRuntime() { runtimePromise = null; voiceMemory.clear(); },
  };

  // Primera migración: las voces naturales quedan seleccionadas por defecto.
  // Después de esto, cualquier cambio manual del usuario se respeta y persiste.
  try {
    if (!localStorage.getItem(DEFAULT_MIGRATION)) {
      const provider = document.querySelector("#provider");
      if (provider && provider.querySelector('option[value="kokoro"]')) {
        provider.value = "kokoro";
        if (typeof updateProviderUI === "function") updateProviderUI();
        if (typeof updateSegLenUI === "function") updateSegLenUI();
        if (typeof saveSettings === "function") saveSettings();
      }
      localStorage.setItem(DEFAULT_MIGRATION, "1");
    }
  } catch (e) {}
})();