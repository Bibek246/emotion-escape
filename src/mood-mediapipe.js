// src/mood-mediapipe.js
// Robust MediaPipe Face Landmarker loader with local + stable CDN fallbacks.
// Loads the model as BYTES (modelAssetBuffer) to avoid fragile URL/path issues.

import { setMood } from './mood.js';

const STATE = { enabled:false, faceLandmarker:null, running:false, smoothMood:'calm', lastTs:0 };
let emaHappy = 0, emaStress = 0;
const ALPHA = 0.25; // smoothing

export async function enableMoodAI(videoEl) {
  if (STATE.enabled) return true;

  try {
    // Use a pinned Tasks Vision version to avoid "latest" breakage.
    const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.7');
    const { FilesetResolver, FaceLandmarker } = vision;

    // WASM core from the same pinned version.
    const filesetResolver = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.7/wasm'
    );

    // Try local file first (recommended), then stable Google storage, then pinned jsDelivr.
    const modelUrls = [
      // 1) Local file you can commit to your repo:
      //    models/face_landmarker.task
      new URL('../models/face_landmarker.task', import.meta.url).href,
      // 2) Official Google-hosted public model (stable):
      'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      // 3) Pinned CDN fallback:
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.7/wasm/face_landmarker.task'
    ];

    const bytes = await loadFirstAvailable(modelUrls);
    if (!bytes) {
      console.warn('[MoodAI] Could not fetch any Face Landmarker model URL.');
      return false;
    }

    STATE.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: { modelAssetBuffer: bytes }, // <- robust: use bytes, not a path
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });

    console.info('[MoodAI] Face Landmarker ready');
    STATE.enabled = true;
    loop(videoEl);
    return true;
  } catch (err) {
    console.warn('Failed to enable MediaPipe mood AI:', err);
    return false;
  }
}

async function loadFirstAvailable(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url);
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
    if (ts - STATE.lastTs > 100) { tryDetect(videoEl, ts); STATE.lastTs = ts; } // ~10 fps
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function tryDetect(videoEl, ts) {
  if (!STATE.faceLandmarker || videoEl.readyState < 2) return;

  const res = STATE.faceLandmarker.detectForVideo(videoEl, ts);
  const lms = res?.faceLandmarks?.[0];
  if (!lms) { // decay to calm when face lost
    emaHappy = lerp(emaHappy, 0.15, 0.05);
    emaStress = lerp(emaStress, 0.15, 0.05);
    updateMood();
    return;
  }

  // Landmarks → features
  const LM = (i) => lms[i];
  const dx = dist(LM(61), LM(291));            // mouth width
  const mouthOpen = Math.abs(LM(13).y - LM(14).y);
  const browRaise = Math.abs(LM(105).y - LM(159).y);
  const faceW = dist(LM(33), LM(263)) + 1e-6;

  const smileRatio = (dx / faceW) / (mouthOpen / faceW + 1e-6);

  let happyScore  = clamp01((smileRatio - 1.5) / 0.6);
  let stressScore = clamp01(((0.02 - mouthOpen) / 0.02) * 0.6 + ((0.02 - browRaise) / 0.02) * 0.4);

  // Smooth (EMA)
  emaHappy  = emaHappy  + ALPHA * (happyScore  - emaHappy);
  emaStress = emaStress + ALPHA * (stressScore - emaStress);

  updateMood();
}

function updateMood() {
  let mood = 'calm';
  if (emaHappy > 0.55 && emaHappy > emaStress + 0.15) mood = 'happy';
  else if (emaStress > 0.55 && emaStress > emaHappy + 0.10) mood = 'stressed';
  if (STATE.smoothMood !== mood) { STATE.smoothMood = mood; setMood(mood); }
}

// utils
const dist = (a,b)=>Math.hypot(a.x-b.x, a.y-b.y);
const clamp01 = (v)=>Math.max(0, Math.min(1, v));
const lerp = (a,b,t)=>a+(b-a)*t;
