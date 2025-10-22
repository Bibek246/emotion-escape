// src/mood-mediapipe.v3.js
// Minimal console noise + robust model loading.

import { setMood } from './mood.js';

let landmarker = null;
let running = false;
let neutral = null;
let rafId = 0;

const SAMPLE_MS = 120;   // ~8 FPS inference
const LOCAL_MODEL = `${location.origin}${location.pathname.replace(/\/[^/]*$/, '')}/models/face_landmarker.task?v=1`;
const FALLBACK_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

function logInfo() { /* quiet */ }
function logWarn(...args) { console.warn(...args); }
function logErr(...args) { console.error(...args); }

async function loadFaceLandmarker() {
  // Dynamically import to avoid blocking first paint
  const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.11');

  // Try local model, fallback to Google bucket if needed
  async function tryModel(url) {
    try {
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      return new Uint8Array(bytes);
    } catch (e) {
      return null;
    }
  }

  let modelBytes = await tryModel(LOCAL_MODEL);
  if (!modelBytes) modelBytes = await tryModel(FALLBACK_MODEL);
  if (!modelBytes) throw new Error('Unable to load face_landmarker.task from local or fallback URL');

  const { FaceLandmarker, FilesetResolver, DrawingUtils } = vision;
  const fileset = await FilesetResolver.forVisionTasks(
    // wasm loader root; use the CDN (kept stable)
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.11/wasm'
  );

  landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: modelBytes },
    outputFaceBlendshapes: true,
    runningMode: 'VIDEO',
    numFaces: 1
  });

  logInfo('[MoodAI] Face Landmarker ready.');
  return landmarker;
}

let lastTs = 0;

function analyze(blendshapes) {
  // Simple readout using a few common shapes.
  // You can tune weights per your environment.
  const map = {};
  for (const b of blendshapes) map[b.categoryName] = b.score;

  const smile = (map['mouthSmileLeft'] || 0 + map['mouthSmileRight'] || 0) * 0.5;
  const jaw   = (map['jawOpen'] || 0);
  const brow  = (map['browDownLeft'] || 0 + map['browDownRight'] || 0) * 0.5;

  return { smile, jaw, brow };
}

function toMood({ smile, brow }, base) {
  // Calibrated thresholds around neutral baseline
  const s = smile - base.smile;
  const b = brow  - base.brow;

  if (s > 0.10 && b < 0.05) return 'happy';
  if (b > 0.08 && s < 0.06) return 'stressed';
  return 'calm';
}

export async function enableMoodAI(videoEl) {
  try {
    if (!landmarker) await loadFaceLandmarker();
  } catch (e) {
    logErr('Failed to enable MediaPipe mood AI:', e);
    return false;
  }

  running = true;
  neutral = null;
  lastTs = 0;

  const loop = async (ts) => {
    if (!running) return;
    if (!lastTs || ts - lastTs >= SAMPLE_MS) {
      lastTs = ts;

      const res = landmarker.detectForVideo(videoEl, ts);
      if (res && res.faceBlendshapes && res.faceBlendshapes.length) {
        const vec = analyze(res.faceBlendshapes[0].categories);

        // Capture neutral baseline first 1–2 seconds
        if (!neutral) {
          if (!enableMoodAI._acc) enableMoodAI._acc = { smile:0, brow:0, n:0, t0: performance.now() };
          const a = enableMoodAI._acc;
          a.smile += vec.smile; a.brow += vec.brow; a.n++;
          if (performance.now() - a.t0 > 1200) {
            neutral = { smile: a.smile/a.n, brow: a.brow/a.n };
            enableMoodAI._acc = null;
          }
          setMood('calm');
        } else {
          // Small EMA to stabilize
          if (!enableMoodAI._ema) enableMoodAI._ema = { smile: vec.smile, brow: vec.brow };
          const e = enableMoodAI._ema;
          e.smile = e.smile*0.6 + vec.smile*0.4;
          e.brow  = e.brow *0.6 + vec.brow *0.4;

          setMood(toMood(e, neutral));
        }
      }
    }
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
  return true;
}

export function recalibrateNeutral(){
  neutral = null;
  enableMoodAI._acc = null;
  enableMoodAI._ema = null;
}

export function disableMoodAI(){
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
}
