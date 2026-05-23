import { useEffect, useRef, useState, useCallback } from 'react';
import { createWorker } from 'tesseract.js';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';

const SCAN_MS = 1500;

// Start downloading MindAR chunks immediately — don't wait for image mode switch
const mindARPromise = Promise.all([
  import('mind-ar/dist/mindar-image-three.prod.js'),
  import('mind-ar/dist/mindar-image.prod.js'),
]).catch(() => [null, null]);

// ── IndexedDB cache ──────────────────────────────────────────────
// Compiled .mind targets are large (can take 30+ s to generate).
// We cache them by a key derived from rule IDs + image URLs so the
// result is reused on every subsequent load and only re-generated
// when rules actually change.

function openTargetDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('ar-scanner-v1', 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore('targets');
    r.onsuccess = e => res(e.target.result);
    r.onerror = () => rej(r.error);
  });
}

async function cacheGet(key) {
  try {
    const db = await openTargetDB();
    return new Promise(res => {
      const req = db.transaction('targets').objectStore('targets').get(key);
      req.onsuccess = () => res(req.result ?? null);
      req.onerror  = () => res(null);
    });
  } catch { return null; }
}

async function cachePut(key, value) {
  try {
    const db = await openTargetDB();
    await new Promise((res, rej) => {
      const tx = db.transaction('targets', 'readwrite');
      tx.objectStore('targets').put(value, key);
      tx.oncomplete = res;
      tx.onerror    = rej;
    });
  } catch { /* silently ignore */ }
}

function makeCacheKey(rules) {
  return rules.map(r => `${r.id}:${r.image_url}`).sort().join('|');
}

// ── Image loader ─────────────────────────────────────────────────
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error(`Cannot load: ${src}`));
    img.src = src;
  });
}

