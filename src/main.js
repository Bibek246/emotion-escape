// src/main.js
// Canvas game loop with responsive scaling, mobile controls, skins, and mood-based worlds.

import { enableAudio, setMusic, jumpSfx, coinSfx, hitSfx, isAudioEnabled } from './audio.js';
import { getMood, onMoodChange } from './mood.js';

// ---------- Canvas / DOM ----------
const canvas = document.getElementById('canvas');
const scoreEl = document.getElementById('score');
const hiEl = document.getElementById('hiscore');
const ctx = canvas.getContext('2d'); // safer across GPUs

// Virtual resolution (physics/render space). We scale this to fit the screen.
const VW = 1024, VH = 576;

// Responsive scaling
let scale = 1, dpr = Math.max(1, window.devicePixelRatio || 1);
function resizeCanvasToFit() {
  dpr = Math.max(1, window.devicePixelRatio || 1);

  // Size available for the canvas element
  const wrap = canvas.parentElement;
  const cw = wrap.clientWidth;
  const ch = Math.max(220, window.innerHeight - wrap.getBoundingClientRect().top - 24);

  const s = Math.min(cw / VW, ch / VH);
  scale = Math.max(0.5, Math.min(2.0, s));

  const cssW = Math.round(VW * scale);
  const cssH = Math.round(VH * scale);

  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width  = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);

  // Map our virtual coords → device pixels
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
}
export function requestCanvasResize(){ resizeCanvasToFit(); }

// ---------- Core State ----------
let playing = false, paused = false;

// Emit state so mobile UI can hide/show the menu
function emitState() {
  window.dispatchEvent(new CustomEvent('ee:state', {
    detail: { playing, paused }
  }));
}

let tPrev = performance.now();
let score = 0, hiScore = Number(localStorage.getItem('emotionEscapeHi')||0);
hiEl.textContent = hiScore.toString();

const keys = new Set();
window.addEventListener('keydown', e => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'arrowup' || k === 'w') player.jumpBuf = 0.18; // jump buffer
}, { passive:false });

// Pause when tab is hidden
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { paused = true; emitState(); }
});

// Mobile touch state
let touchLeft = false, touchRight = false;

// Expose hooks to wire mobile controls from index.html
export function setMobileInputHandlers({ leftEl, rightEl, jumpEl, canvasEl }) {
  const press = (setter, val) => (e) => { e.preventDefault(); setter(val); };
  const attach = (el, setter, valDown, valUp) => {
    if (!el) return;
    el.addEventListener('touchstart', press(setter, valDown), {passive:false});
    el.addEventListener('touchend',   press(setter, valUp),   {passive:false});
    el.addEventListener('touchcancel',press(setter, valUp),   {passive:false});
    el.addEventListener('mousedown',  press(setter, valDown));
    el.addEventListener('mouseup',    press(setter, valUp));
    el.addEventListener('mouseleave', press(setter, valUp));
  };

  attach(leftEl,  v => touchLeft=v,  true,  false);
  attach(rightEl, v => touchRight=v, true,  false);

  if (jumpEl){
    // Jump is a buffer, not a hold
    const j = (e)=>{ e.preventDefault(); player.jumpBuf = 0.18; };
    jumpEl.addEventListener('touchstart', j, {passive:false});
    jumpEl.addEventListener('mousedown',  j);
  }

  if (canvasEl){
    // Tap to start, swipe up to jump
    let startY = null;
    canvasEl.addEventListener('touchstart', (e)=>{
      if (!playing) startGame();
      startY = e.changedTouches[0].clientY;
    }, {passive:true});
    canvasEl.addEventListener('touchend', (e)=>{
      if (startY!==null) {
        const dy = startY - e.changedTouches[0].clientY;
        if (dy > 28) player.jumpBuf = 0.18; // swipe up
        startY = null;
      }
    }, {passive:true});
  }
}

// Screen shake
let shakeTime = 0, shakeMag = 0;
let animT = 0;

// Skins
let SKIN = 'robot';
let RANDOMIZE_SKIN = false;
export function setSkin(name){
  const valid = ['robot','ninja','cat','astronaut','slime','wizard'];
  SKIN = valid.includes(name) ? name : 'robot';
}
export function setRandomizeSkin(enabled){ RANDOMIZE_SKIN = !!enabled; }

// Player physics
const player = {
  x: 160, y: 0, w: 46, h: 52, vx: 0, vy: 0,
  onGround: false, jumpsLeft: 2,
  coyote: 0, jumpBuf: 0,
  trail: []
};

