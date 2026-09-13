(() => {
  "use strict";

  if (!window.chrome?.webview) return;

  const CHANNEL = "mpbook-native";
  const WINDOWS_PREF_KEY = "mpbook.windowsPreferred.v2";
  const SAPI_PREF_KEY = "mpbook.sapiPreferred.v1";
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

  async function listSapiVoices() {
    const result = await request("listSapiVoices");
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

  async function synthSapi(text, cfg) {
    try { setStatus("loading", tr("Generando con Windows SAPI…", "Generating with Windows SAPI…")); } catch (_) {}
    const result = await request("synthSapi", {
      text: String(text || ""),
      voiceId: cfg?.voice || "",
    });
    return base64ToBlob(result?.base64 || "", result?.mime || "audio/wav");
  }

  window.MPBookWindows = { request, listVoices, listSapiVoices, synth, synthSapi };

  function normalizeVoices(nativeVoices, source) {
    return nativeVoices.map((v) => {
      const gender = String(v.gender || "").toLowerCase();
      const g = gender === "male" ? "m" : gender === "female" ? "f" : "n";
      const symbol = g === "m" ? "♂" : g === "f" ? "♀" : "";
      const name = v.name || v.id || "Windows voice";
      const locale = v.language || "";
      const naturalTag = v.natural && !/natural|neural/i.test(name) ? " · Natural" : "";
      const adapterTag = source === "sapi" && v.adapter ? " · Adapter" : "";
      return {
        id: v.id,
        label: `${name}${naturalTag}${adapterTag}${locale ? " · " + locale : ""}${symbol ? " · " + symbol : ""}`,
        g,
        lang: String(locale).split(/[-_]/)[0].toLowerCase(),
        nativeLanguage: locale,
        natural: !!v.natural,
        adapter: !!v.adapter,
      };
    });
  }

  function ensureProviderOption(value, beforeValues = []) {
    const select = document.querySelector("#provider");
    if (!select || select.querySelector(`option[value="${value}"]`)) return select;
    const option = document.createElement("option");
    option.value = value;
    let before = null;
    for (const candidate of beforeValues) {
      before = select.querySelector(`option[value="${candidate}"]`);
      if (before) break;
    }
    select.insertBefore(option, before);
    return select;
  }

  function ensureHint(provider, id) {
    const cloud = document.querySelector("#cloudFields");
    if (!cloud || document.querySelector("#" + id)) return;
    const field = document.createElement("div");
    field.className = "field";
    field.dataset.p = provider;
    field.innerHTML = `<div class="hint" id="${id}"></div>`;
    cloud.insertBefore(field, cloud.firstChild);
  }

  function patchSettingsPersistence() {
    try {
      if (window.__mpbookWindowsSettingsPatched || typeof saveSettings !== "function") return;
      const originalSaveSettings = saveSettings;
      const patchedSaveSettings = function () {
        originalSaveSettings();
        try {
          const actual = document.querySelector("#provider")?.value || "";
          const saved = JSON.parse(localStorage.getItem("shuoshu.settings") || "{}");
          if (actual === "windows" || actual === "sapi") {
            saved.provider = "kokoro";
            localStorage.setItem("shuoshu.settings", JSON.stringify(saved));
          }
          if (actual === "windows") localStorage.setItem(WINDOWS_PREF_KEY, "1");
          else localStorage.removeItem(WINDOWS_PREF_KEY);
          if (actual === "sapi") localStorage.setItem(SAPI_PREF_KEY, "1");
          else localStorage.removeItem(SAPI_PREF_KEY);
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
          if (cfg.provider === "windows" || cfg.provider === "sapi") cfg.key = "local";
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
          if (provider === "sapi") return 650;
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
        const provider = document.querySelector("#provider")?.value;
        if (provider === "windows" || provider === "sapi") {
          toast(tr(
            "Primero validaremos la reproducción nativa en tu PC. Para exportar por ahora usa Piper, Kokoro o un motor cloud.",
            "Native playback must be validated on your PC first. For export, use Piper, Kokoro, or a cloud engine for now."
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
    const windowsOption = document.querySelector('#provider option[value="windows"]');
    if (windowsOption) windowsOption.textContent = tr("Windows · voces del sistema", "Windows · system voices");

    const sapiOption = document.querySelector('#provider option[value="sapi"]');
    if (sapiOption) sapiOption.textContent = tr("Windows SAPI · Natural", "Windows SAPI · Natural");

    const windowsHint = document.querySelector("#windowsVoiceHint");
    if (windowsHint) {
      windowsHint.textContent = tr(
        "Usa las voces que Windows expone mediante Windows.Media.SpeechSynthesis.",
        "Uses voices exposed through Windows.Media.SpeechSynthesis."
      );
    }

    const sapiHint = document.querySelector("#sapiVoiceHint");
    if (sapiHint) {
      sapiHint.textContent = tr(
        "Usa SAPI 5. Con NaturalVoiceSAPIAdapter instalado, aquí pueden aparecer Jorge, Dalia, Álvaro, Elvira y otras voces Natural importadas.",
        "Uses SAPI 5. With NaturalVoiceSAPIAdapter installed, Jorge, Dalia, Álvaro, Elvira and other imported Natural voices can appear here."
      );
    }

    try { if (PROVIDERS?.windows) PROVIDERS.windows.label = windowsOption?.textContent || "Windows"; } catch (_) {}
    try { if (PROVIDERS?.sapi) PROVIDERS.sapi.label = sapiOption?.textContent || "Windows SAPI"; } catch (_) {}
  }

  async function installProviders() {
    if (typeof PROVIDERS === "undefined") return;

    const [nativeVoices, sapiVoices] = await Promise.all([
      listVoices().catch((err) => { console.warn("MPBook WinRT bridge:", err); return []; }),
      listSapiVoices().catch((err) => { console.warn("MPBook SAPI bridge:", err); return []; }),
    ]);

    if (nativeVoices.length) {
      PROVIDERS.windows = {
        label: "Windows",
        voices: normalizeVoices(nativeVoices, "winrt"),
        models: null,
        synth: (text, cfg) => window.MPBookWindows.synth(text, cfg),
      };
      ensureProviderOption("windows", ["piper", "kokoro", "browser"]);
      ensureHint("windows", "windowsVoiceHint");
    }

    if (sapiVoices.length) {
      PROVIDERS.sapi = {
        label: "Windows SAPI",
        voices: normalizeVoices(sapiVoices, "sapi"),
        models: null,
        synth: (text, cfg) => window.MPBookWindows.synthSapi(text, cfg),
      };
      ensureProviderOption("sapi", ["windows", "piper", "kokoro", "browser"]);
      ensureHint("sapi", "sapiVoiceHint");
    }

    if (!nativeVoices.length && !sapiVoices.length) return;

    patchLocalProvider();
    patchSettingsPersistence();
    patchExportGuard();
    updateLabels();

    const select = document.querySelector("#provider");
    try {
      if (localStorage.getItem(SAPI_PREF_KEY) === "1" && select?.querySelector('option[value="sapi"]')) {
        select.value = "sapi";
      } else if (localStorage.getItem(WINDOWS_PREF_KEY) === "1" && select?.querySelector('option[value="windows"]')) {
        select.value = "windows";
      }
    } catch (_) {}

    try { updateProviderUI(); } catch (_) {}
    try { updateSegLenUI(); } catch (_) {}

    document.addEventListener("click", (event) => {
      if (event.target?.closest?.("#uiLangBtn")) setTimeout(updateLabels, 0);
    });
  }

  installProviders();
})();
