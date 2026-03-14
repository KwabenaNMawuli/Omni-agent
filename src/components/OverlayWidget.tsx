import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Mic,
  Square,
  Loader2,
  X,
  Send,
  Play,
  CheckCircle2,
  Eye,
  Zap,
  Volume2,
  Camera,
  MessageSquare,
  Terminal as TerminalIcon,
  Download,
  GitBranch,
  Code2,
  Coffee,
  Braces,
  ArrowRight,
  Sparkles,
  CircleDot,
  Power,
  Brain
} from 'lucide-react';
import { createLiveAgentSession, getSetupInstructions, generateSpeech } from '../services/gemini';
import { SetupAction, GeminiResponse, AgentMode, Point, ChatMessage, SessionState, SetupTemplate } from '../types';
import ReactMarkdown from 'react-markdown';
import confetti from 'canvas-confetti';
import VisualOverlay from './VisualOverlay';
import html2canvas from 'html2canvas';

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

function resampleTo16kHzMono(input: Float32Array, inputSampleRate: number): Float32Array {
  if (inputSampleRate === 16000) return input;
  const ratio = inputSampleRate / 16000;
  const newLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const idx = i * ratio;
    const idx0 = Math.floor(idx);
    const idx1 = Math.min(input.length - 1, idx0 + 1);
    const t = idx - idx0;
    output[i] = input[idx0] * (1 - t) + input[idx1] * t;
  }
  return output;
}

function arrayBufferToBase64(buffer: ArrayBufferLike): string {
  let binary = '';
  const ab = buffer instanceof ArrayBuffer ? buffer : buffer.slice(0);
  const bytes = new Uint8Array(ab);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Pre-built setup templates
const TEMPLATES: SetupTemplate[] = [];

const TEMPLATE_ICONS: Record<string, React.ReactNode> = {
  'Braces': <Braces size={16} />,
  'Code2': <Code2 size={16} />,
  'GitBranch': <GitBranch size={16} />,
  'Terminal': <TerminalIcon size={16} />,
  'Coffee': <Coffee size={16} />,
  'Sparkles': <Sparkles size={16} />,
};

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Helper to toggle click-through in Electron
const setClickThrough = (ignore: boolean) => {
  const api = (window as any).omniAPI;
  if (api?.setIgnoreMouseEvents) {
    api.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined);
  }
};