// World
let groundY = VH - 96;
let speed = 320;
let gravity = 1520;
let obstacles = []; // {type:'block'|'drone'|'gate', x,y,w,h,r,vy,angle}
let coins = [];
let decor = [];          // parallax hills / mood scenery
let particles = [];      // generic particles
let moodFX = {           // mood-specific FX (clouds/stars/rain)
  clouds: [],
  stars: [],
  rain: []
};

let timeSinceSpawn = 0;
let runTime = 0;

// ---------- Mood Params (with difficulty) ----------
function moodParams(mood = getMood()){
  if (mood === 'happy')   return {
    sky:'#69e1ff', ground:'#16a34a', fog:0.03, accent:'#7bdcff',
    speedBase:300, grav:1480,
    spawnRateBase:1.1, gapBias:+40, coinRate:1.5, droneRate:0.18, pillarRate:0.46,
  };
  if (mood === 'stressed')return {
    sky:'#1a2a3a', ground:'#0f5132', fog:0.10, accent:'#ff7b88',
    speedBase:360, grav:1560,
    spawnRateBase:0.82, gapBias:-20, coinRate:0.85, droneRate:0.33, pillarRate:0.40,
  };
  return {
    sky:'#259eff', ground:'#0a5', fog:0.05, accent:'#66e0ff',
    speedBase:330, grav:1520,
    spawnRateBase:0.95, gapBias:+10, coinRate:1.0, droneRate:0.25, pillarRate:0.45,
  };
}

// ---------- Public API ----------
export function initGame(){
  resizeCanvasToFit();
  resetGame();
  requestAnimationFrame(loop);
  onMoodChange(()=>{ buildMoodScenery(); });
}

export function startGame(){
  if (RANDOMIZE_SKIN) {
    const options = ['robot','ninja','cat','astronaut','slime','wizard'];
    const choice = options[(Math.random()*options.length)|0];
    setSkin(choice);
    localStorage.setItem('ee_skin', SKIN);
    const sel = document.getElementById('skinSelect'); if (sel) sel.value = SKIN;
  }

  obstacles.length = 0; coins.length = 0; decor.length = 0; particles.length = 0;
  runTime = 0; timeSinceSpawn = 0;
  buildMoodScenery();
  resetRound();
  playing = true; paused = false;
  emitState();
}
export function pauseGame(){ paused = !paused; emitState(); }
export function resetGame(){
  playing=false; paused=false;
  obstacles.length = 0; coins.length=0; decor.length=0; particles.length=0;
  runTime=0; score=0; timeSinceSpawn=0; shakeTime=0; shakeMag=0; animT=0;
  buildMoodScenery();
  resetRound(); draw();
  emitState();
}
function resetRound(){
  const p = moodParams();
  speed = p.speedBase; gravity = p.grav;
  player.x = 160; player.y = groundY - player.h;
  player.vx = 0; player.vy = 0; player.onGround=true;
  player.jumpsLeft = 2; player.coyote = 0; player.jumpBuf = 0; player.trail = [];
  score = 0;
}

// Audio toggles
export async function setAudioEnabled(on){ if (on && !isAudioEnabled()) await enableAudio(); }
export function setMusicEnabled(on){ setMusic(on); }

// ---------- Loop ----------
function loop(ts){
  const dt = Math.min(0.033, (ts - tPrev)/1000); tPrev = ts;
  if (playing && !paused) update(dt);
  draw();
  requestAnimationFrame(loop);
}

function update(dt){
  runTime += dt; animT += dt;
  score += dt * 2.0; scoreEl.textContent = Math.floor(score).toString();

  const mood = moodParams(); gravity = mood.grav;

  // Difficulty ramp (soft)
  speed += dt * 0.8;

  handlePlayer(dt);
  spawnLogic(dt, mood);
  moveWorld(dt, mood);
  updateMoodFX(dt, mood);
  handleCollisions();
  updateParticles(dt);

  obstacles = obstacles.filter(o => (o.x + (o.w||0) > -180) && (o.y < VH + 400));
  coins = coins.filter(c => (c.x + c.r > -160));
  decor = decor.filter(d => (d.x + d.w > -120));
  particles = particles.filter(p => p.t < p.lifespan);
}

