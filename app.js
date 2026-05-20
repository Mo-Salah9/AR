// ─── Rules: add more { keyword, url } entries here ───────────────────────────
const RULES = [
  { keyword: '2025', url: 'https://www.google.com' },
];

// How often to grab a frame and run OCR (ms)
const SCAN_INTERVAL_MS = 1500;

// ─── State ────────────────────────────────────────────────────────────────────
const triggeredKeywords = new Set();
let worker = null;
let scanning = false;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const video          = document.getElementById('video');
const captureCanvas  = document.getElementById('capture-canvas');
const overlayCanvas  = document.getElementById('overlay');
const statusText     = document.getElementById('status-text');
const detectionBanner = document.getElementById('detection-banner');
const detectionMsg   = document.getElementById('detection-message');
const rulesList      = document.getElementById('rules-list');

// ─── Render rules panel ───────────────────────────────────────────────────────
function renderRules() {
  rulesList.innerHTML = '';
  RULES.forEach(({ keyword, url }) => {
    const li = document.createElement('li');
    const displayUrl = url.replace(/^https?:\/\//, '');
    li.innerHTML = `
      <span class="keyword">${keyword}</span>
      <span class="arrow">→</span>
      <span class="url">${displayUrl}</span>
    `;
    rulesList.appendChild(li);
  });
}

// ─── Camera ───────────────────────────────────────────────────────────────────
async function startCamera() {
  setStatus('Requesting camera access…');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await new Promise(resolve => video.addEventListener('loadedmetadata', resolve, { once: true }));
    syncCanvasSize();
    window.addEventListener('resize', syncCanvasSize);
    return true;
  } catch (err) {
    setStatus(`Camera error: ${err.message}`);
    return false;
  }
}

function syncCanvasSize() {
  overlayCanvas.width  = video.videoWidth  || video.clientWidth;
  overlayCanvas.height = video.videoHeight || video.clientHeight;
  captureCanvas.width  = overlayCanvas.width;
  captureCanvas.height = overlayCanvas.height;
}

// ─── Tesseract worker ─────────────────────────────────────────────────────────
async function initOCR() {
  setStatus('Loading OCR engine…');
  worker = await Tesseract.createWorker('eng', 1, {
    logger: () => {},
  });
  setStatus('Ready — scanning for text…', 'scanning');
}

// ─── OCR scan loop ────────────────────────────────────────────────────────────
function startScanLoop() {
  setInterval(async () => {
    if (scanning || !worker) return;
    scanning = true;

    // Draw current video frame onto hidden canvas
    const ctx = captureCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

    try {
      const { data } = await worker.recognize(captureCanvas);
      const text = data.text || '';
      handleDetectedText(text, data.words || []);
    } catch (_) {
      // ignore transient OCR errors
    }

    scanning = false;
  }, SCAN_INTERVAL_MS);
}

// ─── Detection handler ────────────────────────────────────────────────────────
function handleDetectedText(rawText, words) {
  const upperText = rawText.toUpperCase();

  drawWordBoxes(words);

  for (const rule of RULES) {
    const keyword = rule.keyword.toUpperCase();
    if (upperText.includes(keyword) && !triggeredKeywords.has(keyword)) {
      triggeredKeywords.add(keyword);
      flashBanner(`"${rule.keyword}" detected! Opening ${rule.url.replace(/^https?:\/\//, '')}…`);
      setTimeout(() => window.open(rule.url, '_blank'), 800);
    }
  }
}

// ─── Overlay boxes ────────────────────────────────────────────────────────────
function drawWordBoxes(words) {
  const ctx = overlayCanvas.getContext('2d');
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  const scaleX = overlayCanvas.width  / captureCanvas.width;
  const scaleY = overlayCanvas.height / captureCanvas.height;

  words.forEach(word => {
    if (!word.text.trim() || word.confidence < 50) return;
    const { x0, y0, x1, y1 } = word.bbox;
    const isTarget = RULES.some(r =>
      word.text.toUpperCase().includes(r.keyword.toUpperCase())
    );

    ctx.strokeStyle = isTarget ? '#00e676' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth   = isTarget ? 2.5 : 1;
    ctx.strokeRect(x0 * scaleX, y0 * scaleY, (x1 - x0) * scaleX, (y1 - y0) * scaleY);

    if (isTarget) {
      ctx.fillStyle = 'rgba(0,230,118,0.15)';
      ctx.fillRect(x0 * scaleX, y0 * scaleY, (x1 - x0) * scaleX, (y1 - y0) * scaleY);
    }
  });
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function setStatus(msg, cls = '') {
  statusText.textContent = msg;
  statusText.className = cls;
}

function flashBanner(msg) {
  detectionMsg.textContent = msg;
  detectionBanner.classList.remove('hidden');
  setTimeout(() => detectionBanner.classList.add('hidden'), 4000);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
(async () => {
  renderRules();
  const cameraOk = await startCamera();
  if (!cameraOk) return;
  await initOCR();
  startScanLoop();
})();
