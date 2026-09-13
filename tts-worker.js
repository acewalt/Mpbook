const PIPER_CDN = 'https://cdn.jsdelivr.net/npm/@realtimex/piper-tts-web@1.1.1/+esm';
const KOKORO_CDN = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm';
const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

// Spanish Piper models are vendored under assets/voices. Piper itself still
// thinks its model base is Hugging Face, so redirect only those known model
// requests to this GitHub Pages site. If a file has not arrived yet (for
// example while the vendor workflow is still running), fall back to upstream.
const LOCAL_PIPER_FILES = new Set([
  'es/es_MX/claude/high/es_MX-claude-high.onnx',
  'es/es_MX/claude/high/es_MX-claude-high.onnx.json',
  'es/es_MX/ald/medium/es_MX-ald-medium.onnx',
  'es/es_MX/ald/medium/es_MX-ald-medium.onnx.json',
  'es/es_ES/davefx/medium/es_ES-davefx-medium.onnx',
  'es/es_ES/davefx/medium/es_ES-davefx-medium.onnx.json',
  'es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx',
  'es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx.json',
  'es/es_ES/mls_10246/low/es_ES-mls_10246-low.onnx',
  'es/es_ES/mls_10246/low/es_ES-mls_10246-low.onnx.json',
  'es/es_ES/mls_9972/low/es_ES-mls_9972-low.onnx',
  'es/es_ES/mls_9972/low/es_ES-mls_9972-low.onnx.json',
  'es/es_ES/carlfm/x_low/es_ES-carlfm-x_low.onnx',
  'es/es_ES/carlfm/x_low/es_ES-carlfm-x_low.onnx.json'
]);

const nativeFetch = self.fetch.bind(self);
self.fetch = async (input, init) => {
  try {
    const sourceUrl = typeof input === 'string' ? input : input?.url;
    const url = new URL(sourceUrl, self.location.href);
    const marker = '/piper-voices/resolve/main/';
    const pos = url.pathname.indexOf(marker);
    if (url.hostname === 'huggingface.co' && pos >= 0) {
      const rel = decodeURIComponent(url.pathname.slice(pos + marker.length));
      if (LOCAL_PIPER_FILES.has(rel)) {
        const localUrl = new URL(`./assets/voices/${rel}`, self.location.href);
        const localResponse = await nativeFetch(localUrl, { ...init, cache: 'force-cache' });
        if (localResponse.ok) return localResponse;
      }
    }
  } catch (err) {
    console.warn('MPBook local voice redirect failed; using upstream.', err);
  }
  return nativeFetch(input, init);
};

// Piper's browser wrapper configures ONNX Runtime with
// navigator.hardwareConcurrency. On desktop machines that can make one TTS
// request fan out across most CPU cores and Chrome may report the page as
// unresponsive even though inference is running in this worker. Shadow the
// value *inside this worker only* so local TTS stays responsive.
(function capWorkerThreads(){
  const one = () => 1;
  try {
    Object.defineProperty(self.navigator, 'hardwareConcurrency', { configurable:true, get:one });
  } catch {}
  try {
    const proto = Object.getPrototypeOf(self.navigator);
    const desc = Object.getOwnPropertyDescriptor(proto, 'hardwareConcurrency');
    if(!desc || desc.configurable) Object.defineProperty(proto, 'hardwareConcurrency', { configurable:true, get:one });
  } catch {}
})();

let piper = null;
let piperSession = null;
let piperVoice = '';
let kokoro = null;
let kokoroPromise = null;

function progress(id, stage, value = null) {
  self.postMessage({ type: 'progress', id, stage, value });
}

function percent(evt) {
  if (Number.isFinite(evt?.progress)) return Math.max(0, Math.min(100, Math.round(evt.progress)));
  if (evt?.total && Number.isFinite(evt?.loaded)) return Math.max(0, Math.min(100, Math.round(evt.loaded * 100 / evt.total)));
  return null;
}

async function getPiper(id, voice) {
  if (!piper) {
    progress(id, 'loading-engine');
    piper = await import(PIPER_CDN);
  }

  const onProgress = evt => progress(id, 'downloading', percent(evt));

  if (!piperSession) {
    progress(id, 'loading-voice');
    piperSession = new piper.TtsSession({
      voiceId: voice,
      progress: onProgress,
      allowLocalModels: true,
      fallbackStrategy: 'cdn'
    });
    await piperSession.waitReady;
    piperVoice = voice;
  } else if (piperVoice !== voice) {
    progress(id, 'loading-voice');
    piperSession.voiceId = voice;
    await piperSession.init(true, 'cdn');
    piperVoice = voice;
  }
  return piperSession;
}

async function getKokoro(id) {
  if (kokoro) return kokoro;
  if (kokoroPromise) return kokoroPromise;

  kokoroPromise = (async () => {
    progress(id, 'loading-engine');
    const mod = await import(KOKORO_CDN);
    progress(id, 'loading-model');
    const instance = await mod.KokoroTTS.from_pretrained(KOKORO_MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: evt => progress(id, 'downloading', percent(evt))
    });
    kokoro = instance;
    return instance;
  })();

  try {
    return await kokoroPromise;
  } catch (err) {
    kokoroPromise = null;
    throw err;
  }
}

async function synthesize({ id, provider, text, voice, rate }) {
  if (!text?.trim()) throw new Error('No text to synthesize');

  if (provider === 'kokoro') {
    const tts = await getKokoro(id);
    progress(id, 'synthesizing');
    const out = await tts.generate(text, { voice, speed: Number(rate) || 1 });
    const blob = out.toBlob();
    self.postMessage({ type: 'result', id, blob });
    return;
  }

  const session = await getPiper(id, voice);
  progress(id, 'synthesizing');
  const blob = await session.predict(text);
  self.postMessage({ type: 'result', id, blob });
}

self.addEventListener('message', async event => {
  const msg = event.data || {};
  if (msg.type !== 'synthesize') return;
  try {
    await synthesize(msg);
  } catch (err) {
    self.postMessage({
      type: 'error',
      id: msg.id,
      message: String(err?.message || err),
      stack: err?.stack || ''
    });
  }
});