const PIPER_CDN = 'https://cdn.jsdelivr.net/npm/@realtimex/piper-tts-web@1.1.1/+esm';
const KOKORO_CDN = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm';
const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

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
    piperSession = new piper.TtsSession({ voiceId: voice, progress: onProgress });
    await piperSession.waitReady;
    piperVoice = voice;
  } else if (piperVoice !== voice) {
    progress(id, 'loading-voice');
    piperSession.voiceId = voice;
    await piperSession.init();
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
