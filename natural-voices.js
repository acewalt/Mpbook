(() => {
  "use strict";

  const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
  const DEFAULT_MIGRATION = "mpbook.naturalDefault.v1";

  let worker = null;
  let seq = 0;
  const pending = new Map();

  function tr(es, en) {
    return localStorage.getItem("mpbook.uiLanguage") === "en" ? en : es;
  }

  function report(es, en = es) {
    try { setStatus("loading", tr(es, en)); } catch (_) {}
  }

  function rejectAll(message) {
    for (const { reject } of pending.values()) reject(new Error(message));
    pending.clear();
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker("./natural-voices-worker.js?v=4");

    worker.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === "status") {
        report(msg.es || "Procesando voz…", msg.en || msg.es || "Processing voice…");
        return;
      }

      const task = pending.get(msg.id);
      if (!task) return;
      if (msg.type === "result") {
        pending.delete(msg.id);
        task.resolve(new Blob([msg.buffer], { type: "audio/wav" }));
      } else if (msg.type === "error") {
        pending.delete(msg.id);
        task.reject(new Error(msg.message || tr("Error al generar la voz natural", "Natural voice generation failed")));
      }
    };

    worker.onerror = (event) => {
      const message = event?.message || tr("El motor de voz natural se detuvo", "Natural voice engine stopped");
      rejectAll(message);
      try { worker.terminate(); } catch (_) {}
      worker = null;
    };

    return worker;
  }

  function synth(text, cfg) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      try {
        ensureWorker().postMessage({ type: "synth", id, text: String(text || ""), cfg: cfg || {} });
      } catch (err) {
        pending.delete(id);
        reject(err);
      }
    });
  }

  function clearRuntime() {
    rejectAll(tr("Motor de voz reiniciado", "Voice engine reset"));
    if (worker) {
      try { worker.terminate(); } catch (_) {}
      worker = null;
    }
  }

  window.MPBookNatural = { synth, modelId: MODEL_ID, clearRuntime };

  // En instalaciones nuevas, Voces naturales queda seleccionada por defecto.
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
  } catch (_) {}

  function fixPiperVoiceGenders() {
    try {
      if (typeof PROVIDERS === "undefined" || !PROVIDERS.piper?.voices) return;

      const meta = {
        "es_ES-carlfm-x_low":        { g: "m", label: "CarlFM · ES-ES · ♂ · x-low" },
        "es_ES-davefx-medium":       { g: "m", label: "DaveFX · ES-ES · ♂ · medium" },
        "es_ES-mls_10246-low":       { g: "f", label: "MLS 10246 · ES-ES · ♀ · low" },
        "es_ES-mls_9972-low":        { g: "f", label: "MLS 9972 · ES-ES · ♀ · low" },
        "es_ES-sharvard-medium#0":   { g: "m", label: "Sharvard M · ES-ES · ♂ · medium" },
        "es_ES-sharvard-medium#1":   { g: "f", label: "Sharvard F · ES-ES · ♀ · medium" },
        "es_MX-ald-medium":          { g: "m", label: "ALD · ES-MX · ♂ · medium" },
        "es_MX-claude-high":         { g: "f", label: "Claude · ES-MX · ♀ · high" },
      };

      for (const voice of PROVIDERS.piper.voices) {
        const m = meta[voice.id];
        if (!m) continue;
        voice.g = m.g;
        voice.label = m.label;
      }

      if (window.MPBookPiper?.voices) {
        for (const voice of window.MPBookPiper.voices) {
          const m = meta[voice.id];
          if (!m) continue;
          voice.g = m.g;
          voice.label = m.label;
        }
      }

      if (document.querySelector("#provider")?.value === "piper" && typeof filterVoices === "function") {
        filterVoices();
      }
    } catch (_) {}
  }

  // Piper se registra como un motor adicional sin agrandar index.html.
  try {
    if (!document.querySelector('script[data-mpbook-piper]')) {
      const script = document.createElement("script");
      script.src = "./piper-voices.js?v=2";
      script.dataset.mpbookPiper = "1";
      script.addEventListener("load", fixPiperVoiceGenders, { once: true });
      document.body.appendChild(script);
    } else {
      setTimeout(fixPiperVoiceGenders, 0);
    }
  } catch (_) {}
})();
