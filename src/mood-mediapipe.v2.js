// Robust loader: local -> Google-hosted -> pinned CDN
// Loads the model as BYTES (modelAssetBuffer), so no fragile URL paths.

import { setMood } from './mood.js';

const STATE = { enabled:false, faceLandmarker:null, running:false, smoothMood:'calm', lastTs:0 };
let emaHappy = 0, emaStress = 0;
const ALPHA = 0.25;

export async function enableMoodAI(videoEl) {
  if (STATE.enabled) return true;

  try {
    console.info('[MoodAI] init start. File:', import.meta.url);

    // Pin version (DO NOT use "latest")
    const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.7');
    const { FilesetResolver, FaceLandmarker } = vision;

    const filesetResolver = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.7/wasm'
    );

    // Try local first, then Google, then pinned jsDelivr
    const modelUrls = [
      new URL('../models/face_landmarker.task', import.meta.url).href + '?v=1',
      'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.7/wasm/face_landmarker.task'
    ];

    const bytes = await loadFirstAvailable(modelUrls);
    if (!bytes) {
      console.error('[MoodAI] Failed to fetch any Face Landmarker model.');
      return false;
    }

    STATE.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: { modelAssetBuffer: bytes }, // <- use bytes, not a URL
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });

    console.info('[MoodAI] Face Landmarker ready.');
    STATE.enabled = true;
    loop(videoEl);
    return true;
  } catch (err) {
    console.error('Failed to enable MediaPipe mood AI:', err);
    return false;
  }
}

async function loadFirstAvailable(urls) {
  for (const url of urls) {
    try {
      console.info('[MoodAI] Trying model URL:', url);
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      console.info('[MoodAI] Model loaded from', url);
      return new Uint8Array(buf);
    } catch (e) {
      console.warn('[MoodAI] Model fetch failed for', url, e.message || e);
    }
  }
  return null;
}

function loop(videoEl) {
  STATE.running = true;
  const tick = () => {
    if (!STATE.running) return;
    const ts = performance.now();
    if (ts - STATE.lastTs > 100) { tryDetect(videoEl, ts); STATE.lastTs = ts; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function tryDetect(videoEl, ts) {
  if (!STATE.faceLandmarker || videoEl.readyState < 2) return;

  const res = STATE.faceLandmarker.detectForVideo(videoEl, ts);
  const lms = res?.faceLandmarks?.[0];
  if (!lms) { emaHappy = lerp(emaHappy, 0.15, 0.05); emaStress = lerp(emaStress, 0.15, 0.05); updateMood(); return; }

  const LM = (i) => lms[i];
  const dx = Math.hypot(LM(61).x - LM(291).x, LM(61).y - LM(291).y);
  const mouthOpen = Math.abs(LM(13).y - LM(14).y);
  const browRaise = Math.abs(LM(105).y - LM(159).y);
  const faceW = Math.hypot(LM(33).x - LM(263).x, LM(33).y - LM(263).y) + 1e-6;

  const smileRatio = (dx / faceW) / (mouthOpen / faceW + 1e-6);
  let happyScore  = clamp01((smileRatio - 1.5) / 0.6);
  let stressScore = clamp01(((0.02 - mouthOpen) / 0.02) * 0.6 + ((0.02 - browRaise) / 0.02) * 0.4);

  emaHappy  = emaHappy  + ALPHA * (happyScore  - emaHappy);
  emaStress = emaStress + ALPHA * (stressScore - emaStress);

  updateMood();
}

function updateMood() {
  let mood = 'calm';
  if (emaHappy > 0.55 && emaHappy > emaStress + 0.15) mood = 'happy';
  else if (emaStress > 0.55 && emaStress > emaHappy + 0.10) mood = 'stressed';
  setMood(mood);
}

const clamp01 = (v)=>Math.max(0, Math.min(1, v));
const lerp = (a,b,t)=>a+(b-a)*t;