// ---------- Player & Gameplay ----------
function handlePlayer(dt){
  const left = keys.has('arrowleft') || keys.has('a') || touchLeft;
  const right = keys.has('arrowright') || keys.has('d') || touchRight;

  const accel = 1400, maxvx = 260;
  player.vx += ((right?1:0)-(left?1:0)) * accel * dt;
  player.vx *= (player.onGround ? 0.88 : 0.98);
  player.vx = clamp(player.vx, -maxvx, maxvx);

  player.trail.unshift({x: player.x, y: player.y});
  if (player.trail.length>10) player.trail.pop();

  player.coyote = player.onGround ? 0.18 : Math.max(0, player.coyote - dt);
  player.jumpBuf = Math.max(0, player.jumpBuf - dt);

  if (player.jumpBuf > 0) {
    if (player.onGround || player.coyote > 0) {
      doJump(-700); sparkle(player.x+player.w/2, player.y+player.h, moodParams().accent, 10);
      player.onGround = false; player.coyote = 0; player.jumpsLeft = 1; player.jumpBuf = 0;
    } else if (player.jumpsLeft > 0) {
      doJump(-650); sparkle(player.x+player.w/2, player.y+player.h/2, '#ffd34d', 8);
      player.jumpsLeft = 0; player.jumpBuf = 0;
    }
  }

  player.vy += gravity * dt;
  player.x += player.vx * dt;
  player.y += player.vy * dt;

  const floorY = groundY - player.h;
  if (player.y >= floorY) {
    if (!player.onGround && player.vy > 300) { landThump(); dust(player.x+player.w/2, groundY, 8); }
    player.y = floorY; player.vy = 0; player.onGround = true; player.jumpsLeft = 2;
  } else player.onGround = false;

  player.x = clamp(player.x, 20, VW-80);
}

function spawnLogic(dt, mood){
  timeSinceSpawn += dt;
  const base = mood.spawnRateBase;
  const rate = clamp(base - runTime*0.006, 0.55, 1.15);
  if (timeSinceSpawn >= rate) {
    timeSinceSpawn = 0;
    const r = Math.random();
    if (r < mood.pillarRate) spawnBlockPattern(mood);
    else if (r < mood.pillarRate + mood.droneRate) spawnDrone(mood);
    else spawnGapWithBridge(mood);
    if (Math.random() < 0.75*mood.coinRate) spawnCoinsArc();
  }
  if (Math.random() < 0.08) addParallaxHill();
}

function spawnBlockPattern(mood){
  const minW = 50, maxW = 92;
  const space = (getMood()==='happy') ? 140 : 120;
  const baseH = 50 + Math.floor(Math.random()*110);
  if (Math.random() < 0.65) {
    obstacles.push({type:'block', x: VW+40, y: groundY - baseH, w: minW + Math.random()*(maxW-minW), h: baseH});
  } else {
    const h1 = baseH, h2 = clamp(baseH + (Math.random()<0.5? -24: +24), 60, 160);
    const w = minW + Math.random()*(maxW-minW);
    obstacles.push({type:'block', x: VW+20, y: groundY - h1, w, h: h1});
    obstacles.push({type:'block', x: VW+20 + space, y: groundY - h2, w, h: h2});
  }
}
function spawnDrone(){
  const r = 22 + Math.random()*10;
  const y = groundY - (140 + Math.random()*200);
  const vy = (getMood()==='stressed' ? 100 : 70) + Math.random()*70;
  obstacles.push({type:'drone', x: VW+80, y, r, vy, phase: Math.random()*Math.PI*2, angle: 0});
}
function spawnGapWithBridge(mood){
  const gap = 160 + Math.random()*90 + (mood.gapBias||0);
  const w = 28 + Math.random()*28;
  const h = 50 + Math.random()*80;
  obstacles.push({type:'block', x: VW+20, y: groundY - h, w, h});
  obstacles.push({type:'block', x: VW+20 + w + gap, y: groundY - h*0.72, w, h: h*0.72});
  if (Math.random() < (getMood()==='happy' ? 0.18 : 0.28)){
    const gateH = 12, gateW = 140 + Math.random()*120;
    const gy = groundY - (200 + Math.random()*120);
    obstacles.push({type:'gate', x: VW+20 + 80, y: gy, w: gateW, h: gateH});
  }
}
function spawnCoinsArc(){
  const cx = VW + 60, cy = groundY - (120 + Math.random()*120);
  const n = 5 + Math.floor(Math.random()*4), r = 9;
  for (let i=0;i<n;i++){
    const x = cx + i*28; const y = cy - Math.sin(i/(n-1)*Math.PI) * 46;
    coins.push({x, y, r, worth: (Math.random()<0.12? 5:1), t: Math.random()*Math.PI*2});
  }
}
function addParallaxHill(){
  const y = VH - (40 + Math.random()*120);
  const w = 120 + Math.random()*200, h = 60 + Math.random()*120;
  decor.push({x: VW + Math.random()*400, y, w, h, speed: speed*(0.25+Math.random()*0.3), shade: `rgba(25,40,70,${0.2+Math.random()*0.2})`});
}
function moveWorld(dt){
  decor.forEach(d => d.x -= d.speed * dt);
  obstacles.forEach(o => {
    if (o.type==='block' || o.type==='gate') o.x -= speed * dt;
    else { o.x -= speed * dt; o.phase += dt; o.y += Math.sin(o.phase*2.2) * o.vy * dt; o.angle += dt * 6.0; }
  });
  coins.forEach(c => { c.x -= speed * dt; c.t += dt*4; });
}

