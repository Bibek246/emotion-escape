// Manual mood controller (keys). MediaPipe module will call setMood().
const moodEl = document.getElementById('mood');

let currentMood = 'calm'; // 'happy' | 'calm' | 'stressed'
const listeners = new Set();

export function initMoodControls() {
  window.addEventListener('keydown', (e) => {
    if (e.key === '1') setMood('happy');
    if (e.key === '2') setMood('calm');
    if (e.key === '3') setMood('stressed');
  });
  renderMood();
}

export function setMood(m) {
  currentMood = m;
  renderMood();
  listeners.forEach(fn => fn(m));
}

export function onMoodChange(fn) { listeners.add(fn); }
export function getMood() { return currentMood; }

function renderMood(){ moodEl.textContent = currentMood; }
