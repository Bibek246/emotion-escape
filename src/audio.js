// Minimal WebAudio helper — no external assets needed
let ctx, master, sfxGain, musicGain, musicNode, audioEnabled = false;

export async function enableAudio() {
  if (audioEnabled) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  sfxGain = ctx.createGain(); sfxGain.gain.value = 0.8; sfxGain.connect(master);
  musicGain = ctx.createGain(); musicGain.gain.value = 0.0; musicGain.connect(master);
  audioEnabled = true;
}

export function setMusic(on) {
  if (!audioEnabled) return;
  if (on) {
    if (!musicNode) {
      // simple synthesized loop (triangle bass + slow LFO filter)
      const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 100;
      const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 400;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.15;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 180;
      lfo.connect(lfoGain).connect(filt.frequency);
      osc.connect(filt).connect(musicGain);
      osc.start(); lfo.start();
      musicNode = { osc, lfo, filt };
    }
    ramp(musicGain.gain, 0.25, 0.5);
  } else {
    ramp(musicGain.gain, 0.0, 0.5);
  }
}

export function jumpSfx() { beep(520, 0.06); }
export function coinSfx() { beep(880, 0.05); }
export function hitSfx()  { noise(0.2); }

function beep(freq, dur=0.08) {
  if (!audioEnabled) return;
  const o = ctx.createOscillator(); o.type='sine'; o.frequency.value=freq;
  const g = ctx.createGain(); g.gain.value = 0.0;
  o.connect(g).connect(sfxGain);
  o.start();
  ramp(g.gain, 0.7, 0.02);
  ramp(g.gain, 0.0, dur);
  o.stop(ctx.currentTime + dur + 0.05);
}

function noise(dur=0.2) {
  if (!audioEnabled) return;
  const buff = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const data = buff.getChannelData(0);
  for (let i=0;i<data.length;i++) data[i] = (Math.random()*2-1) * Math.pow(1 - i/data.length, 2);
  const src = ctx.createBufferSource(); src.buffer = buff;
  const g = ctx.createGain(); g.gain.value=0.7;
  src.connect(g).connect(sfxGain);
  src.start();
  ramp(g.gain, 0.0, dur);
}

function ramp(param, value, time) {
  const t = ctx.currentTime;
  param.cancelScheduledValues(t);
  param.linearRampToValueAtTime(value, t + Math.max(0.01, time));
}

export function isAudioEnabled(){ return audioEnabled; }