function handleCollisions(){
  for (const o of obstacles) {
    if (o.type==='block' || o.type==='gate'){ if (rectOverlap(player, o)) return gameOver(); }
    else if (o.type==='drone'){ if (circleRectOverlap({x:o.x,y:o.y,r:o.r}, player)) return gameOver(); }
  }
  for (const c of coins) {
    if (circleRectOverlap(c, player)) { score += c.worth; coinSfx(); sparkle(c.x, c.y, '#ffd34d', 12); c.x = -9999; shake(60, 0.08); }
  }
}

function doJump(vy){ player.vy = vy; jumpSfx(); shake(40, 0.06); }
function landThump(){ shake(100, 0.08); }
function gameOver(){
  playing = false; hitSfx(); shake(260, 0.25);
  hiScore = Math.max(hiScore, Math.floor(score));
  localStorage.setItem('emotionEscapeHi', hiScore); hiEl.textContent = hiScore.toString();
  emitState();
}

// ---------- Particles ----------
function sparkle(x,y,color='#fff', n=8){
  for (let i=0;i<n;i++) particles.push({x,y, vx:(Math.random()*2-1)*120, vy:(Math.random()*2-1)*120, r:2+Math.random()*2, color, t:0, lifespan:0.35+Math.random()*0.2});
}
function dust(x,y,n=6){
  for (let i=0;i<n;i++) particles.push({x,y, vx:(Math.random()*2-1)*80, vy:-Math.random()*120, r:2+Math.random()*3, color:'rgba(60,80,100,0.6)', t:0, lifespan:0.4+Math.random()*0.3});
}
function updateParticles(dt){ particles.forEach(p=>{ p.t+=dt; p.vy+=900*dt; p.x+=p.vx*dt; p.y+=p.vy*dt; p.r*=0.98; }); }

// ---------- Mood Scenery ----------
function buildMoodScenery(){
  decor.length = 0;
  moodFX.clouds.length = 0;
  moodFX.stars.length = 0;
  moodFX.rain.length = 0;

  for (let i=0;i<18;i++) addParallaxHill();

  if (getMood() === 'happy'){
    for (let i=0;i<10;i++){
      moodFX.clouds.push({
        x: Math.random()*VW, y: 60+Math.random()*160,
        w: 80+Math.random()*140, h: 36+Math.random()*24,
        speed: 20+Math.random()*18, kind: (Math.random()<0.15?'balloon':'cloud'),
        hue: 20+Math.random()*40
      });
    }
  } else if (getMood() === 'calm'){
    for (let i=0;i<90;i++){
      moodFX.stars.push({
        x: Math.random()*VW, y: Math.random()*(VH*0.6),
        r: Math.random()*1.6+0.4, tw: Math.random()*Math.PI*2
      });
    }
  } else {
    for (let i=0;i<90;i++){
      moodFX.rain.push({
        x: Math.random()*VW, y: Math.random()*VH,
        vx: -60, vy: 420+Math.random()*240, len: 12+Math.random()*18, t: Math.random()*2
      });
    }
  }
}

function updateMoodFX(dt){
  if (getMood() === 'happy'){
    moodFX.clouds.forEach(c=>{
      c.x -= (c.speed + speed*0.08) * dt;
      if (c.x < -c.w-40) { c.x = VW+60; c.y = 60+Math.random()*160; }
    });
  } else if (getMood() === 'calm'){
    moodFX.stars.forEach(s=> s.tw += dt*3);
  } else {
    moodFX.rain.forEach(r=>{
      r.x += r.vx*dt; r.y += r.vy*dt;
      if (r.y > VH+40) { r.y = -20; r.x = Math.random()*VW; }
    });
  }
}

