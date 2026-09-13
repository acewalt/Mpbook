(() => {
  "use strict";

  if (!window.chrome?.webview) return;

  const CHANNEL = "mpbook-native";
  const PREF_KEY = "mpbook.windowsPreferred.v1";
  let seq = 0;
  const pending = new Map();

  function tr(es, en) {
    return localStorage.getItem("mpbook.uiLanguage") === "en" ? en : es;
  }

  window.chrome.webview.addEventListener("message", (event) => {
    const msg = event.data || {};
    if (msg.channel !== CHANNEL || !msg.id) return;
    const task = pending.get(msg.id);
    if (!task) return;
    pending.delete(msg.id);
    if (msg.ok) task.resolve(msg.result);
    else task.reject(new Error(msg.error || tr("Error del motor de Windows", "Windows voice engine error")));
  });

  function request(action, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      try {
        window.chrome.webview.postMessage({ channel: CHANNEL, id, action, ...payload });
      } catch (err) {
        pending.delete(id);
        reject(err);
      }
    });
  }

  function base64ToBlob(base64, mime) {
    const bin = atob(base64 || "");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || "audio/wav" });
  }

  async function listVoices() {
    const result = await request("listVoices");
    return Array.isArray(result) ? result : [];
  }

  async function synth(text, cfg) {
    try { setStatus("loading", tr("Generando con Windows…", "Generating with Windows…")); } catch (_) {}
    const result = await request("synth", {
      text: String(text || ""),
      voiceId: cfg?.voice || "",
    });
    return base64ToBlob(result?.base64 || "", result?.mime || "audio/wav");
  }

  window.MPBookWindows = { request, listVoices, synth };

  function patchSettingsPersistence() {
    try {
      if (window.__mpbookWindowsSettingsPatched || typeof saveSettings !== "function") return;
      const originalSaveSettings = saveSettings;
      const patchedSaveSettings = function () {
        originalSaveSettings();
        try {
          const actual = document.querySelector("#provider")?.value || "";
          const saved = JSON.parse(localStorage.getItem("shuoshu.settings") || "{}");
          if (actual === "windows") {
            // El HTML base no conoce este proveedor al arrancar. Guardamos un fallback seguro
            // y recordamos Windows aparte para restaurarlo cuando el bridge nativo esté listo.
            saved.provider = "kokoro";
            localStorage.setItem("shuoshu.settings", JSON.stringify(saved));
            localStorage.setItem(PREF_KEY, "1");
          } else {
            localStorage.removeItem(PREF_KEY);
          }
        } catch (_) {}
      };

      try {
        for (const k of SKEYS) {
          const el = document.querySelector("#" + k);
          if (!el) continue;
          el.removeEventListener("change", originalSaveSettings);
          el.addEventListener("change", patchedSaveSettings);
        }
      } catch (_) {}

      saveSettings = patchedSaveSettings;
      window.__mpbookWindowsSettingsPatched = true;
    } catch (_) {}
  }

  function patchLocalProvider() {
    try {
      if (!window.__mpbookWindowsCfgPatched && typeof cfgNow === "function") {
        const originalCfgNow = cfgNow;
        cfgNow = function () {
          const cfg = originalCfgNow();
          if (cfg.provider === "windows") cfg.key = "local";
          return cfg;
        };
        window.__mpbookWindowsCfgPatched = true;
      }
    } catch (_) {}

    try {
      if (!window.__mpbookWindowsSegPatched && typeof autoSegLen === "function") {
        const originalAutoSegLen = autoSegLen;
        autoSegLen = function (provider, model) {
          if (provider === "windows") return 800;
          return originalAutoSegLen(provider, model);
        };
        window.__mpbookWindowsSegPatched = true;
      }
    } catch (_) {}
  }

  function patchExportGuard() {
    try {
      if (window.__mpbookWindowsExportPatched || typeof openExportModal !== "function") return;
      const btn = document.querySelector("#exportBtn");
      const originalOpenExportModal = openExportModal;
      if (btn) btn.removeEventListener("click", originalOpenExportModal);

      openExportModal = async function () {
        if (document.querySelector("#provider")?.value === "windows") {
          toast(tr(
            "La exportación con Windows Natural se habilitará después de validar la síntesis en tu PC. Para exportar ahora usa Piper, Kokoro o un motor cloud.",
            "Windows Natural export will be enabled after native synthesis is validated on your PC. For now use Piper, Kokoro, or a cloud engine to export."
          ), true);
          return;
        }
        return originalOpenExportModal();
      };

      if (btn) btn.addEventListener("click", openExportModal);
      window.__mpbookWindowsExportPatched = true;
    } catch (_) {}
  }

  function updateLabels() {
    const option = document.querySelector('#provider option[value="windows"]');
    if (option) option.textContent = tr("Windows · voces instaladas", "Windows · installed voices");
    const hint = document.querySelector("#windowsVoiceHint");
    if (hint) {
      hint.textContent = tr(
        "Usa directamente las voces que Windows expone a su API nativa. Si Jorge, Dalia, Álvaro o Elvira (Natural) aparecen aquí, MPBook puede utilizarlas sin cargar Kokoro ni Piper.",
        "Uses voices exposed by the native Windows speech API. If Jorge, Dalia, Álvaro, or Elvira (Natural) appear here, MPBook can use them without loading Kokoro or Piper."
      );
    }
    try { if (PROVIDERS?.windows) PROVIDERS.windows.label = option?.textContent || "Windows"; } catch (_) {}
  }

  async function installProvider() {
    if (typeof PROVIDERS === "undefined") return;

    let nativeVoices = [];
    try {
      nativeVoices = await listVoices();
    } catch (err) {
      console.warn("MPBook Windows bridge:", err);
      return;
    }
    if (!nativeVoices.length) return;

    const voices = nativeVoices.map((v) => {
      const gender = String(v.gender || "").toLowerCase();
      const g = gender === "male" ? "m" : gender === "female" ? "f" : "n";
      const symbol = g === "m" ? "♂" : g === "f" ? "♀" : "";
      const name = v.name || v.id || "Windows voice";
      const locale = v.language || "";
      const naturalTag = v.natural && !/natural/i.test(name) ? " · Natural" : "";
      return {
        id: v.id,
        label: `${name}${naturalTag}${locale ? " · " + locale : ""}${symbol ? " · " + symbol : ""}`,
        g,
        lang: String(locale).split(/[-_]/)[0].toLowerCase(),
        nativeLanguage: locale,
        natural: !!v.natural,
      };
    });

    PROVIDERS.windows = {
      label: "Windows",
      voices,
      models: null,
      synth: (text, cfg) => window.MPBookWindows.synth(text, cfg),
    };

    const select = document.querySelector("#provider");
    if (select && !select.querySelector('option[value="windows"]')) {
      const option = document.createElement("option");
      option.value = "windows";
      const piper = select.querySelector('option[value="piper"]');
      select.insertBefore(option, piper || select.querySelector('option[value="kokoro"]') || null);
    }

    const cloud = document.querySelector("#cloudFields");
    if (cloud && !document.querySelector("#windowsVoiceHint")) {
      const field = document.createElement("div");
      field.className = "field";
      field.dataset.p = "windows";
      field.innerHTML = '<div class="hint" id="windowsVoiceHint"></div>';
      cloud.insertBefore(field, cloud.firstChild);
    }

    patchLocalProvider();
    patchSettingsPersistence();
    patchExportGuard();
    updateLabels();

    try {
      if (localStorage.getItem(PREF_KEY) === "1") select.value = "windows";
    } catch (_) {}

    try { updateProviderUI(); } catch (_) {}
    try { updateSegLenUI(); } catch (_) {}

    document.addEventListener("click", (event) => {
      if (event.target?.closest?.("#uiLangBtn")) setTimeout(updateLabels, 0);
    });
  }

  installProvider();
})();
