import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Camera,
  Play,
  Pause,
  Square,
  Volume2,
  Loader2,
  RefreshCw,
  Settings,
  BookOpen,
  Zap,
  ZapOff,
} from 'lucide-react';

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const utteranceRef = useRef(null);
  const autoIntervalRef = useRef(null);
  const recentTextsRef = useRef([]);
  const isProcessingRef = useRef(false);

  const [cameraOn, setCameraOn] = useState(false);
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [detectedText, setDetectedText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [detectedLang, setDetectedLang] = useState('');
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [rate, setRate] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [history, setHistory] = useState([]);
  const [tesseractReady, setTesseractReady] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [autoInterval, setAutoInterval] = useState(2500);
  const [lastScanInfo, setLastScanInfo] = useState('');

  useEffect(() => {
    if (window.Tesseract) {
      setTesseractReady(true);
      return;
    }
    const script = document.createElement('script');
    script.src =
      'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.4/tesseract.min.js';
    script.async = true;
    script.onload = () => setTesseractReady(true);
    script.onerror = () => {
      setErrorMsg('Failed to load text recognition engine');
      setStatus('error');
    };
    document.body.appendChild(script);
  }, []);

  useEffect(() => {
    const loadVoices = () => {
      const v = window.speechSynthesis.getVoices();
      setVoices(v);
      if (v.length > 0 && !selectedVoice) {
        const preferred =
          v.find((x) => x.lang.startsWith('en') && x.name.includes('Google')) ||
          v.find((x) => x.lang.startsWith('en')) ||
          v[0];
        setSelectedVoice(preferred);
      }
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, [selectedVoice]);

  const startCamera = async () => {
    try {
      setErrorMsg('');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraOn(true);
    } catch (err) {
      setErrorMsg('Camera access denied. Please allow camera permission.');
      setStatus('error');
    }
  };

  const stopCamera = () => {
    stopAutoMode();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOn(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
      window.speechSynthesis.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const detectLanguage = (text) => {
    const hasHiragana = /[\u3040-\u309F]/.test(text);
    const hasKatakana = /[\u30A0-\u30FF]/.test(text);
    const hasHangul = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(text);
    const hasCJK = /[\u4E00-\u9FFF]/.test(text);
    if (hasHangul) return 'ko';
    if (hasHiragana || hasKatakana) return 'ja';
    if (hasCJK) return 'ja';
    return 'en';
  };

  const normalize = (s) => {
    return s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const similarity = (a, b) => {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const bigrams = (s) => {
      const map = new Map();
      for (let i = 0; i < s.length - 1; i++) {
        const bg = s.slice(i, i + 2);
        map.set(bg, (map.get(bg) || 0) + 1);
      }
      return map;
    };
    const A = bigrams(a);
    const B = bigrams(b);
    let intersection = 0;
    let totalA = 0,
      totalB = 0;
    A.forEach((v) => (totalA += v));
    B.forEach((v) => (totalB += v));
    A.forEach((count, bg) => {
      if (B.has(bg)) intersection += Math.min(count, B.get(bg));
    });
    return (2 * intersection) / (totalA + totalB);
  };

  const isDuplicate = (candidate) => {
    const norm = normalize(candidate);
    if (!norm || norm.length < 3) return true;
    for (const prev of recentTextsRef.current) {
      if (similarity(norm, prev) >= 0.75) return true;
    }
    return false;
  };

  const rememberText = (text) => {
    const norm = normalize(text);
    recentTextsRef.current = [norm, ...recentTextsRef.current].slice(0, 8);
  };

  const translateText = async (text, sourceLang) => {
    if (sourceLang === 'en') return text;
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [
            {
              role: 'user',
              content: `Translate this ${
                sourceLang === 'ja' ? 'Japanese manga' : 'Korean manhwa'
              } dialogue to natural English. Output ONLY the translation, no explanations, no quotes, no labels. Preserve emotional tone and speech patterns.\n\nText: ${text}`,
            },
          ],
        }),
      });
      const data = await response.json();
      const translated = data.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('')
        .trim();
      return translated || text;
    } catch (err) {
      console.error('Translation error:', err);
      return text;
    }
  };

  const speak = (text) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.rate = rate;
    utterance.onstart = () => setStatus('speaking');
    utterance.onend = () => setStatus('idle');
    utterance.onerror = () => setStatus('idle');
    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  };

  const scanOnce = useCallback(
    async ({ silentOnDuplicate = false } = {}) => {
      if (!tesseractReady || isProcessingRef.current) return false;
      if (!videoRef.current || !canvasRef.current) return false;
      if (!videoRef.current.videoWidth) return false;

      if (window.speechSynthesis.speaking) {
        setLastScanInfo('waiting for speech to finish...');
        return false;
      }

      isProcessingRef.current = true;
      try {
        setStatus('capturing');
        setErrorMsg('');

        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        setStatus('ocr');
        const { data } = await window.Tesseract.recognize(
          canvas,
          'eng+jpn+kor',
          { logger: () => {} }
        );

        const raw = (data.text || '').trim();
        if (!raw) {
          if (!silentOnDuplicate)
            setErrorMsg(
              'No text detected. Try getting closer or better lighting.'
            );
          setLastScanInfo('no text found');
          setStatus('idle');
          return false;
        }

        const cleaned = raw
          .replace(/[\|\_\~\`]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (isDuplicate(cleaned)) {
          setLastScanInfo('same panel — skipped');
          setStatus('idle');
          return false;
        }

        setDetectedText(cleaned);
        const lang = detectLanguage(cleaned);
        setDetectedLang(lang);

        let toSpeak = cleaned;
        if (lang !== 'en') {
          setStatus('translating');
          toSpeak = await translateText(cleaned, lang);
          setTranslatedText(toSpeak);
        } else {
          setTranslatedText('');
        }

        rememberText(cleaned);
        if (toSpeak) rememberText(toSpeak);

        setHistory((prev) => [
          { original: cleaned, translated: toSpeak, lang, time: Date.now() },
          ...prev.slice(0, 9),
        ]);

        setLastScanInfo('new panel');
        speak(toSpeak);
        return true;
      } catch (err) {
        console.error(err);
        if (!silentOnDuplicate) setErrorMsg('Something went wrong. Try again.');
        setStatus('idle');
        return false;
      } finally {
        isProcessingRef.current = false;
      }
    },
    [tesseractReady, selectedVoice, rate]
  );

  const startAutoMode = () => {
    recentTextsRef.current = [];
    setAutoMode(true);
    const tick = () => scanOnce({ silentOnDuplicate: true });
    tick();
    autoIntervalRef.current = setInterval(tick, autoInterval);
  };

  const stopAutoMode = () => {
    setAutoMode(false);
    if (autoIntervalRef.current) {
      clearInterval(autoIntervalRef.current);
      autoIntervalRef.current = null;
    }
  };

  const toggleAuto = () => {
    if (autoMode) stopAutoMode();
    else startAutoMode();
  };

  useEffect(() => {
    if (autoMode && autoIntervalRef.current) {
      clearInterval(autoIntervalRef.current);
      autoIntervalRef.current = setInterval(
        () => scanOnce({ silentOnDuplicate: true }),
        autoInterval
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoInterval]);

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setStatus('idle');
  };

  const replay = (text) => speak(text);

  const clearMemory = () => {
    recentTextsRef.current = [];
    setLastScanInfo('memory cleared');
  };

  const statusLabel = {
    idle: autoMode ? 'watching...' : 'ready',
    capturing: 'capturing frame...',
    ocr: 'reading text...',
    translating: 'translating...',
    speaking: 'speaking',
    error: 'error',
  }[status];

  return (
    <div
      className="min-h-screen bg-stone-950 text-stone-100"
      style={{ fontFamily: "'Crimson Pro', Georgia, serif" }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,400;0,600;0,700;1,400&family=Space+Mono:wght@400;700&display=swap');
        .mono { font-family: 'Space Mono', monospace; }
        .ink-border { border: 1px solid rgba(245, 230, 211, 0.15); }
        .vignette::after {
          content: '';
          position: absolute; inset: 0;
          background: radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.6) 100%);
          pointer-events: none;
        }
        @keyframes pulse-ring {
          0% { box-shadow: 0 0 0 0 rgba(234, 179, 8, 0.7); }
          70% { box-shadow: 0 0 0 20px rgba(234, 179, 8, 0); }
          100% { box-shadow: 0 0 0 0 rgba(234, 179, 8, 0); }
        }
        .pulse { animation: pulse-ring 1.8s infinite; }
        @keyframes scan-line {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100%); }
        }
        .scanline {
          position: absolute; left: 0; right: 0; height: 2px;
          background: linear-gradient(90deg, transparent, rgba(234,179,8,0.8), transparent);
          animation: scan-line 2.5s ease-in-out infinite;
        }
        .grain {
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.35'/%3E%3C/svg%3E");
        }
      `}</style>

      <div className="max-w-5xl mx-auto px-5 py-6">
        <header className="flex items-baseline justify-between mb-6 pb-4 border-b border-stone-800">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              Koma<span className="text-amber-400">.</span>Reader
            </h1>
            <p className="text-stone-500 text-sm mono mt-1">
              manga / manhwa → voice
            </p>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 hover:bg-stone-900 rounded transition"
            aria-label="Settings"
          >
            <Settings size={20} />
          </button>
        </header>

        {showSettings && (
          <div className="ink-border bg-stone-900/50 rounded p-4 mb-5 space-y-4">
            <div>
              <label className="text-xs mono text-stone-400 block mb-1">
                VOICE
              </label>
              <select
                value={selectedVoice?.name || ''}
                onChange={(e) =>
                  setSelectedVoice(
                    voices.find((v) => v.name === e.target.value)
                  )
                }
                className="w-full bg-stone-950 border border-stone-700 rounded px-3 py-2 text-sm"
              >
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs mono text-stone-400 block mb-1">
                SPEED: {rate.toFixed(1)}x
              </label>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={rate}
                onChange={(e) => setRate(parseFloat(e.target.value))}
                className="w-full accent-amber-400"
              />
            </div>
            <div>
              <label className="text-xs mono text-stone-400 block mb-1">
                AUTO-SCAN EVERY: {(autoInterval / 1000).toFixed(1)}s
              </label>
              <input
                type="range"
                min="1500"
                max="6000"
                step="500"
                value={autoInterval}
                onChange={(e) => setAutoInterval(parseInt(e.target.value))}
                className="w-full accent-amber-400"
              />
              <p className="text-[10px] mono text-stone-600 mt-1">
                lower = faster · higher = easier on battery
              </p>
            </div>
            <button
              onClick={clearMemory}
              className="w-full mono text-[10px] tracking-widest py-2 border border-stone-700 rounded hover:bg-stone-800 transition"
            >
              CLEAR DUPLICATE MEMORY
            </button>
          </div>
        )}

        <div className="relative rounded-lg overflow-hidden bg-black ink-border aspect-[4/3] vignette mb-4">
          {cameraOn ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-stone-500 grain">
              <BookOpen size={48} className="mb-3 opacity-40" />
              <p className="mono text-xs tracking-widest">
                POINT AT ANOTHER SCREEN
              </p>
              <p className="text-sm mt-1 text-stone-600">
                Tap below to start the camera
              </p>
            </div>
          )}

          {cameraOn && (
            <>
              <div className="absolute top-4 left-4 w-6 h-6 border-t-2 border-l-2 border-amber-400/80" />
              <div className="absolute top-4 right-4 w-6 h-6 border-t-2 border-r-2 border-amber-400/80" />
              <div className="absolute bottom-4 left-4 w-6 h-6 border-b-2 border-l-2 border-amber-400/80" />
              <div className="absolute bottom-4 right-4 w-6 h-6 border-b-2 border-r-2 border-amber-400/80" />
              {autoMode && <div className="scanline" />}
            </>
          )}

          <div className="absolute top-3 left-1/2 -translate-x-1/2 mono text-[10px] tracking-widest uppercase bg-black/60 backdrop-blur px-3 py-1 rounded-full flex items-center gap-2">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                status === 'idle'
                  ? autoMode
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-stone-500'
                  : status === 'error'
                  ? 'bg-red-500'
                  : 'bg-amber-400 animate-pulse'
              }`}
            />
            {statusLabel}
          </div>

          {autoMode && lastScanInfo && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 mono text-[10px] tracking-wider text-stone-400 bg-black/60 backdrop-blur px-3 py-1 rounded-full">
              {lastScanInfo}
            </div>
          )}
        </div>

        <canvas ref={canvasRef} className="hidden" />

        <div className="flex items-center justify-center gap-3 mb-6 flex-wrap">
          {!cameraOn ? (
            <button
              onClick={startCamera}
              className="flex items-center gap-2 bg-amber-400 text-stone-950 px-6 py-3 rounded-full font-semibold hover:bg-amber-300 transition"
            >
              <Camera size={18} />
              Start Camera
            </button>
          ) : (
            <>
              <button
                onClick={stopCamera}
                className="p-3 ink-border bg-stone-900 hover:bg-stone-800 rounded-full transition"
                aria-label="Stop camera"
              >
                <Square size={18} />
              </button>

              <button
                onClick={() => scanOnce()}
                disabled={
                  autoMode ||
                  status === 'capturing' ||
                  status === 'ocr' ||
                  status === 'translating' ||
                  !tesseractReady
                }
                className="flex items-center gap-2 bg-amber-400 text-stone-950 px-6 py-3 rounded-full font-semibold hover:bg-amber-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {status === 'capturing' ||
                status === 'ocr' ||
                status === 'translating' ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> Working...
                  </>
                ) : (
                  <>
                    <Volume2 size={18} /> Read Once
                  </>
                )}
              </button>

              <button
                onClick={toggleAuto}
                disabled={!tesseractReady}
                className={`flex items-center gap-2 px-6 py-3 rounded-full font-semibold transition disabled:opacity-40 ${
                  autoMode
                    ? 'bg-stone-100 text-stone-950 hover:bg-white pulse'
                    : 'ink-border bg-stone-900 hover:bg-stone-800 text-stone-100'
                }`}
              >
                {autoMode ? (
                  <>
                    <ZapOff size={18} /> Stop Auto
                  </>
                ) : (
                  <>
                    <Zap size={18} /> Auto Read
                  </>
                )}
              </button>

              {status === 'speaking' && (
                <button
                  onClick={stopSpeaking}
                  className="p-3 ink-border bg-stone-900 hover:bg-stone-800 rounded-full transition"
                  aria-label="Stop speaking"
                >
                  <Pause size={18} />
                </button>
              )}
            </>
          )}
        </div>

        {errorMsg && (
          <div className="border border-red-900/50 bg-red-950/30 text-red-300 px-4 py-3 rounded mb-4 text-sm">
            {errorMsg}
          </div>
        )}

        {(detectedText || translatedText) && (
          <div className="ink-border rounded-lg p-5 mb-6 bg-stone-900/40">
            <div className="flex items-center justify-between mb-3">
              <span className="mono text-[10px] tracking-widest text-amber-400">
                DETECTED · {detectedLang?.toUpperCase() || '—'}
              </span>
              <button
                onClick={() => replay(translatedText || detectedText)}
                className="text-stone-400 hover:text-amber-400 transition"
                aria-label="Replay"
              >
                <RefreshCw size={14} />
              </button>
            </div>
            {detectedText && (
              <p className="text-stone-400 text-sm italic mb-3 leading-relaxed">
                {detectedText}
              </p>
            )}
            {translatedText && (
              <p className="text-lg leading-relaxed">{translatedText}</p>
            )}
          </div>
        )}

        {history.length > 0 && (
          <div>
            <h2 className="mono text-[10px] tracking-widest text-stone-500 mb-3">
              RECENT PANELS
            </h2>
            <div className="space-y-2">
              {history.map((item, idx) => (
                <button
                  key={item.time}
                  onClick={() => replay(item.translated)}
                  className="w-full text-left ink-border rounded p-3 hover:bg-stone-900 transition group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="mono text-[9px] tracking-widest text-stone-600 mb-1">
                        #{String(history.length - idx).padStart(2, '0')} ·{' '}
                        {item.lang.toUpperCase()}
                      </div>
                      <p className="text-sm text-stone-300 line-clamp-2">
                        {item.translated}
                      </p>
                    </div>
                    <Play
                      size={14}
                      className="text-stone-600 group-hover:text-amber-400 transition flex-shrink-0 mt-1"
                    />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-xs text-stone-600 mt-8 mono">
          {autoMode
            ? "auto mode on · turn the page and it'll catch up"
            : 'tap read once · or flip on auto for hands-free'}
        </p>
      </div>
    </div>
  );
}