// ---------- Drawing ----------
function draw(){
  // Ensure transform is set each frame (in case DPR/scale changed)
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  ctx.clearRect(0,0,VW,VH);

  let ox=0, oy=0;
  if (shakeTime>0){
    shakeTime -= 1/60;
    const m = shakeMag * (shakeTime*6) / (1+shakeTime*6);
    ox=(Math.random()*2-1)*m; oy=(Math.random()*2-1)*m;
  }

  const p = moodParams(getMood());

  if (getMood()==='happy')     drawHappyBG(p);
  else if (getMood()==='stressed') drawStressedBG(p);
  else                         drawCalmBG(p);

  // Parallax hills
  decor.forEach(d=>{
    ctx.fillStyle=d.shade;
    ctx.beginPath();
    ctx.ellipse(d.x+ox, d.y+oy, d.w, d.h, 0, 0, Math.PI, true);
    ctx.fill();
  });

  // Ground
  ctx.fillStyle = p.ground; ctx.fillRect(0, groundY, VW, VH-groundY);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let x=((Date.now()/12)%40)*-1; x<VW; x+=40) ctx.fillRect(x, groundY+24, 20, 12);

  // Coins
  coins.forEach(c=> drawStarCoin(c.x+ox,c.y+oy,c.r,c.t));

  // Obstacles
  for (const o of obstacles){
    if (o.type==='block') drawPillar(o.x+ox,o.y+oy,o.w,o.h);
    else if (o.type==='gate') drawLaserGate(o.x+ox,o.y+oy,o.w,o.h);
    else drawSaw(o.x+ox,o.y+oy,o.r,o.angle||0);
  }

  // Particles
  particles.forEach(p=>{
    const a = 1 - (p.t / p.lifespan);
    let col = p.color;
    if (col.startsWith('rgb(')) col = col.replace('rgb(', 'rgba(').replace(')', `,${Math.max(0,a).toFixed(2)})`);
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x,p.y,Math.max(0.5,p.r),0,Math.PI*2); ctx.fill();
  });

  // Shadow
  const shw = player.w*0.9, shy = groundY+6;
  const shR = mapRange(player.y, groundY-220, groundY-player.h, 4, 10);
  ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(player.x+player.w/2,shy,shw/2,shR,0,0,Math.PI*2); ctx.fill();

  // Motion ghost
  for (let i=player.trail.length-1;i>=0;i--){
    const t = player.trail[i]; const a = i/player.trail.length;
    drawSkinnedRunner(t.x, t.y, player.w, player.h, player.onGround, animT - i*0.03, 0.55*a, true);
  }

  // Player
  drawSkinnedRunner(player.x, player.y, player.w, player.h, player.onGround, animT, 1, false);

  if (!playing){
    ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillRect(0,0,VW,VH);
    ctx.fillStyle='#fff'; ctx.font='48px system-ui'; ctx.fillText('Emotion Escape', VW/2-180, VH/2-60);
    ctx.font='20px system-ui';
    ctx.fillText('Press Start to Play — Double Jump enabled', VW/2-200, VH/2-20);
    ctx.fillText('1=Happy  2=Calm  3=Stressed (affects difficulty/visuals)', VW/2-250, VH/2+10);
  }
}

