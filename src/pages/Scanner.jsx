import { useEffect, useRef, useState, useCallback } from 'react';
import { createWorker } from 'tesseract.js';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';

const SCAN_MS = 1500;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

export default function Scanner() {
  const videoRef         = useRef(null);
  const captureRef       = useRef(null);
  const overlayRef       = useRef(null);
  const workerRef        = useRef(null);
  const intervalRef      = useRef(null);
  const scanningRef      = useRef(false);
  const triggeredRef     = useRef(new Set());
  const rulesRef         = useRef([]);
  const aliveRef         = useRef(true);
  const mindarRef        = useRef(null);
  const imageModeRef     = useRef(null);

  const [rules,       setRules]       = useState([]);
  const [status,      setStatus]      = useState('Initializing…');
  const [isScanning,  setIsScanning]  = useState(false);
  const [banner,      setBanner]      = useState(null);
  const [activeModel, setActiveModel] = useState(null);
  const [scanMode,    setScanMode]    = useState('text');  // 'text' | 'image'
  const [imageStatus, setImageStatus] = useState('');

  const fetchRules = useCallback(async () => {
    const { data } = await supabase
      .from('rules')
      .select('*')
      .eq('active', true);
    const fresh = data ?? [];
    rulesRef.current = fresh;
    triggeredRef.current.clear();
    setRules(fresh);
  }, []);

  // ── Text mode helpers ───────────────────────────────────────────

  function syncCanvas() {
    const v = videoRef.current, o = overlayRef.current, c = captureRef.current;
    if (!v || !o || !c) return;
    const w = v.videoWidth  || v.clientWidth;
    const h = v.videoHeight || v.clientHeight;
    o.width = c.width  = w;
    o.height = c.height = h;
  }

  function drawOverlay(words) {
    const ol  = overlayRef.current;
    const cap = captureRef.current;
    if (!ol || !cap) return;
    const ctx = ol.getContext('2d');
    ctx.clearRect(0, 0, ol.width, ol.height);
    const sx = ol.width  / (cap.width  || 1);
    const sy = ol.height / (cap.height || 1);
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

  function triggerRule(rule) {
    if (rule.model_url) {
      setActiveModel(rule);
      setBanner(`"${rule.keyword}" detected`);
      setTimeout(() => setBanner(null), 3000);
    } else if (rule.url) {
      const display = rule.url.replace(/^https?:\/\//, '');
      setBanner(`"${rule.keyword}" detected — opening ${display}…`);
      setTimeout(() => window.open(rule.url, '_blank'), 600);
      setTimeout(() => setBanner(null), 4000);
    }
  }

  async function startTextMode() {
    if (!aliveRef.current) return;
    setStatus('Requesting camera…');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
    } catch (e) {
      setStatus(`Camera error: ${e.message}`);
      return;
    }
    if (!aliveRef.current) { stream.getTracks().forEach(t => t.stop()); return; }

    videoRef.current.srcObject = stream;
    await new Promise(res =>
      videoRef.current.addEventListener('loadedmetadata', res, { once: true })
    );
    syncCanvas();
    window.addEventListener('resize', syncCanvas);

    setStatus('Loading OCR engine (EN + AR)…');
    try {
      workerRef.current = await createWorker('eng+ara', 1, { logger: () => {} });
    } catch (e) {
      setStatus(`OCR error: ${e.message}`);
      return;
    }
    if (!aliveRef.current) return;

    setIsScanning(true);
    setStatus('Scanning for text…');

    intervalRef.current = setInterval(async () => {
      if (scanningRef.current || !aliveRef.current) return;
      scanningRef.current = true;
      const cap = captureRef.current;
      const vid = videoRef.current;
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
    const stream = videoRef.current?.srcObject;
    stream?.getTracks().forEach(t => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsScanning(false);
  }

  // ── Image mode helpers ──────────────────────────────────────────

  async function startImageMode() {
    const imageRules = rulesRef.current.filter(r => r.image_url);
    if (imageRules.length === 0) {
      setImageStatus('No image rules configured. Add rules with a Marker Image in the admin panel.');
      return;
    }

    setImageStatus('Loading reference images…');
    let images;
    try {
      images = await Promise.all(imageRules.map(r => loadImage(r.image_url)));
    } catch (e) {
      setImageStatus(`Failed to load images: ${e.message}`);
      return;
    }

    setImageStatus('Loading image detection library…');
    let MindARThree, Compiler;
    try {
      const [threemod, coremod] = await Promise.all([
        import('mind-ar/dist/mindar-image-three.prod.js'),
        import('mind-ar/dist/mindar-image.prod.js'),
      ]);
      MindARThree = threemod.MindARThree;
      Compiler = coremod.Compiler;
    } catch (e) {
      setImageStatus(`Failed to load MindAR: ${e.message}`);
      return;
    }

    setImageStatus('Compiling AR targets (first run may take ~30 s)…');
    let mindUrl;
    try {
      const compiler = new Compiler();
      await compiler.compileImageTargets(images, p => {
        setImageStatus(`Compiling AR targets: ${Math.round(p * 100)}%`);
      });
      const data = await compiler.exportData();
      mindUrl = URL.createObjectURL(new Blob([data]));
    } catch (e) {
      setImageStatus(`Compilation failed: ${e.message}`);
      return;
    }

    setImageStatus('Starting AR camera…');
    try {
      const mindar = new MindARThree({
        container:      imageModeRef.current,
        imageTargetSrc: mindUrl,
        maxTrack:       imageRules.length,
      });
      mindarRef.current = mindar;

      const { renderer, scene, camera } = mindar;
      await mindar.start();

      imageRules.forEach((rule, i) => {
        const anchor = mindar.addAnchor(i);
        anchor.onTargetFound = () => {
          if (!triggeredRef.current.has(rule.id)) {
            triggeredRef.current.add(rule.id);
            triggerRule(rule);
          }
        };
        anchor.onTargetLost = () => {
          triggeredRef.current.delete(rule.id);
        };
      });

      renderer.setAnimationLoop(() => renderer.render(scene, camera));
      setImageStatus('');
    } catch (e) {
      setImageStatus(`AR start failed: ${e.message}`);
    }
  }

  async function stopImageMode() {
    if (mindarRef.current) {
      try {
        mindarRef.current.renderer.setAnimationLoop(null);
        await mindarRef.current.stop();
      } catch (_) {}
      mindarRef.current = null;
    }
    triggeredRef.current.clear();
    setImageStatus('');
  }

  // ── Mode toggle ─────────────────────────────────────────────────

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

  // ── Lifecycle ───────────────────────────────────────────────────

  useEffect(() => {
    aliveRef.current = true;

    async function boot() {
      await fetchRules();
      await startTextMode();
    }
    boot();

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
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchRules]);

  const hasImageRules = rules.some(r => r.image_url);

  return (
    <div className="scanner">
      {/* Text mode */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ display: scanMode === 'text' ? 'block' : 'none' }}
      />
      <canvas
        ref={overlayRef}
        className="overlay"
        style={{ display: scanMode === 'text' ? 'block' : 'none' }}
      />
      <canvas ref={captureRef} style={{ display: 'none' }} />

      {/* Image mode — MindAR injects its video + canvas here */}
      <div
        ref={imageModeRef}
        className="image-mode-container"
        style={{ display: scanMode === 'image' ? 'block' : 'none' }}
      />

      {/* Status bar (text mode only) */}
      {scanMode === 'text' && (
        <div className={`status-bar${isScanning ? ' scanning' : ''}`}>
          <span className="dot" />
          {status}
        </div>
      )}

      {/* Image mode status / progress */}
      {scanMode === 'image' && imageStatus && (
        <div className="image-status">
          <span className="dot scanning" />
          {imageStatus}
        </div>
      )}

      {/* Detection banner */}
      {banner && <div className="banner">{banner}</div>}

      {/* 3D model viewer overlay */}
      {activeModel && (
        <div className="model-overlay">
          <model-viewer
            src={activeModel.model_url}
            ar
            ar-modes="webxr scene-viewer quick-look"
            auto-rotate
            camera-controls
            style={{ width: '100%', height: '100%' }}
          />
          <button
            className="model-close"
            onClick={() => {
              triggeredRef.current.delete(activeModel.id);
              setActiveModel(null);
            }}
          >
            ✕
          </button>
          <div className="model-footer">
            <span className="model-label">{activeModel.keyword}</span>
            {activeModel.url && (
              <a
                href={activeModel.url}
                target="_blank"
                rel="noopener noreferrer"
                className="model-url-btn"
              >
                Open URL
              </a>
            )}
          </div>
        </div>
      )}

      {/* Active rules panel */}
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

      {/* Mode toggle */}
      <div className="mode-toggle">
        <button
          className={`mode-btn${scanMode === 'text' ? ' active' : ''}`}
          onClick={switchToText}
        >
          Text
        </button>
        <button
          className={`mode-btn${scanMode === 'image' ? ' active' : ''}`}
          onClick={switchToImage}
          disabled={!hasImageRules}
          title={!hasImageRules ? 'Add rules with Marker Images in admin to enable' : ''}
        >
          Image
        </button>
      </div>

      <Link to="/admin" className="admin-link">Admin Panel</Link>
    </div>
  );
}
