(() => {
  "use strict";

  const VERSION = "1";
  const PREFERRED_KEY = "mpbook.piperPreferred.v1";
  const VOICES = [
    { id: "es_ES-carlfm-x_low", label: "CarlFM · ES-ES · x-low", g: "n", lang: "es" },
    { id: "es_ES-davefx-medium", label: "DaveFX · ES-ES · medium", g: "n", lang: "es" },
    { id: "es_ES-mls_10246-low", label: "MLS 10246 · ES-ES · low", g: "n", lang: "es" },
    { id: "es_ES-mls_9972-low", label: "MLS 9972 · ES-ES · low", g: "n", lang: "es" },
    { id: "es_ES-sharvard-medium#0", label: "Sharvard M · ES-ES · ♂ · medium", g: "m", lang: "es" },
    { id: "es_ES-sharvard-medium#1", label: "Sharvard F · ES-ES · ♀ · medium", g: "f", lang: "es" },
    { id: "es_MX-ald-medium", label: "ALD · ES-MX · medium", g: "n", lang: "es" },
    { id: "es_MX-claude-high", label: "Claude · ES-MX · high", g: "n", lang: "es" },
  ];

  let worker = null;
  let seq = 0;
  const pending = new Map();

  function uiEnglish() {
    return localStorage.getItem("mpbook.uiLanguage") === "en";
  }
  function tr(es, en) { return uiEnglish() ? en : es; }
  function report(es, en = es) {
    try { setStatus("loading", tr(es, en)); } catch (_) {}
  }
  function rejectAll(message) {
    for (const task of pending.values()) task.reject(new Error(message));
    pending.clear();
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(`./piper-voices-worker.js?v=${VERSION}`, { type: "module" });
    worker.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === "status") {
        report(msg.es || "Procesando Piper…", msg.en || msg.es || "Processing Piper…");
        return;
      }
      const task = pending.get(msg.id);
      if (!task) return;
      if (msg.type === "result") {
        pending.delete(msg.id);
        task.resolve(new Blob([msg.buffer], { type: "audio/wav" }));
      } else if (msg.type === "error") {
        pending.delete(msg.id);
        task.reject(new Error(msg.message || tr("Error al generar Piper", "Piper generation failed")));
      }
    };
    worker.onerror = (event) => {
      const message = event?.message || tr("El motor Piper se detuvo", "Piper engine stopped");
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
    rejectAll(tr("Motor Piper reiniciado", "Piper engine reset"));
    if (worker) {
      try { worker.terminate(); } catch (_) {}
      worker = null;
    }
  }

  async function clearModelCache() {
    clearRuntime();
    try { await caches.delete("mpbook-piper-files-v1"); } catch (_) {}
  }

  window.MPBookPiper = { synth, clearRuntime, clearModelCache, voices: VOICES.slice() };

  function updateLabels() {
    const opt = document.querySelector('#provider option[value="piper"]');
    if (opt) opt.textContent = tr("Piper · español local (rápido)", "Piper · local Spanish (fast)");
    const hint = document.querySelector("#piperHint");
    if (hint) {
      hint.textContent = tr(
        "Piper funciona localmente en el navegador. La primera vez descarga la voz elegida (aprox. 28–77 MB) y después la reutiliza desde la caché. No usa API key.",
        "Piper runs locally in the browser. The selected voice is downloaded on first use (about 28–77 MB) and then reused from cache. No API key is required."
      );
    }
    try { if (PROVIDERS?.piper) PROVIDERS.piper.label = opt?.textContent || "Piper"; } catch (_) {}
  }

  function patchSettingsPersistence() {
    try {
      if (window.__mpbookPiperSettingsPatched || typeof saveSettings !== "function") return;
      const originalSaveSettings = saveSettings;
      const patchedSaveSettings = function () {
        originalSaveSettings();
        try {
          const actual = document.querySelector("#provider")?.value || "";
          const saved = JSON.parse(localStorage.getItem("shuoshu.settings") || "{}");
          if (actual === "piper") {
            // El HTML base todavía no conoce Piper durante el arranque. Guardamos Kokoro como
            // fallback seguro y recordamos Piper aparte; al cargar este módulo lo restauramos.
            saved.provider = "kokoro";
            localStorage.setItem("shuoshu.settings", JSON.stringify(saved));
            localStorage.setItem(PREFERRED_KEY, "1");
          } else {
            localStorage.removeItem(PREFERRED_KEY);
          }
        } catch (_) {}
      };

      // Los listeners genéricos de SKEYS capturaron la función original; los sustituimos.
      try {
        for (const k of SKEYS) {
          const el = document.querySelector("#" + k);
          if (!el) continue;
          el.removeEventListener("change", originalSaveSettings);
          el.addEventListener("change", patchedSaveSettings);
        }
      } catch (_) {}
      saveSettings = patchedSaveSettings;
      window.__mpbookPiperSettingsPatched = true;
    } catch (_) {}
  }

  function installProvider() {
    const select = document.querySelector("#provider");
    if (!select || typeof PROVIDERS === "undefined") return;

    if (!select.querySelector('option[value="piper"]')) {
      const option = document.createElement("option");
      option.value = "piper";
      const kokoro = select.querySelector('option[value="kokoro"]');
      select.insertBefore(option, kokoro || select.querySelector('option[value="browser"]') || null);
    }

    PROVIDERS.piper = {
      label: "Piper",
      voices: VOICES,
      models: null,
      synth: (text, cfg) => window.MPBookPiper.synth(text, cfg),
    };

    const cloud = document.querySelector("#cloudFields");
    if (cloud && !document.querySelector("#piperHint")) {
      const field = document.createElement("div");
      field.className = "field";
      field.dataset.p = "piper";
      field.innerHTML = '<div class="hint" id="piperHint"></div>';
      cloud.insertBefore(field, cloud.firstChild);
    }

    updateLabels();

    try {
      if (localStorage.getItem(PREFERRED_KEY) === "1") select.value = "piper";
    } catch (_) {}

    try { updateProviderUI(); } catch (_) {}
    try { updateSegLenUI(); } catch (_) {}
  }

  // Piper es local: evita que el flujo común lo trate como una API que necesita key.
  try {
    if (!window.__mpbookPiperCfgPatched && typeof cfgNow === "function") {
      const originalCfgNow = cfgNow;
      cfgNow = function () {
        const cfg = originalCfgNow();
        if (cfg.provider === "piper") cfg.key = "local";
        return cfg;
      };
      window.__mpbookPiperCfgPatched = true;
    }
  } catch (_) {}

  // Fragmentos moderados para que Piper empiece rápido y el prefetch existente alcance a preparar los siguientes.
  try {
    if (!window.__mpbookPiperSegPatched && typeof autoSegLen === "function") {
      const originalAutoSegLen = autoSegLen;
      autoSegLen = function (provider, model) {
        if (provider === "piper") return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? 220 : 420;
        return originalAutoSegLen(provider, model);
      };
      window.__mpbookPiperSegPatched = true;
    }
  } catch (_) {}

  // También limita el modo manual y los documentos antiguos guardados con segmentos muy largos.
  try {
    if (!window.__mpbookPiperLengthPatched && typeof effSegLen === "function" && typeof loadText === "function") {
      const originalEffSegLen = effSegLen;
      const originalLoadText = loadText;
      const piperCap = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? 220 : 420;
      effSegLen = function () {
        const value = originalEffSegLen();
        return document.querySelector("#provider")?.value === "piper" ? Math.min(value, piperCap()) : value;
      };
      loadText = async function (raw, title, plain, fixedSegLen) {
        if (document.querySelector("#provider")?.value === "piper" && fixedSegLen) {
          fixedSegLen = Math.min(fixedSegLen, piperCap());
        }
        return originalLoadText(raw, title, plain, fixedSegLen);
      };
      window.__mpbookPiperLengthPatched = true;
    }
  } catch (_) {}

  // Piper genera WAV local: corrige la estimación del exportador común.
  try {
    if (!window.__mpbookPiperEstimatePatched && typeof exportEstimate === "function") {
      const originalExportEstimate = exportEstimate;
      exportEstimate = function (totalChars, cachedChars, provider, model) {
        const est = originalExportEstimate(totalChars, cachedChars, provider, model);
        if (provider === "piper") {
          est.usd = 0;
          est.sizeMB = 2.9 * est.minutes;
        }
        return est;
      };
      window.__mpbookPiperEstimatePatched = true;
    }
  } catch (_) {}

  // La ventana de exportación original ya sirve; ajustamos únicamente las etiquetas que asumían MP3/nube.
  try {
    if (!window.__mpbookPiperExportModalPatched && typeof openExportModal === "function") {
      const btn = document.querySelector("#exportBtn");
      const originalOpenExportModal = openExportModal;
      if (btn) btn.removeEventListener("click", originalOpenExportModal);
      openExportModal = async function () {
        await originalOpenExportModal();
        const cfg = cfgNow();
        if (cfg.provider !== "piper") return;
        const info = document.querySelector("#exportInfo");
        if (info) {
          info.innerHTML = info.innerHTML
            .replace(/\$0 \(todo está en caché\)/g, "$0 (voz local)")
            .replace(/\$0 \(everything cached\)/g, "$0 (local voice)")
            .replace(/\bMP3\b/g, "WAV");
        }
      };
      if (btn) btn.addEventListener("click", openExportModal);
      window.__mpbookPiperExportModalPatched = true;
    }
  } catch (_) {}

  // El exportador original sólo fusionaba WAV de Gemini/Kokoro. Añadimos Piper al mismo camino.
  try {
    if (!window.__mpbookPiperRunExportPatched && typeof runExport === "function") {
      const goBtn = document.querySelector("#exportGoBtn");
      const originalRunExport = runExport;
      if (goBtn) goBtn.removeEventListener("click", originalRunExport);

      runExport = async function () {
        if (Exporter.running) return;
        const cfg = cfgNow();
        const ranges = chapterRanges();
        const segs = State.segments.slice();
        const totalSegs = segs.length;
        Exporter.running = true;
        Exporter.cancel = false;
        $("#exportGoBtn").hidden = true;
        $("#exportProg").hidden = false;
        let done = 0;
        try {
          const files = [];
          for (const r of ranges) {
            const blobs = new Array(r.to - r.from);
            let next = r.from;
            const makeOne = async () => {
              while (next < r.to) {
                if (Exporter.cancel) throw new Error("EXPORT_CANCELLED");
                const i = next++;
                blobs[i - r.from] = await synthBlobRetry(segs[i], cfg);
                done++;
                $("#exportStatus").textContent = exportT(
                  `Fragmento ${done} / ${totalSegs} · ${r.title}`,
                  `Segment ${done} / ${totalSegs} · ${r.title}`
                );
                $("#exportProgBar").style.width = (done / totalSegs * 100) + "%";
              }
            };
            await Promise.all([makeOne(), makeOne()]);

            let data, ext;
            const wavProvider = cfg.provider === "gemini" || cfg.provider === "kokoro" || cfg.provider === "piper";
            if (wavProvider) {
              const wavs = [];
              for (const b of blobs) wavs.push(new Uint8Array(await b.arrayBuffer()));
              const merged = mergeWavPcm(wavs);
              data = new Uint8Array(await pcmToWav(merged.pcm, merged.rate).arrayBuffer());
              ext = ".wav";
            } else {
              data = new Uint8Array(await new Blob(blobs, { type: "audio/mpeg" }).arrayBuffer());
              ext = ".mp3";
            }
            files.push({ name: sanitizeFilename(r.title) + ext, data });
          }

          const book = sanitizeFilename(State.docTitle || exportT("Audiolibro", "Audiobook"));
          if (files.length === 1) {
            const ext = files[0].name.slice(files[0].name.lastIndexOf("."));
            const type = ext === ".wav" ? "audio/wav" : "audio/mpeg";
            downloadBlob(new Blob([files[0].data], { type }), book + ext);
          } else {
            files.forEach((f, k) => { f.name = String(k + 1).padStart(2, "0") + "-" + f.name; });
            downloadBlob(new Blob([zipStore(files)], { type: "application/zip" }), book + ".zip");
          }
          $("#exportStatus").textContent = exportT("Listo. La descarga ha comenzado.", "Done. Download started.");
          toast(exportT("Exportación completada", "Export complete"));
        } catch (e) {
          if (e.message === "EXPORT_CANCELLED") {
            $("#exportStatus").textContent = exportT(
              "Exportación cancelada. Lo ya generado permanece en caché.",
              "Export cancelled. Already generated audio remains cached."
            );
          } else {
            $("#exportStatus").textContent = exportT("Error: ", "Error: ") + (e.message || e);
            toast(exportT("Error de exportación: ", "Export error: ") + (e.message || e), true);
          }
        } finally {
          Exporter.running = false;
          Exporter.cancel = false;
          $("#exportGoBtn").hidden = false;
        }
      };

      if (goBtn) goBtn.addEventListener("click", runExport);
      window.__mpbookPiperRunExportPatched = true;
    }
  } catch (_) {}

  patchSettingsPersistence();
  installProvider();
  document.querySelector("#clearCacheBtn")?.addEventListener("click", () => { clearModelCache(); });
  document.addEventListener("click", (event) => {
    if (event.target?.closest?.("#uiLangBtn")) setTimeout(updateLabels, 0);
  });
})();