// ---------- BG Renderers ----------
function drawHappyBG(p){
  const g = ctx.createLinearGradient(0,0,0,VH);
  g.addColorStop(0, '#baf2ff'); g.addColorStop(1, '#5fb9ff');
  ctx.fillStyle = g; ctx.fillRect(0,0,VW,VH);
  // sun
  ctx.fillStyle = 'rgba(255,245,140,0.9)'; ctx.beginPath(); ctx.arc(VW*0.82, 90, 50, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = 'rgba(255,245,140,0.25)'; ctx.beginPath(); ctx.arc(VW*0.82, 90, 90, 0, Math.PI*2); ctx.fill();
  // clouds & balloons
  moodFX.clouds.forEach(c=>{ if (c.kind==='cloud') drawCloud(c.x, c.y, c.w, c.h); else drawBalloon(c.x, c.y, c.hue); });
}
function drawCalmBG(){
  const g = ctx.createLinearGradient(0,0,0,VH);
  g.addColorStop(0, '#0b1d3a'); g.addColorStop(1, '#1d3f6e');
  ctx.fillStyle = g; ctx.fillRect(0,0,VW,VH);
  // moon
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(VW*0.86, 80, 24, 0, Math.PI*2); ctx.fill();
  // stars
  moodFX.stars.forEach(s=>{
    const tw = 0.6 + Math.sin(s.tw)*0.4;
    ctx.fillStyle = `rgba(255,255,210,${0.4+0.6*tw})`;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r*tw, 0, Math.PI*2); ctx.fill();
  });
}
function drawStressedBG(){
  const g = ctx.createLinearGradient(0,0,0,VH);
  g.addColorStop(0, '#08131f'); g.addColorStop(1, '#0f2234');
  ctx.fillStyle = g; ctx.fillRect(0,0,VW,VH);
  // lightning flash
  if (Math.random()<0.004){ ctx.fillStyle='rgba(220,240,255,0.25)'; ctx.fillRect(0,0,VW,VH*0.7); }
  // rain
  ctx.strokeStyle = 'rgba(180,200,220,0.35)'; ctx.lineWidth = 2; ctx.beginPath();
  moodFX.rain.forEach(r=>{ ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + r.vx*0.06, r.y + r.len); });
  ctx.stroke();
}
function drawCloud(x,y,w,h){
  ctx.fillStyle='rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.ellipse(x,y,w*0.4,h*0.6,0,0,Math.PI*2);
  ctx.ellipse(x+w*0.25,y-8,w*0.35,h*0.55,0,0,Math.PI*2);
  ctx.ellipse(x-w*0.25,y-6,w*0.32,h*0.5,0,0,Math.PI*2);
  ctx.fill();
}
function drawBalloon(x,y,hue){
  ctx.strokeStyle='rgba(60,60,70,0.6)'; ctx.lineWidth=1.5; ctx.beginPath();
  ctx.moveTo(x,y+18); ctx.quadraticCurveTo(x-6,y+32,x-10,y+46); ctx.stroke();
  ctx.fillStyle = `hsl(${hue} 90% 60% / 0.95)`; ctx.beginPath(); ctx.ellipse(x,y,10,14,0,0,Math.PI*2); ctx.fill();
}

