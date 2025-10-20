// src/mood-mediapipe.v3.js
// Uses MediaPipe Face Landmarker with blendshapes for robust mood detection,
// plus a 1.5s neutral calibration and gentle smoothing/hysteresis.

import { setMood } from './mood.js';

const STATE = {
  enabled: false,
  running: false,
  faceLandmarker: null,
  lastTs: 0,
  calibrated: false,
  calib: { jawOpen0: 0.02, browLower0: 0.02, smile0: 0.02 }, // neutral baselines
  smooth: { happy: 0, stress: 0 },
  mood: 'calm'
};

const ALPHA = 0.25; // EMA smoothing
const SAMPLE_MS = 120; // ~8 fps (lighter on CPU)

// Public API
export async function enableMoodAI(videoEl) {
  if (STATE.enabled) return true;

  try {
    console.info('[MoodAI] v3 init');
    const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.7');
    const { FilesetResolver, FaceLandmarker } = vision;

    const filesetResolver = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.7/wasm'
    );

    // Load model bytes (local -> Google -> pinned CDN)
    const bytes = await loadFirstAvailable([
      new URL('../models/face_landmarker.task', import.meta.url).href + '?v=2',
      'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.7/wasm/face_landmarker.task'
    ]);
    if (!bytes) { console.error('[MoodAI] Could not load model'); return false; }

    STATE.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: { modelAssetBuffer: bytes },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,            // << enable blendshapes
      outputFacialTransformationMatrixes: false,
    });

    console.info('[MoodAI] v3 Face Landmarker ready');
    STATE.enabled = true;

    // Start loop + quick neutral calibration window (~1.5s)
    STATE.calibrated = false;
    STATE.calibSamples = 0;
    STATE.calib = { jawOpen0: 0.0, browLower0: 0.0, smile0: 0.0 };
    loop(videoEl);
    return true;
  } catch (err) {
    console.error('[MoodAI] enable failed:', err);
    return false;
  }
}

export function recalibrateNeutral() {
  // Call to re-learn your neutral face (e.g., lighting changed)
  STATE.calibrated = false;
  STATE.calibSamples = 0;
  STATE.calib = { jawOpen0: 0.0, browLower0: 0.0, smile0: 0.0 };
  console.info('[MoodAI] Neutral recalibration started');
}

// Internal

async function loadFirstAvailable(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      console.info('[MoodAI] Model from', url);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      console.warn('[MoodAI] Model fetch failed', url, e.message || e);
    }
  }
  return null;
}

function loop(videoEl) {
  STATE.running = true;
  const tick = () => {
    if (!STATE.running) return;
    const ts = performance.now();
    if (ts - STATE.lastTs > SAMPLE_MS) {
      detect(videoEl, ts);
      STATE.lastTs = ts;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function detect(videoEl, ts) {
  if (!STATE.faceLandmarker || videoEl.readyState < 2) return;

  const out = STATE.faceLandmarker.detectForVideo(videoEl, ts);
  const lms = out?.faceLandmarks?.[0];
  const blends = out?.faceBlendshapes?.[0]?.categories;

  if (!lms || !blends) {
    // no face → drift to calm
    ema('happy', 0.15); ema('stress', 0.15);
    commitMood();
    return;
  }

  // Read a few reliable blendshape channels (0..1)
  const ch = indexBlend(blends);
  const smile = avg(ch('mouthSmileLeft'), ch('mouthSmileRight'));
  const jawOpen = ch('jawOpen');
  const browLower = avg(ch('browLowererLeft'), ch('browLowererRight'));
  // You can also experiment with: 'lipPressorLeft/Right', 'eyeSquintLeft/Right', 'cheekPuff'

  // Neutral calibration (~1.5s gathering)
  if (!STATE.calibrated) {
    STATE.calibSamples++;
    const n = STATE.calibSamples;
    // online mean
    STATE.calib.jawOpen0  += (jawOpen  - STATE.calib.jawOpen0)  / n;
    STATE.calib.browLower0+= (browLower- STATE.calib.browLower0)/ n;
    STATE.calib.smile0    += (smile    - STATE.calib.smile0)    / n;
    if (n >= 12) { // ~12 samples @ ~8fps ≈ 1.5s
      STATE.calibrated = true;
      console.info('[MoodAI] Neutral calibrated:', STATE.calib);
    }
    // while calibrating, keep calm
    ema('happy', 0.2); ema('stress', 0.2);
    commitMood();
    return;
  }

  // Normalize against neutral baselines
  const smileN   = clamp01(smile    - STATE.calib.smile0    + 0.05);
  const jawOpenN = clamp01(jawOpen  - STATE.calib.jawOpen0  + 0.02);
  const browLowN = clamp01(browLower- STATE.calib.browLower0+ 0.02);

  // Scores (tuned to be responsive but not twitchy)
  // Happy: smiling mouth dominates; a bit of jawOpen helps
  let happyScore  = clamp01( 0.85*smileN + 0.15*jawOpenN );
  // Stressed: brows lowered + lips pressed (proxy via low jaw + browLower)
  let stressScore = clamp01( 0.65*browLowN + 0.35*(1 - jawOpenN) );

  // Smooth with EMA
  ema('happy', happyScore);
  ema('stress', stressScore);

  commitMood();
}

// Helpers

function indexBlend(cats) {
  const map = Object.create(null);
  for (const c of cats) map[c.categoryName] = c.score;
  return (name) => map[name] ?? 0;
}
const avg = (a,b)=> (a+b)/2;

function ema(key, value) {
  STATE.smooth[key] = STATE.smooth[key] + ALPHA * (value - STATE.smooth[key]);
}

function commitMood() {
  const h = STATE.smooth.happy;
  const s = STATE.smooth.stress;

  // Hysteresis: require some margin to flip
  let next = 'calm';
  if (h > 0.50 && h > s + 0.12) next = 'happy';
  else if (s > 0.50 && s > h + 0.10) next = 'stressed';

  if (next !== STATE.mood) {
    STATE.mood = next;
    setMood(next);
    // console.log('[MoodAI] mood ->', next, '(h, s)=', h.toFixed(2), s.toFixed(2));
  }
}

// tiny utils
const clamp01 = v => Math.max(0, Math.min(1, v));
