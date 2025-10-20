Emotion Escape — Mood-Adaptive Browser Runner

Emotion Escape is a fast, lightweight runner game that adapts to your mood in real time—on your device. It uses MediaPipe’s Face Landmarker (WASM) to read facial blendshapes (smile, brow tension) and adjusts the world, difficulty, and visuals accordingly. No servers. No video uploads. Just HTML/JS/Canvas.

Live demo: https://bibek246.github.io/emotion-escape/



✨ Features

On-device Mood AI (privacy-first): blends smile / jaw / brow with neutral calibration + smoothing → stable happy / calm / stressed states.

Mood worlds

Happy: sunny gradient, clouds + balloons, easier spawns & more coins

Calm: dusk sky, moon + stars, balanced

Stressed: storm gradient, rain streaks, occasional lightning, tighter patterns

Juicy gameplay: double jump, coyote time, jump buffer, camera shake, particles, parallax.

Skins: Robot, Ninja, Cat, Astronaut, Slime, Wizard (plus randomize on Start).

No build step: pure HTML5 Canvas + JS modules. Deploy anywhere static.

PWA-ready: manifest + icons; works great on desktop browsers.

🎮 Controls

Move: ← → or A D

Jump: Space (with double-jump)

Manual mood override: 1 = Happy, 2 = Calm, 3 = Stressed

Enable/Disable: Buttons in the right panel (Audio, Background music, Mood AI, Recalibrate)

When enabling Mood AI, hold a neutral face for ~1–2 seconds to calibrate baseline.

🔐 Privacy

Face analysis runs entirely in your browser using WASM (no server).

The model file models/face_landmarker.task is fetched once over HTTPS and cached by your browser.

No photos / videos are sent or stored.

You can disable Mood AI at any time and use manual mood keys (1/2/3).

🧱 Tech Stack

JavaScript (ES modules), HTML5 Canvas, WebGL (via browser), CSS

MediaPipe Tasks Vision — Face Landmarker (blendshapes) in WASM

No frameworks / no bundler (zero build)

Deployment: GitHub Pages / Netlify / Vercel (any static host)

🚀 Quick Start (Local)

Clone

git clone https://github.com/<you>/<repo>.git
cd <repo>


(If the model file isn’t present) Download it

mkdir -p models
curl -L "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" -o models/face_landmarker.task


Keep the exact filename: face_landmarker.task.

Run a static server (pick one)

# VS Code: install "Live Server" → Right-click index.html → "Open with Live Server"
# OR node:
npx http-server -p 5500
# OR Python 3:
python -m http.server 5500


Open http://127.0.0.1:5500/ → Start → (optional) Enable Mood AI and grant camera permission.

🌍 Deploy
GitHub Pages (recommended)

Push to GitHub:

git init
git add .
git commit -m "Initial publish"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main


Repo → Settings → Pages → Deploy from a branch → main / (root).

Your game appears at:

https://<you>.github.io/<repo>/


⚙️ Configuration

Difficulty tuning (by mood): open src/main.js → moodParams()

speedBase, grav, spawnRateBase, gapBias, droneRate, pillarRate, coinRate

Inference frame rate: src/mood-mediapipe.v3.js → SAMPLE_MS (e.g., 120ms ≈ ~8 FPS)

Sensitivity: adjust thresholds in commitMood() or the weights in detect() (happy vs stressed)

Skins: change default in SKIN or toggle Randomize on Start in the UI

🧪 Troubleshooting

Mood AI doesn’t enable / 404 for model:

Make sure models/face_landmarker.task exists and is served over HTTPS.

Open the model URL directly (see Deploy section).

Hard refresh (Ctrl/Cmd + Shift + R) to bust caches.

Extensions show “Permissions policy violation: unload…”

High CPU / fan noise:

Increase SAMPLE_MS (slower inference), or run without Mood AI (manual 1/2/3 keys).

Camera blocked:

Ensure HTTPS and allow camera permission in the browser.

🧭 Roadmap (nice-to-have)

Mobile control layer (swipe / tap)

Leaderboard (client-only ghost or server-optional)

More skins + seasonal palettes

Soundtrack that adapts to mood

Accessibility: color-blind friendly palette option

🤝 Contributing

PRs welcome! Please:

Keep it framework-free (HTML/CSS/JS).

Avoid adding heavy dependencies.

Include a short demo GIF or screenshot for visual changes.

📜 License

MIT © Your Name
Feel free to fork, remix, and build on it—credit appreciated!

🙏 Credits

MediaPipe Tasks Vision (Face Landmarker)

Everyone building privacy-first, on-device AI experiences 💙