// ---------- Character renderers (6 skins) ----------
function drawSkinnedRunner(x,y,w,h,onGround,t,a=1,ghost=false){
  const accent = moodParams().accent;
  switch (SKIN){
    case 'ninja':     return drawNinja(x,y,w,h,onGround,t,a,accent,ghost);
    case 'cat':       return drawCat(x,y,w,h,onGround,t,a,accent,ghost);
    case 'astronaut': return drawAstronaut(x,y,w,h,onGround,t,a,accent,ghost);
    case 'slime':     return drawSlime(x,y,w,h,onGround,t,a,accent,ghost);
    case 'wizard':    return drawWizard(x,y,w,h,onGround,t,a,accent,ghost);
    default:          return drawRobot(x,y,w,h,onGround,t,a,accent,ghost);
  }
}
function drawRobot(x,y,w,h,onGround,t,a,accent,ghost){
  roundRect(x,y,w,h,10,`rgba(240,244,255,${a})`,true);
  ctx.fillStyle = `rgba(30,40,56,${0.9*a})`; roundRect(x+w*0.53,y+6,w*0.36,18,6,ctx.fillStyle,true);
  ctx.fillStyle = `${toRgba(accent,0.35*a)}`; ctx.fillRect(x+6,y+11,w-12,9);
  ctx.fillStyle = `${toRgba(accent,0.6*a)}`; ctx.fillRect(x+w*0.53+4,y+9,w*0.36-8,10);
  legLines(x,y,w,h,onGround,t,a, 'rgba(80,100,130,'); if (!ghost) outline(x,y,w,h,10);
}
function drawNinja(x,y,w,h,onGround,t,a,accent,ghost){
  roundRect(x,y,w,h,10,`rgba(20,22,30,${a})`,true);
  ctx.fillStyle = `${toRgba(accent,0.9*a)}`; ctx.fillRect(x+6,y+12,w-12,7);
  ctx.fillStyle = `${toRgba(accent,0.7*a)}`;
  ctx.beginPath(); ctx.moveTo(x+w*0.6, y+10); ctx.lineTo(x+w*0.9, y+4+Math.sin(t*8)*2); ctx.lineTo(x+w*0.86, y+14); ctx.closePath(); ctx.fill();
  roundRect(x+w*0.25,y+12,w*0.5,9,4,`rgba(255,255,255,${0.9*a})`,true);
  legLines(x,y,w,h,onGround,t,a, 'rgba(180,190,210,'); if (!ghost) outline(x,y,w,h,10,'rgba(0,0,0,0.85)');
}
function drawCat(x,y,w,h,onGround,t,a,accent,ghost){
  roundRect(x,y,w,h,12,`rgba(255,244,234,${a})`,true);
  ctx.fillStyle = `rgba(40,32,28,${a})`;
  tri(x+w*0.25,y+6, x+w*0.38,y-8, x+w*0.45,y+6);
  tri(x+w*0.75,y+6, x+w*0.62,y-8, x+w*0.55,y+6);
  ctx.fillRect(x+w*0.47,y+18,6,4); ctx.fillRect(x+w*0.44,y+20,8,2); ctx.fillRect(x+w*0.54,y+20,8,2);
  ctx.fillStyle = `${toRgba(accent,0.8*a)}`; ctx.fillRect(x+6,y+12,w-12,7);
  ctx.strokeStyle = `rgba(40,32,28,${a})`; ctx.lineWidth=5; ctx.lineCap='round';
  ctx.beginPath(); const wag = Math.sin(t*6)*8; ctx.moveTo(x+w-6, y+h*0.6);
  ctx.quadraticCurveTo(x+w+14, y+h*0.5-wag, x+w+24, y+h*0.35); ctx.stroke();
  legLines(x,y,w,h,onGround,t,a, 'rgba(80,70,60,'); if (!ghost) outline(x,y,w,h,12,'rgba(40,32,28,0.8)');
}
function drawAstronaut(x,y,w,h,onGround,t,a,accent,ghost){
  roundRect(x,y,w,h,12,`rgba(240,241,248,${a})`,true);
  roundRect(x+6,y+2,w-12,22,10,`rgba(30,40,56,${0.9*a})`,true);
  ctx.fillStyle = `${toRgba(accent,0.35*a)}`; ctx.fillRect(x+8,y+6,w-16,14);
  roundRect(x-10,y+10,10,22,4,`rgba(180,188,210,${0.9*a})`,true); // backpack
  legLines(x,y,w,h,onGround,t,a, 'rgba(80,100,130,'); if (!ghost) outline(x,y,w,h,12);
}
function drawSlime(x,y,w,h,onGround,t,a,accent,ghost){
  const wob = Math.sin(t*6)*2;
  roundRect(x,y,w,h,16,`rgba(130,255,210,${0.75*a})`,true);
  ctx.fillStyle = `${toRgba(accent,0.35*a)}`; roundRect(x+8,y+10,w-16,8,6,ctx.fillStyle,true);
  ctx.fillStyle='rgba(20,40,40,0.9)'; ctx.beginPath(); ctx.arc(x+w*0.35, y+20+wob*0.2, 4, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(x+w*0.65, y+20-wob*0.2, 4, 0, Math.PI*2); ctx.fill();
  legLines(x,y,w,h,onGround,t,a, 'rgba(40,80,70,'); if (!ghost) outline(x,y,w,h,16,'rgba(0,0,0,0.6)');
}
function drawWizard(x,y,w,h,onGround,t,a,accent,ghost){
  roundRect(x,y,w,h,10,`rgba(50,36,72,${a})`,true);
  ctx.fillStyle = `rgba(30,22,44,${a})`;
  tri(x+w*0.25,y+6, x+w*0.5, y-14, x+w*0.75, y+6);
  ctx.fillStyle = `${toRgba(accent,0.7*a)}`; ctx.fillRect(x+8,y+10,w-16,6);
  ctx.fillStyle='rgba(200,200,220,0.9)'; tri(x+w*0.35,y+16, x+w*0.65,y+16, x+w*0.5,y+34);
  legLines(x,y,w,h,onGround,t,a, 'rgba(160,170,210,'); if (!ghost) outline(x,y,w,h,10,'rgba(0,0,0,0.8)');
}

function legLines(x,y,w,h,onGround,t,a, rgbaPrefix){
  const stride = onGround ? Math.sin(t*10)*6 : Math.sin(t*18)*4;
  ctx.strokeStyle = `${rgbaPrefix}${a})`; ctx.lineWidth=4;
  ctx.beginPath();
  ctx.moveTo(x+w*0.32, y+h-8); ctx.lineTo(x+w*0.32-6+stride, y+h);
  ctx.moveTo(x+w*0.68, y+h-8); ctx.lineTo(x+w*0.68+6+stride, y+h);
  ctx.stroke();
}
function outline(x,y,w,h,r, stroke='rgba(16,24,36,0.9)'){
  ctx.strokeStyle = stroke; ctx.lineWidth=2; roundRect(x,y,w,h,r,'transparent',false,2);
}

// ---------- Obstacles & Coins ----------
function drawPillar(x,y,w,h){
  const grad = ctx.createLinearGradient(x, y, x, y+h);
  grad.addColorStop(0, '#f8898e'); grad.addColorStop(1, '#e0474f');
  roundRect(x,y,w,h,8,grad,true);
  ctx.fillStyle='rgba(255,255,255,0.25)'; ctx.fillRect(x+2,y+2,w-4,6);
  ctx.fillStyle='#1a1c2c'; for (let i=0;i<3;i++){ ctx.fillRect(x+6,y+10+i*20,4,4); ctx.fillRect(x+w-10,y+18+i*20,4,4); }
}
function drawLaserGate(x,y,w,h){
  roundRect(x-10,y-10,w+20,h+20,10,'#1b2a3a',true);
  const g=ctx.createLinearGradient(x,y,x,y+h); g.addColorStop(0,'rgba(139,224,255,0.9)'); g.addColorStop(1,'rgba(123,220,255,0.7)');
  roundRect(x,y,w,h,6,g,true);
  ctx.fillStyle='rgba(123,220,255,0.2)'; roundRect(x-6,y-6,w+12,h+12,8,ctx.fillStyle,true);
}
function drawSaw(x,y,r,angle){
  ctx.fillStyle='rgba(255,224,139,0.12)'; ctx.beginPath(); ctx.arc(x,y,r+10,0,Math.PI*2); ctx.fill();
  ctx.save(); ctx.translate(x,y); ctx.rotate(angle); ctx.fillStyle='#ffe08b';
  const teeth=12; ctx.beginPath();
  for (let i=0;i<teeth;i++){
    const a=(i/teeth)*Math.PI*2; const a2=a+Math.PI*2/teeth/2;
    ctx.moveTo(0,0); ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r); ctx.lineTo(Math.cos(a2)*(r+6),Math.sin(a2)*(r+6)); ctx.closePath();
  }
  ctx.fill();
  ctx.fillStyle='#1a1c2c'; ctx.beginPath(); ctx.arc(0,0,r*0.35,0,Math.PI*2); ctx.fill(); ctx.restore();
}
function drawStarCoin(x,y,r,t){
  ctx.fillStyle='rgba(255,211,77,0.22)'; ctx.beginPath(); ctx.arc(x,y,r+8,0,Math.PI*2); ctx.fill();
  const spikes=5,R=r,r2=r*0.45; ctx.save(); ctx.translate(x,y); ctx.rotate(t*0.6);
  ctx.fillStyle='#ffd34d'; ctx.beginPath();
  for (let i=0;i<spikes*2;i++){
    const rad=(i%2===0)?R:r2; const ang=(i/(spikes*2))*Math.PI*2;
    ctx.lineTo(Math.cos(ang)*rad,Math.sin(ang)*rad);
  }
  ctx.closePath(); ctx.fill(); ctx.strokeStyle='#ffe89a'; ctx.lineWidth=2; ctx.stroke(); ctx.restore();
}

