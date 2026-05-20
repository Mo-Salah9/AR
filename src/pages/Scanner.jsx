import { useEffect, useRef, useState, useCallback } from 'react';
import { createWorker } from 'tesseract.js';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';

const SCAN_MS = 1500;

export default function Scanner() {
  const videoRef   = useRef(null);
  const captureRef = useRef(null);
  const overlayRef = useRef(null);
  const workerRef  = useRef(null);
  const intervalRef   = useRef(null);
  const scanningRef   = useRef(false);
  const triggeredRef  = useRef(new Set());
  const rulesRef      = useRef([]);
  const aliveRef      = useRef(true);

  const [rules,      setRules]      = useState([]);
  const [status,     setStatus]     = useState('Initializing…');
  const [isScanning, setIsScanning] = useState(false);
  const [banner,     setBanner]     = useState(null);

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

  useEffect(() => {
    aliveRef.current = true;

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

    function handleDetection(text, words) {
      drawOverlay(words);
      const upper = text.toUpperCase();
      for (const rule of rulesRef.current) {
        const kw = rule.keyword.toUpperCase();
        if (!upper.includes(kw) || triggeredRef.current.has(rule.id)) continue;
        triggeredRef.current.add(rule.id);
        const display = rule.url.replace(/^https?:\/\//, '');
        setBanner(`"${rule.keyword}" detected — opening ${display}…`);
        setTimeout(() => window.open(rule.url, '_blank'), 600);
        setTimeout(() => setBanner(null), 4000);
      }
    }

    async function boot() {
      await fetchRules();

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

      setStatus('Loading OCR engine…');
      try {
        workerRef.current = await createWorker('eng', 1, { logger: () => {} });
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
            if (aliveRef.current) handleDetection(data.text ?? '', data.words ?? []);
          } catch (_) {}
        }
        scanningRef.current = false;
      }, SCAN_MS);
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
      window.removeEventListener('resize', syncCanvas);
      clearInterval(intervalRef.current);
      workerRef.current?.terminate();
      videoRef.current?.srcObject?.getTracks().forEach(t => t.stop());
      supabase.removeChannel(channel);
    };
  }, [fetchRules]);

  return (
    <div className="scanner">
      <video ref={videoRef} autoPlay playsInline muted />
      <canvas ref={overlayRef} className="overlay" />
      <canvas ref={captureRef} style={{ display: 'none' }} />

      <div className={`status-bar${isScanning ? ' scanning' : ''}`}>
        <span className="dot" />
        {status}
      </div>

      {banner && <div className="banner">{banner}</div>}

      <div className="rules-panel">
        <p className="panel-title">Active Rules</p>
        {rules.length === 0
          ? <p className="no-rules">No active rules</p>
          : rules.map(r => (
            <div key={r.id} className="rule-chip">
              <span className="kw">{r.keyword}</span>
              <span className="arrow">→</span>
              <span className="url">{r.url.replace(/^https?:\/\//, '')}</span>
            </div>
          ))
        }
      </div>

      <Link to="/admin" className="admin-link">Admin Panel</Link>
    </div>
  );
}