// ── Component ────────────────────────────────────────────────────
export default function Scanner() {
  const videoRef       = useRef(null);
  const captureRef     = useRef(null);
  const overlayRef     = useRef(null);
  const workerRef      = useRef(null);
  const intervalRef    = useRef(null);
  const scanningRef    = useRef(false);
  const triggeredRef   = useRef(new Set());
  const rulesRef       = useRef([]);
  const aliveRef       = useRef(true);
  const mindarRef      = useRef(null);
  const imageModeRef   = useRef(null);
  const modelViewerRef = useRef(null);

  const mindUrlRef       = useRef(null);
  const compiledRulesRef = useRef([]);
  const MindARThreeRef   = useRef(null);

  const [rules,       setRules]       = useState([]);
  const [banner,      setBanner]      = useState(null);
  const [activeModel, setActiveModel] = useState(null);
  const [scanMode,    setScanMode]    = useState('text');
  const [imageStatus, setImageStatus] = useState('');
  const [imgReady,    setImgReady]    = useState(false);

  // Loading splash state
  const [appReady,  setAppReady]  = useState(false);
  const [loadSteps, setLoadSteps] = useState([
    { id: 'db',     label: 'Loading rules',        done: false },
    { id: 'camera', label: 'Starting camera',       done: false },
    { id: 'ocr',    label: 'Loading text engine',   done: false },
  ]);

  function markDone(id) {
    setLoadSteps(prev => prev.map(s => s.id === id ? { ...s, done: true } : s));
  }
  function addLoadStep(step) {
    setLoadSteps(prev => [...prev, step]);
  }

  // ── Image target compilation with cache ──────────────────────────

  async function compileImageTargets(imageRules) {
    const key = makeCacheKey(imageRules);

    // Fast path: use cached compiled data
    const cached = await cacheGet(key);
    if (cached) {
      const [threemod] = await mindARPromise;
      if (threemod) MindARThreeRef.current = threemod.MindARThree;
      if (mindUrlRef.current) URL.revokeObjectURL(mindUrlRef.current);
      mindUrlRef.current    = URL.createObjectURL(new Blob([cached]));
      compiledRulesRef.current = imageRules;
      setImgReady(true);
      markDone('images');
      return;
    }

    // Slow path: compile + save to cache
    const [images, [threemod, coremod]] = await Promise.all([
      Promise.all(imageRules.map(r => loadImage(r.image_url))),
      mindARPromise,
    ]);

    if (!threemod || !coremod) throw new Error('MindAR failed to load');
    MindARThreeRef.current = threemod.MindARThree;

    const compiler = new coremod.Compiler();
    await compiler.compileImageTargets(images, () => {});
    const data = await compiler.exportData();

    await cachePut(key, data); // persist for next session

    if (mindUrlRef.current) URL.revokeObjectURL(mindUrlRef.current);
    mindUrlRef.current    = URL.createObjectURL(new Blob([data]));
    compiledRulesRef.current = imageRules;
    setImgReady(true);
    markDone('images');
  }

  // ── Rules ─────────────────────────────────────────────────────────

  const fetchRules = useCallback(async () => {
    const { data } = await supabase.from('rules').select('*').eq('active', true);
    const fresh = data ?? [];
    rulesRef.current = fresh;
    triggeredRef.current.clear();
    setRules(fresh);
    return fresh;
  }, []);

  // ── Trigger action ────────────────────────────────────────────────

  function triggerRule(rule) {
    if (rule.model_url) {
      setActiveModel(rule);
      setBanner({ text: `"${rule.keyword}" detected`, url: null });
      setTimeout(() => setBanner(null), 3000);
    } else if (rule.url) {
      const display = rule.url.replace(/^https?:\/\//, '');
      setBanner({ text: `"${rule.keyword}" — tap to open ${display}`, url: rule.url });
      setTimeout(() => setBanner(null), 8000);
    }
  }

  // ── Text mode ──────────────────────────────────────────────────────

  function syncCanvas() {
    const v = videoRef.current, o = overlayRef.current, c = captureRef.current;
    if (!v || !o || !c) return;
    const w = v.videoWidth  || v.clientWidth;
    const h = v.videoHeight || v.clientHeight;
    o.width = c.width  = w;
    o.height = c.height = h;
  }

  function drawOverlay(words) {
    const ol = overlayRef.current, cap = captureRef.current;
    if (!ol || !cap) return;
    const ctx = ol.getContext('2d');
    ctx.clearRect(0, 0, ol.width, ol.height);
    const sx = ol.width / (cap.width || 1), sy = ol.height / (cap.height || 1);
    words.forEach(({ text, bbox, confidence }) => {
      if (!text.trim() || confidence < 45) return;
      const match = rulesRef.current.some(r =>
        text.toUpperCase().includes(r.keyword.toUpperCase())
      );
      const { x0, y0, x1, y1 } = bbox;
      ctx.strokeStyle = match ? '#00e676' : 'rgba(255,255,255,0.22)';
      ctx.lineWidth   = match ? 2.5 : 1;
      ctx.strokeRect(x0 * sx, y0 * sy, (x1 - x0) * sx, (y1 - y0) * sy);
      if (match) {
        ctx.fillStyle = 'rgba(0,230,118,0.1)';
        ctx.fillRect(x0 * sx, y0 * sy, (x1 - x0) * sx, (y1 - y0) * sy);
      }
    });
  }

  function handleTextDetection(text, words) {
    drawOverlay(words);
    const upper = text.toUpperCase();
    for (const rule of rulesRef.current) {
      const kw = rule.keyword.toUpperCase();
      if (!upper.includes(kw) || triggeredRef.current.has(rule.id)) continue;
      triggeredRef.current.add(rule.id);
      triggerRule(rule);
    }
  }

  async function startTextMode() {
    if (!aliveRef.current) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }, audio: false,
      });
    } catch (e) { throw new Error(`Camera: ${e.message}`); }

    if (!aliveRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
    videoRef.current.srcObject = stream;
    await new Promise(res =>
      videoRef.current.addEventListener('loadedmetadata', res, { once: true })
    );
    syncCanvas();
    window.addEventListener('resize', syncCanvas);
    markDone('camera');

    try {
      workerRef.current = await createWorker('eng+ara', 1, { logger: () => {} });
    } catch (e) { throw new Error(`OCR: ${e.message}`); }
    if (!aliveRef.current) return;
    markDone('ocr');

    intervalRef.current = setInterval(async () => {
      if (scanningRef.current || !aliveRef.current) return;
      scanningRef.current = true;
      const cap = captureRef.current, vid = videoRef.current;
      if (cap && vid && vid.readyState >= 2) {
        cap.getContext('2d').drawImage(vid, 0, 0, cap.width, cap.height);
        try {
          const { data } = await workerRef.current.recognize(cap);
          if (aliveRef.current) handleTextDetection(data.text ?? '', data.words ?? []);
        } catch (_) {}
      }
      scanningRef.current = false;
    }, SCAN_MS);
  }

  function stopTextMode() {
    window.removeEventListener('resize', syncCanvas);
    clearInterval(intervalRef.current);
    workerRef.current?.terminate();
    workerRef.current = null;
    videoRef.current?.srcObject?.getTracks().forEach(t => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  // ── Image mode ────────────────────────────────────────────────────

  async function startImageMode() {
    if (!mindUrlRef.current || !MindARThreeRef.current) {
      setImageStatus('AR targets not ready — please wait a moment and try again.');
      return;
    }
    setImageStatus('Starting AR camera…');
    try {
      const mindar = new MindARThreeRef.current({
        container: imageModeRef.current,
        imageTargetSrc: mindUrlRef.current,
        maxTrack: compiledRulesRef.current.length,
      });
      mindarRef.current = mindar;
      const { renderer, scene, camera } = mindar;
      await mindar.start();

      compiledRulesRef.current.forEach((rule, i) => {
        const anchor = mindar.addAnchor(i);
        anchor.onTargetFound = () => {
          if (!triggeredRef.current.has(rule.id)) {
            triggeredRef.current.add(rule.id);
            triggerRule(rule);
          }
        };
        anchor.onTargetLost = () => triggeredRef.current.delete(rule.id);
      });

      renderer.setAnimationLoop(() => renderer.render(scene, camera));
      setImageStatus('');
    } catch (e) {
      setImageStatus(`AR start failed: ${e.message}`);
    }
  }

  async function stopImageMode() {
    if (mindarRef.current) {
      try { mindarRef.current.renderer.setAnimationLoop(null); await mindarRef.current.stop(); }
      catch (_) {}
      mindarRef.current = null;
    }
    triggeredRef.current.clear();
    setImageStatus('');
  }

  async function switchToImage() {
    if (scanMode === 'image') return;
    stopTextMode();
    setScanMode('image');
    await startImageMode();
  }

  async function switchToText() {
    if (scanMode === 'text') return;
    await stopImageMode();
    setScanMode('text');
    await startTextMode();
  }

  // ── Boot ──────────────────────────────────────────────────────────

  useEffect(() => {
    aliveRef.current = true;

    async function boot() {
      // 1. Fetch rules (fast DB call)
      const fresh = await fetchRules();
      markDone('db');

      const imageRules = fresh.filter(r => r.image_url);

      // 2. Register the images step only if there are image rules
      if (imageRules.length > 0) {
        addLoadStep({ id: 'images', label: 'Preparing AR targets', done: false });
      }

      // 3. Load OCR engine + compile image targets in parallel
      await Promise.all([
        startTextMode(),
        imageRules.length > 0 ? compileImageTargets(imageRules) : Promise.resolve(),
      ]);

      setAppReady(true);
    }

    boot().catch(() => setAppReady(true)); // always show the app even if something fails

    const channel = supabase
      .channel('rules-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rules' }, () => {
        if (aliveRef.current) fetchRules();
      })
      .subscribe();

    return () => {
      aliveRef.current = false;
      stopTextMode();
      stopImageMode();
      if (mindUrlRef.current) URL.revokeObjectURL(mindUrlRef.current);
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchRules]);

  const hasImageRules = rules.some(r => r.image_url);

  return (
    <>
      {/* ── Splash / loading screen ─────────────────────────────── */}
      {!appReady && (
        <div className="splash">
          <div className="splash-card">
            <div className="splash-logo">AR Scanner</div>
            <div className="splash-steps">
              {loadSteps.map(step => (
                <div key={step.id} className={`splash-step ${step.done ? 'done' : 'pending'}`}>
                  <span className="splash-dot">{step.done ? '✓' : '⋯'}</span>
                  <span>{step.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Main scanner (hidden during splash, avoids flash) ────── */}
      <div className="scanner" style={{ visibility: appReady ? 'visible' : 'hidden' }}>
        <video
          ref={videoRef}
          autoPlay playsInline muted
          style={{ display: scanMode === 'text' ? 'block' : 'none' }}
        />
        <canvas
          ref={overlayRef}
          className="overlay"
          style={{ display: scanMode === 'text' ? 'block' : 'none' }}
        />
        <canvas ref={captureRef} style={{ display: 'none' }} />

        <div
          ref={imageModeRef}
          className="image-mode-container"
          style={{ display: scanMode === 'image' ? 'block' : 'none' }}
        />

        {scanMode === 'image' && imageStatus && (
          <div className="image-status">
            <span className="dot scanning" />
            {imageStatus}
          </div>
        )}

        {banner && (
          banner.url
            ? <a href={banner.url} target="_blank" rel="noopener noreferrer" className="banner banner-link">{banner.text}</a>
            : <div className="banner">{banner.text}</div>
        )}

        {/* 3D model viewer — modal card style */}
        {activeModel && (
          <div
            className="model-modal-bg"
            onClick={() => { triggeredRef.current.delete(activeModel.id); setActiveModel(null); }}
          >
            <div className="model-modal-card" onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div className="model-modal-header">
                <span className="model-modal-title">{activeModel.keyword}</span>
                <button
                  className="model-modal-close"
                  onClick={() => { triggeredRef.current.delete(activeModel.id); setActiveModel(null); }}
                >×</button>
              </div>

              {/* model-viewer frame */}
              <model-viewer
                ref={modelViewerRef}
                src={activeModel.model_url}
                ar
                ar-modes="webxr scene-viewer quick-look"
                auto-rotate
                camera-controls
                touch-action="pan-y"
                shadow-intensity="1"
                class="model-modal-viewer"
              >
                {/* slot button shown inside the 3D scene (bottom-right) */}
                <button slot="ar-button" className="ar-slot-btn">View in AR</button>
              </model-viewer>

              {/* Footer actions */}
              <div className="model-modal-footer">
                <button
                  className="ar-launch-btn"
                  onClick={() => modelViewerRef.current?.activateAR()}
                >
                  View in AR
                </button>
                {activeModel.url && (
                  <a
                    href={activeModel.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="model-url-btn"
                  >Open URL</a>
                )}
              </div>

            </div>
          </div>
        )}

        <div className="rules-panel">
          <p className="panel-title">Active Rules</p>
          {rules.length === 0
            ? <p className="no-rules">No active rules</p>
            : rules.map(r => (
              <div key={r.id} className="rule-chip">
                <span className="kw">{r.keyword}</span>
                <span className="arrow">→</span>
                <span className="url">
                  {r.model_url ? '3D model' : r.url?.replace(/^https?:\/\//, '') ?? '—'}
                </span>
                {r.image_url && <span className="chip-img-badge">IMG</span>}
              </div>
            ))
          }
        </div>

        <div className="mode-toggle">
          <button
            className={`mode-btn${scanMode === 'text' ? ' active' : ''}`}
            onClick={switchToText}
          >Text</button>
          <button
            className={`mode-btn${scanMode === 'image' ? ' active' : ''}`}
            onClick={switchToImage}
            disabled={!hasImageRules}
            title={!hasImageRules ? 'Add rules with Marker Images in admin' : ''}
          >
            {hasImageRules && !imgReady ? 'Image ⋯' : 'Image'}
          </button>
        </div>

        <Link to="/admin" className="admin-link">Admin Panel</Link>
      </div>
    </>
  );
}