// ---------- Utils ----------
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function rectOverlap(a,b){ return a.x < b.x + (b.w||0) && a.x + a.w > b.x && a.y < b.y + (b.h||0) && a.y + a.h > b.y; }
function circleRectOverlap(c,r){ const cx=clamp(c.x,r.x,r.x+r.w), cy=clamp(c.y,r.y,r.y+r.h); const dx=c.x-cx, dy=c.y-cy; return dx*dx+dy*dy<=c.r*c.r; }
function roundRect(x,y,w,h,r, fillStyle, fill=true, strokeW=0){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  if (fill){ ctx.fillStyle=fillStyle; ctx.fill(); }
  if (strokeW>0){ ctx.lineWidth=strokeW; ctx.strokeStyle= typeof fillStyle==='string'? fillStyle : '#0b0c12'; ctx.stroke(); }
}
function mapRange(v,a1,a2,b1,b2){ return b1 + (clamp((v-a1)/(a2-a1),0,1))*(b2-b1); }
function toRgba(hex, a){ const h=hex.replace('#',''); const R=parseInt(h.slice(0,2),16), G=parseInt(h.slice(2,4),16), B=parseInt(h.slice(4,6),16); return `rgba(${R},${G},${B},${a})`; }
function tri(x1,y1,x2,y2,x3,y3){ ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.lineTo(x3,y3); ctx.closePath(); ctx.fill(); }
function shake(mag,time){ shakeMag = mag/100; shakeTime = time; }

// Prevent page scroll on arrow keys/space during play
window.addEventListener('keydown', (e) => {
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
}, { passive:false });