export default function OverlayWidget({ onAction }: { onAction: (action: SetupAction) => Promise<void> }) {
  const DEBUG_OVERLAY = (import.meta as any)?.env?.VITE_OMNI_DEBUG === '1';
  const ALLOW_AUTOMATION = (import.meta as any)?.env?.VITE_OMNI_AUTOMATION === '1';

  const [useLiveAgent, setUseLiveAgent] = useState(true);
  const liveSessionRef = useRef<ReturnType<typeof createLiveAgentSession> | null>(null);
  const liveAudioRef = useRef<HTMLAudioElement | null>(null);
  const liveAudioQueueRef = useRef<string[]>([]);
  const [liveConnected, setLiveConnected] = useState(false);
  const [sentChunks, setSentChunks] = useState(0);
  const [receivedChunks, setReceivedChunks] = useState(0);

  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const micActiveRef = useRef(false);

  const [state, setState] = useState<SessionState>('Idle');
  const [mode, setMode] = useState<AgentMode>('Active');
  const [isOpen, setIsOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [statusText, setStatusText] = useState('');
  const [lastUserTranscript, setLastUserTranscript] = useState('');
  const [debugEvents, setDebugEvents] = useState<string[]>([]);
  const [isHoveringWidget, setIsHoveringWidget] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentResponse, setCurrentResponse] = useState<GeminiResponse | null>(null);
  const [currentActionIndex, setCurrentActionIndex] = useState(-1);
  const [currentCoords, setCurrentCoords] = useState<Point | null>(null);
  const [currentActionDesc, setCurrentActionDesc] = useState<string>('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [displayedText, setDisplayedText] = useState('');
  const [isTypingResponse, setIsTypingResponse] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  const stopLiveAudio = useCallback(() => {
    try {
      liveAudioQueueRef.current = [];
      if (liveAudioRef.current) {
        liveAudioRef.current.pause();
        liveAudioRef.current.src = '';
      }
    } catch (_) {}
  }, []);

  const stopMicStreaming = useCallback(() => {
    micActiveRef.current = false;
    try {
      if (processorNodeRef.current) {
        processorNodeRef.current.onaudioprocess = null;
        try { processorNodeRef.current.disconnect(); } catch (_) {}
      }
      if (sourceNodeRef.current) {
        try { sourceNodeRef.current.disconnect(); } catch (_) {}
      }
      processorNodeRef.current = null;
      sourceNodeRef.current = null;
    } catch (_) {}

    try {
      if (audioCtxRef.current) {
        const ctx = audioCtxRef.current;
        audioCtxRef.current = null;
        ctx.close().catch(() => {});
      }
    } catch (_) {}

    try {
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(t => {
          try { t.stop(); } catch (_) {}
        });
      }
    } catch (_) {}
    micStreamRef.current = null;
  }, []);

  const resetToIdle = useCallback(async () => {
    setStatusText('');
    stopLiveAudio();
    stopMicStreaming();
    try { await liveSessionRef.current?.interrupt?.(); } catch (_) {}
    try { await liveSessionRef.current?.disconnect?.(); } catch (_) {}
    liveSessionRef.current = null;
    setLiveConnected(false);
    setSentChunks(0);
    setReceivedChunks(0);
    setIsListening(false);
    setIsSpeaking(false);
    setState('Idle');
  }, [stopLiveAudio, stopMicStreaming]);

  const startMicStreaming = useCallback(async () => {
    if (micActiveRef.current) return;
    if (!navigator?.mediaDevices?.getUserMedia) throw new Error('getUserMedia is not available');
    if (!liveSessionRef.current) throw new Error('Live session not initialized');
    if (!liveSessionRef.current.getState().connected) await liveSessionRef.current.connect();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    micStreamRef.current = stream;
    micActiveRef.current = true;

    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext = new AudioCtx();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    sourceNodeRef.current = source;

    // ScriptProcessor is deprecated but works well in Electron/Chromium for quick iteration.
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processorNodeRef.current = processor;

    processor.onaudioprocess = (e) => {
      if (!micActiveRef.current) return;
      if (!liveSessionRef.current?.getState().connected) return;
      const input = e.inputBuffer.getChannelData(0);
      const mono16k = resampleTo16kHzMono(input, ctx.sampleRate);
      const pcm16 = floatTo16BitPCM(mono16k);
      const base64 = arrayBufferToBase64(pcm16.buffer);
      liveSessionRef.current
        ?.sendAudioChunk(base64, 'audio/pcm;rate=16000')
        .then(() => setSentChunks(v => v + 1))
        .catch((err: any) => {
          const msg = err?.message || String(err);
          pushDebugEvent(`Live: sendAudioChunk failed: ${msg}`);
          setStatusText(msg);
        });
    };

    source.connect(processor);
    // Do not connect to destination to avoid echo.
    processor.connect(ctx.destination);
  }, []);

  const playNextLiveAudio = useCallback(() => {
    if (!liveAudioRef.current) return;
    if (liveAudioRef.current.paused === false) return;
    const next = liveAudioQueueRef.current.shift();
    if (!next) return;
    liveAudioRef.current.src = next;
    liveAudioRef.current.play().catch(() => {
      // If autoplay fails, drop the chunk to avoid deadlocking the queue
      try { liveAudioRef.current?.pause(); } catch (_) {}
      playNextLiveAudio();
    });
  }, []);

  useEffect(() => {
    if (!liveAudioRef.current) {
      const a = new Audio();
      a.onended = () => playNextLiveAudio();
      a.onerror = () => playNextLiveAudio();
      liveAudioRef.current = a;
    }
    return () => {
      stopLiveAudio();
      stopMicStreaming();
      try { liveSessionRef.current?.disconnect?.(); } catch (_) {}
      liveSessionRef.current = null;
    };
  }, [playNextLiveAudio, stopLiveAudio, stopMicStreaming]);

  useEffect(() => {
    // In Electron, keep the overlay click-through by default so the user can
    // interact with other apps. Only capture mouse while hovering the widget.
    // During Acting, ALWAYS be click-through so automation reaches the desktop.
    setClickThrough(state === 'Acting' || !isHoveringWidget);
  }, [state, isHoveringWidget]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, displayedText]);

  // Typing animation for assistant response
  useEffect(() => {
    if (!isTypingResponse || !currentResponse) return;
    const fullText = currentResponse.explanation;
    if (displayedText.length < fullText.length) {
      const timer = setTimeout(() => {
        const chunkSize = Math.floor(Math.random() * 3) + 2;
        setDisplayedText(fullText.slice(0, displayedText.length + chunkSize));
      }, 15);
      return () => clearTimeout(timer);
    } else {
      setIsTypingResponse(false);
    }
  }, [displayedText, isTypingResponse, currentResponse]);

  useEffect(() => {
    return () => {
      stopLiveAudio();
      stopMicStreaming();
      try { liveSessionRef.current?.disconnect?.(); } catch (_) {}
    };
  }, [stopLiveAudio, stopMicStreaming]);

  const pushDebugEvent = useCallback((message: string) => {
    if (!DEBUG_OVERLAY) return;
    const ts = new Date().toLocaleTimeString();
    setDebugEvents(prev => [`[${ts}] ${message}`, ...prev].slice(0, 12));
  }, [DEBUG_OVERLAY]);

  const startListening = useCallback(async () => {
    if (micActiveRef.current) return;

    // If the model is speaking, stop it immediately.
    try { await liveSessionRef.current?.interrupt?.(); } catch (_) {}
    stopLiveAudio();

    try {
      await startMicStreaming();
      setIsListening(true);
      setState('Listening');
    } catch (e: any) {
      setStatusText(e?.message || String(e));
      setIsListening(false);
      setState('Idle');
    }
  }, [startMicStreaming, stopLiveAudio]);

  const stopListening = useCallback(() => {
    if (!micActiveRef.current) return;
    stopMicStreaming();
    setIsListening(false);
    setState('Responding');
  }, [stopMicStreaming]);

  const playAudio = async (text: string) => {
    setIsSpeaking(true);
    try {
      const base64 = await generateSpeech(text);
      if (base64) {
        const audio = new Audio();
        audio.src = `data:audio/mp3;base64,${base64}`;
        audio.onended = () => setIsSpeaking(false);
        audio.onerror = () => setIsSpeaking(false);
        await audio.play();
      } else {
        setIsSpeaking(false);
      }
    } catch {
      setIsSpeaking(false);
    }
  };

  const captureScreen = async (): Promise<string | null> => {
    setIsCapturing(true);

    const api = (window as any).omniAPI;

    // In Electron: use desktopCapturer via IPC to capture the real screen
    if (api?.captureScreen) {
      try {
        const screenshot = await api.captureScreen();
        setIsCapturing(false);
        return screenshot || null;
      } catch (e) {
        console.error('Electron screen capture failed:', e);
        setIsCapturing(false);
        return null;
      }
    }

    // Fallback for browser mode: capture the page DOM with html2canvas
    const element = document.getElementById('omni-capture-area');
    if (!element) { setIsCapturing(false); return null; }

    try {
      const canvas = await html2canvas(element, {
        backgroundColor: '#050505',
        scale: 1,
        logging: false,
        useCORS: true,
        onclone: (clonedDoc) => {
          const style = clonedDoc.createElement('style');
          style.innerHTML = `* { color-scheme: dark !important; }
            .text-emerald-500 { color: #10b981 !important; }
            .bg-emerald-500 { background-color: #10b981 !important; }`;
          clonedDoc.head.appendChild(style);
        }
      });
      setIsCapturing(false);
      return canvas.toDataURL('image/webp', 0.7);
    } catch (e) {
      console.error("Capture failed", e);
      setIsCapturing(false);
      return null;
    }
  };

  const handleSubmit = async (text?: string) => {
    const query = text || inputText.trim();
    if (!query) return;

    if (useLiveAgent) {
      // Minimal Live API test flow: connect (if needed), send text, listen for text/audio events.
      const userMsg: ChatMessage = {
        id: generateId(),
        role: 'user',
        content: query,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, userMsg]);
      setInputText('');
      setStatusText('');
      setState('Talking');

      try {
        if (!liveSessionRef.current) {
          liveSessionRef.current = createLiveAgentSession({ responseModalities: ['AUDIO', 'TEXT'] });
          liveSessionRef.current.onEvent((e) => {
            if (e.type === 'connected') {
              setLiveConnected(true);
              pushDebugEvent('Live: connected');
              setState('Responding');
              return;
            }
            if (e.type === 'disconnected') {
              setLiveConnected(false);
              pushDebugEvent('Live: disconnected');
              setState('Idle');
              return;
            }
            if (e.type === 'interrupted') {
              pushDebugEvent('Live: interrupted');
              stopLiveAudio();
              return;
            }
            if (e.type === 'text') {
              const assistantMsg: ChatMessage = {
                id: generateId(),
                role: 'assistant',
                content: e.text,
                timestamp: new Date(),
                status: 'complete',
              };
              setMessages(prev => [...prev, assistantMsg]);
              setState('Responding');
              return;
            }
            if (e.type === 'audio') {
              const src = `data:${e.mimeType};base64,${e.data}`;
              liveAudioQueueRef.current.push(src);
              playNextLiveAudio();
              return;
            }
            if (e.type === 'error') {
              pushDebugEvent(`Live error: ${e.message}`);
              setStatusText(e.message);
              setState('Responding');
            }
          });
        }

        if (!liveSessionRef.current.getState().connected) {
          await liveSessionRef.current.connect();
        }

        await liveSessionRef.current.sendText(query, true);
        setState('Responding');
      } catch (err: any) {
        setStatusText(err?.message || String(err));
        setState('Responding');
      }
      return;
    }

    setLastUserTranscript(query);
    pushDebugEvent('Submitting request to AI');

    // Add user message
    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: query,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setStatusText('');
    setState('Talking');

    // Capture screen context
    const screenshot = await captureScreen();
    if (!screenshot) {
      const msg = 'Screen capture failed. Check OS permissions (screen recording) and Electron desktopCapturer.';
      pushDebugEvent(msg);
      setStatusText(msg);
      const errorMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: `Error: ${msg}`,
        timestamp: new Date(),
        status: 'error',
      };
      setMessages(prev => [...prev, errorMsg]);
      setCurrentResponse({ explanation: msg, actions: [], status: 'error' });
      setDisplayedText(msg);
      setState('Responding');
      return;
    }

    // Fetch contextual data from Electron if available
    const api = (window as any).omniAPI;
    let visualBuffer = undefined;
    let screenDimensions = undefined;
    let environmentInfo = undefined;
    if (api?.getVisualBuffer) {
      try { visualBuffer = await api.getVisualBuffer(); } catch (e: any) {
        const msg = e?.message || String(e);
        pushDebugEvent(`getVisualBuffer failed: ${msg}`);
        setStatusText(`getVisualBuffer failed: ${msg}`);
      }
    }
    if (api?.getScreenDimensions) {
      try { screenDimensions = await api.getScreenDimensions(); } catch (e: any) {
        const msg = e?.message || String(e);
        pushDebugEvent(`getScreenDimensions failed: ${msg}`);
        setStatusText(`getScreenDimensions failed: ${msg}`);
      }
    }
    if (api?.getEnvInfo) {
      try {
        const info = await api.getEnvInfo();
        environmentInfo = {
          os: info.os,
          shell: info.shell,
          nodeVersion: info.nodeVersion,
          electronVersion: info.electronVersion,
        };
      } catch (e: any) {
        const msg = e?.message || String(e);
        pushDebugEvent(`getEnvInfo failed: ${msg}`);
        setStatusText(`getEnvInfo failed: ${msg}`);
      }
    }

    // Call Gemini with conversation history + visual context
    try {
      pushDebugEvent('Capturing screen/context...');
      const res = await getSetupInstructions(
        query,
        mode,
        ALLOW_AUTOMATION,
        screenshot || undefined,
        visualBuffer,
        messages,
        screenDimensions,
        environmentInfo
      );

      pushDebugEvent('AI response received');
      if (res.modelUsed) pushDebugEvent(`Thinking model: ${res.modelUsed}`);
      setCurrentResponse(res);

      // Add assistant message
      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: res.explanation,
        actions: res.actions,
        timestamp: new Date(),
        status: res.status === 'error' ? 'error' : 'complete',
      };
      setMessages(prev => [...prev, assistantMsg]);

      // Start typing animation and show response widget
      setDisplayedText('');
      setIsTypingResponse(true);
      setState('Responding');

      // If there are actions, execute them after a short delay so user sees the response
      if (res.actions.length > 0) {
        if (ALLOW_AUTOMATION) {
          pushDebugEvent(`Executing ${res.actions.length} action(s)...`);
          setTimeout(() => executeActions(res), 2000);
        } else {
          pushDebugEvent('Automation disabled; ignoring suggested actions');
        }
      }
    } catch (err: any) {
      console.error('Gemini API error:', err);
      const errMsg = err?.message || String(err);
      pushDebugEvent(`AI error: ${errMsg}`);
      setStatusText(errMsg);
      const errorMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: `Error: ${errMsg}`,
        timestamp: new Date(),
        status: 'error',
      };
      setMessages(prev => [...prev, errorMsg]);
      setCurrentResponse({ explanation: errMsg, actions: [], status: 'error' });
      setDisplayedText(errMsg);
      setState('Responding');
    }
  };

  const executeActions = async (res: GeminiResponse) => {
    if (!ALLOW_AUTOMATION) {
      pushDebugEvent('Automation disabled; not executing actions');
      setState('Responding');
      return;
    }
    if (!res || res.actions.length === 0) {
      setState('Responding');
      return;
    }

    setState('Acting');
    // Enable click-through during action execution so nut.js clicks reach the desktop
    setClickThrough(true);

    for (let i = 0; i < res.actions.length; i++) {
      const action = res.actions[i];
      setCurrentActionIndex(i);
      setCurrentActionDesc(action.description);

      if (action.coordinates) {
        setCurrentCoords(action.coordinates);
      } else {
        setCurrentCoords(null);
      }

      if (mode === 'Passive') {
        await playAudio(action.description);
        const api = (window as any).omniAPI;
        if (api?.waitForScreenStable) {
          await api.waitForScreenStable({ timeoutMs: 10000 });
        } else {
          await new Promise(r => setTimeout(r, 3000));
        }
      } else {
        await onAction(action);

        const api = (window as any).omniAPI;
        if (api?.waitForScreenStable) {
          const result = await api.waitForScreenStable({
            timeoutMs: action.type === 'command' ? 120000 : 15000,
            intervalMs: action.type === 'command' ? 1500 : 800,
          });
          console.log(`[Omni] Screen ${result.stable ? 'stabilized' : 'timed out'} after ${result.elapsed}ms`);
        } else {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    setClickThrough(false);
    pushDebugEvent('Actions complete');
    setState('Responding');
    setCurrentActionIndex(-1);
    setCurrentCoords(null);
    setCurrentActionDesc('');
    confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
  };

  const handleTemplateClick = (template: SetupTemplate) => {
    handleSubmit(template.prompt);
  };

  return (
    <>
      <VisualOverlay
        mode={mode}
        coordinates={currentCoords}
        isActive={state === 'Acting'}
        actionDescription={currentActionDesc}
      />

      {/* Scanning Effect */}
      <AnimatePresence>
        {isCapturing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] pointer-events-none overflow-hidden"
          >
            <motion.div
              initial={{ top: '-5%' }}
              animate={{ top: '105%' }}
              transition={{ duration: 1.2, ease: "linear" }}
              className="absolute left-0 right-0 h-0.5 bg-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.6)]"
            />
            <div className="absolute inset-0 bg-emerald-500/[0.02]" />
          </motion.div>
        )}
      </AnimatePresence>

              <div
                className="fixed bottom-8 right-8 z-50 flex flex-col items-end gap-3"
                onMouseEnter={() => setIsHoveringWidget(true)}
                onMouseLeave={() => setIsHoveringWidget(false)}
              >
                {/* Voice-first status / stop button */}
                <AnimatePresence mode="popLayout">
                  {isHoveringWidget && useLiveAgent && (
                    <motion.div
                      key="voice-status"
                      initial={{ opacity: 0, scale: 0.98, y: 8 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.98, y: 8 }}
                      className="px-3 py-2 rounded-full bg-zinc-900/60 backdrop-blur-2xl border border-white/10 shadow-2xl flex items-center gap-2"
                    >
                      <div className={liveConnected ? 'text-emerald-400' : 'text-white/40'}>
                        <CircleDot size={14} />
                      </div>
                      <span className="text-[11px] text-white/60 font-medium">
                        {liveConnected
                          ? (isListening ? `listening · ↑${sentChunks} ↓${receivedChunks}` : `ready · ↑${sentChunks} ↓${receivedChunks}`)
                          : (statusText ? statusText : 'connecting...')}
                      </span>
                      <button
                        onClick={async () => {
                          await resetToIdle();
                        }}
                        className="ml-2 px-3 py-1 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-semibold text-white/70"
                      >
                        Stop
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                <motion.button
                  layout
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  animate={state === 'Listening' ? { scale: 1.05 } : { scale: 1 }}
                  onClick={async () => {
                    setStatusText('');
                    if (!useLiveAgent) {
                      startListening();
                      return;
                    }

                    // Voice-first Live:
                    // - click to start talking (auto-connect)
                    // - click again to stop
                    if (isListening) {
                      stopListening();
                      return;
                    }

                    try {
                      if (!liveSessionRef.current) {
                        liveSessionRef.current = createLiveAgentSession({ responseModalities: ['AUDIO', 'TEXT'] });
                        liveSessionRef.current.onEvent((e) => {
                          if (e.type === 'connected') {
                            setLiveConnected(true);
                            pushDebugEvent('Live: connected');
                            setStatusText('');
                            return;
                          }
                          if (e.type === 'disconnected') {
                            setLiveConnected(false);
                            pushDebugEvent('Live: disconnected');
                            stopMicStreaming();
                            stopLiveAudio();
                            setIsListening(false);
                            setState('Idle');
                            setStatusText('Live disconnected');
                            return;
                          }
                          if (e.type === 'interrupted') {
                            pushDebugEvent('Live: interrupted');
                            stopLiveAudio();
                            return;
                          }
                          if (e.type === 'audio') {
                            const src = `data:${e.mimeType};base64,${e.data}`;
                            liveAudioQueueRef.current.push(src);
                            setReceivedChunks(v => v + 1);
                            playNextLiveAudio();
                            return;
                          }
                          if (e.type === 'text') {
                            const assistantMsg: ChatMessage = {
                              id: generateId(),
                              role: 'assistant',
                              content: e.text,
                              timestamp: new Date(),
                              status: 'complete',
                            };
                            setMessages(prev => [...prev, assistantMsg]);
                            return;
                          }
                          if (e.type === 'error') {
                            pushDebugEvent(`Live error: ${e.message}`);
                            setStatusText(e.message);
                            if (String(e.message || '').toLowerCase().includes('websocket')) {
                              stopMicStreaming();
                              setIsListening(false);
                              setState('Idle');
                            }
                          }
                        });
                      }

                      if (!liveSessionRef.current.getState().connected) {
                        setStatusText('Connecting to Live...');
                        const connectPromise = liveSessionRef.current.connect();
                        const timeoutPromise = new Promise<void>((_, reject) =>
                          setTimeout(() => reject(new Error('Live connect timed out (10s). Check GEMINI_API_KEY / network / model id.')), 10000)
                        );
                        await Promise.race([connectPromise, timeoutPromise]);
                      }
                    } catch (e: any) {
                      setLiveConnected(false);
                      stopMicStreaming();
                      stopLiveAudio();
                      setIsListening(false);
                      setState('Idle');
                      setStatusText(e?.message || String(e));
                      return;
                    }

                    // Starting to talk interrupts any ongoing model speech.
                    try { await liveSessionRef.current?.interrupt?.(); } catch (_) {}
                    stopLiveAudio();
                    startListening();
                  }}
                  className={`flex items-center gap-2.5 px-4 h-11 rounded-full shadow-2xl transition-all duration-300 backdrop-blur-2xl border relative group z-50 ${state === 'Listening'
                    ? 'bg-emerald-500/20 border-emerald-500/30 shadow-emerald-500/20'
                    : 'bg-zinc-900/60 border-white/10 hover:bg-zinc-900/80 hover:border-white/20'
                    }`}
        >
          <div className="relative w-4 h-4 flex items-center justify-center">
            <AnimatePresence mode="wait">
              {state !== 'Listening' ? (
                <motion.div
                  key="mic"
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={{ duration: 0.15 }}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <Mic className="text-white/80 group-hover:text-white transition-colors" size={16} />
                </motion.div>
              ) : (
                <motion.div
                  key="viz"
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  className="absolute inset-0 flex items-center justify-center gap-[2px] h-3.5"
                >
                  {[
                    ['30%', '90%', '40%', '100%', '30%'],
                    ['40%', '100%', '20%', '80%', '40%'],
                    ['50%', '80%', '40%', '100%', '50%'],
                    ['20%', '100%', '50%', '80%', '20%']
                  ].map((heights, i) => (
                    <motion.div
                      key={i}
                      animate={{ height: heights }}
                      transition={{
                        duration: 1.5 + i * 0.3,
                        repeat: Infinity,
                        repeatType: 'reverse',
                        ease: "easeInOut"
                      }}
                      className="w-[2px] rounded-full bg-blue-400"
                    />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <span className="text-[13px] font-semibold text-white/90 tracking-wide">Omni</span>
        </motion.button>
      </div>
    </>
  );
}
