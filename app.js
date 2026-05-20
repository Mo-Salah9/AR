/**
 * Text → URL mapping. First matching rule wins.
 * Add more entries: { pattern: 'HELLO', url: 'https://example.com' }
 */
const DETECTION_RULES = [
  { pattern: '2025', url: 'https://www.google.com' },
];

const SCAN_INTERVAL_MS = 1500;
const COOLDOWN_MS = 5000;

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const statusEl = document.getElementById('status');
const detectedTextEl = document.getElementById('detected-text');

const ctx = canvas.getContext('2d');
let scanTimer = null;
let isScanning = false;
let lastOpenedAt = 0;
let openedPatterns = new Set();

function setStatus(text, className = '') {
  statusEl.textContent = text;
  statusEl.className = 'status ' + className;
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('Camera not supported in this browser.', 'error');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    video.addEventListener('loadedmetadata', () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }, { once: true });

    setStatus('Camera on — scanning for text…', 'scanning');
    startScanLoop();
  } catch (err) {
    const msg =
      err.name === 'NotAllowedError'
        ? 'Camera permission denied. Allow camera access and reload.'
        : `Camera error: ${err.message}`;
    setStatus(msg, 'error');
  }
}

function captureFrame() {
  if (!video.videoWidth) return null;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0);
  return canvas;
}

function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim().toUpperCase();
}

function findMatch(text) {
  const normalized = normalizeText(text);
  for (const rule of DETECTION_RULES) {
    const pattern = rule.pattern.toUpperCase();
    if (normalized.includes(pattern)) {
      return rule;
    }
  }
  return null;
}

function openUrl(url, pattern) {
  const now = Date.now();
  if (now - lastOpenedAt < COOLDOWN_MS && openedPatterns.has(pattern)) {
    return;
  }

  lastOpenedAt = now;
  openedPatterns.add(pattern);

  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    setStatus(`Detected "${pattern}" — popup blocked. Tap to open.`, 'found');
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `Open ${url}`;
    link.style.display = 'block';
    link.style.marginTop = '0.5rem';
    link.style.color = '#8ab4f8';
    detectedTextEl.appendChild(document.createElement('br'));
    detectedTextEl.appendChild(link);
  } else {
    setStatus(`Detected "${pattern}" — opened ${url}`, 'found');
  }
}

async function scanFrame() {
  if (isScanning || video.readyState < 2) return;

  const frame = captureFrame();
  if (!frame) return;

  isScanning = true;
  setStatus('Scanning…', 'scanning');

  try {
    const { data } = await Tesseract.recognize(frame, 'eng', {
      logger: () => {},
    });

    const text = data.text || '';
    if (text.trim()) {
      detectedTextEl.textContent = text.trim();
    }

    const match = findMatch(text);
    if (match) {
      openUrl(match.url, match.pattern);
    } else {
      setStatus('Camera on — scanning for text…', 'scanning');
    }
  } catch (err) {
    console.error(err);
    setStatus('OCR error — retrying…', 'error');
  } finally {
    isScanning = false;
  }
}

function startScanLoop() {
  scanTimer = setInterval(scanFrame, SCAN_INTERVAL_MS);
  scanFrame();
}

startCamera();
