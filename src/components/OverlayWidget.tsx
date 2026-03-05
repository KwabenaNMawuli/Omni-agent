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
import { getSetupInstructions, generateSpeech } from '../services/gemini';
import { SetupAction, GeminiResponse, AgentMode, Point, ChatMessage, SessionState, SetupTemplate } from '../types';
import ReactMarkdown from 'react-markdown';
import confetti from 'canvas-confetti';
import VisualOverlay from './VisualOverlay';
import html2canvas from 'html2canvas';

// Pre-built setup templates
const TEMPLATES: SetupTemplate[] = [
  {
    id: 'nodejs', label: 'Node.js',
    description: 'Install Node.js and npm',
    prompt: 'Help me install Node.js and npm on my system. I am a complete beginner.',
    icon: 'Braces', category: 'runtime', difficulty: 'beginner'
  },
  {
    id: 'python', label: 'Python',
    description: 'Set up Python with pip',
    prompt: 'Help me install Python and set up pip on my system. I have never done this before.',
    icon: 'Code2', category: 'runtime', difficulty: 'beginner'
  },
  {
    id: 'git', label: 'Git',
    description: 'Install and configure Git',
    prompt: 'Help me install Git and set up my name and email for version control.',
    icon: 'GitBranch', category: 'tool', difficulty: 'beginner'
  },
  {
    id: 'vscode', label: 'VS Code',
    description: 'Set up VS Code with extensions',
    prompt: 'Help me install Visual Studio Code and recommend essential extensions for web development.',
    icon: 'Terminal', category: 'tool', difficulty: 'beginner'
  },
  {
    id: 'java', label: 'Java + IntelliJ',
    description: 'JDK and IntelliJ IDEA setup',
    prompt: 'Help me install the Java Development Kit and set up IntelliJ IDEA for Java development.',
    icon: 'Coffee', category: 'framework', difficulty: 'intermediate'
  },
  {
    id: 'react', label: 'React Project',
    description: 'Create a new React app',
    prompt: 'Help me create a new React project with Vite and TypeScript.',
    icon: 'Sparkles', category: 'framework', difficulty: 'beginner'
  },
];

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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // In Electron, keep the overlay click-through by default so the user can
    // interact with other apps. Only capture mouse while hovering the widget.
    // During Acting, ALWAYS be click-through so automation reaches the desktop.
    setClickThrough(state === 'Acting' || !isHoveringWidget);
  }, [state, isHoveringWidget]);

  // Web Speech API recognition
  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef(false);
  const explicitStopRef = useRef(false);
  const autoSubmitRef = useRef(false);
  const transcriptRef = useRef('');
  const lastSpeechTimeRef = useRef(0);
  const silenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartAttemptsRef = useRef(0);
  const userEditedRef = useRef(false);

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

  // Helper: clean up all listening resources
  const cleanupAudio = useCallback(() => {
    if (silenceTimeoutRef.current) { clearTimeout(silenceTimeoutRef.current); silenceTimeoutRef.current = null; }
    if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (_) { }
      recognitionRef.current = null;
    }
  }, []);

  const pushDebugEvent = useCallback((message: string) => {
    if (!DEBUG_OVERLAY) return;
    const ts = new Date().toLocaleTimeString();
    setDebugEvents(prev => [`[${ts}] ${message}`, ...prev].slice(0, 12));
  }, [DEBUG_OVERLAY]);

  // ─── AUDIO RECORDING ────────────────────────────────────────────────────────
  const startListening = useCallback(async () => {
    if (isListeningRef.current) return;

    if (state === 'Talking' || state === 'Acting') {
      setStatusText('Busy. Please wait...');
      pushDebugEvent('Ignored mic start while busy');
      return;
    }

    const api = (window as any).omniAPI;
    if (api?.setWindowFocusable) {
      try { await api.setWindowFocusable(true); } catch (_) { }
    }

    userEditedRef.current = false;

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setStatusText('Speech recognition not available on this system.');
      if (api?.setWindowFocusable) {
        try { await api.setWindowFocusable(false); } catch (_) { }
      }
      return;
    }

    try {
      const recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        isListeningRef.current = true;
        explicitStopRef.current = false;
        autoSubmitRef.current = false;
        restartAttemptsRef.current = 0;
        transcriptRef.current = '';
        lastSpeechTimeRef.current = 0;
        setInputText('');
        setLastUserTranscript('');
        setStatusText('');
        setIsListening(true);
        setState('Listening');
        pushDebugEvent('Listening started');
      };

      recognition.onresult = (event: any) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const t = result?.[0]?.transcript || '';
          if (result.isFinal) finalTranscript += t;
          else interimTranscript += t;
        }

        if (finalTranscript) transcriptRef.current += finalTranscript;
        const fullText = (transcriptRef.current + interimTranscript).trim();
        if (fullText) {
          lastSpeechTimeRef.current = Date.now();
          if (!userEditedRef.current) {
            setInputText(fullText);
            setLastUserTranscript(fullText);
          }
        }

        // 3s after the last speech result, auto-submit
        if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = setTimeout(() => {
          if (!isListeningRef.current) return;
          const captured = (transcriptRef.current || fullText).trim();
          if (captured.length < 2) return;
          autoSubmitRef.current = true;
          try { recognition.stop(); } catch (_) { }
        }, 3000);
      };

      recognition.onerror = (event: any) => {
        const err = event?.error || 'unknown';

        // Common transient errors that should NOT splash on the UI.
        // Chromium speech recognition often throws 'network' even when offline
        // or when the internal speech service restarts.
        if (err === 'no-speech' || err === 'aborted') return;

        if (err === 'network') {
          pushDebugEvent('Speech error: network (suppressed; will retry)');
          setStatusText('');
          // Let onend handle restart, but also schedule a backoff restart
          // in case onend doesn't fire.
          if (!explicitStopRef.current && isListeningRef.current) {
            if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
            const attempt = restartAttemptsRef.current++;
            const backoffMs = Math.min(8000, 400 * Math.pow(2, attempt));
            restartTimerRef.current = setTimeout(() => {
              if (!explicitStopRef.current && isListeningRef.current && recognitionRef.current) {
                try { recognitionRef.current.start(); } catch (_) { }
              }
            }, backoffMs);
          }
          return;
        }

        // Permission / device errors: surface to user (these are actionable).
        if (err === 'not-allowed' || err === 'service-not-allowed' || err === 'audio-capture') {
          setStatusText(`Speech error: ${err}`);
          pushDebugEvent(`Speech error: ${err}`);
          return;
        }

        // Anything else: do not spam the UI, but keep a breadcrumb in debug.
        pushDebugEvent(`Speech error: ${err} (suppressed)`);
      };

      recognition.onend = () => {
        const captured = transcriptRef.current.trim();

        // Clear timer
        if (silenceTimeoutRef.current) { clearTimeout(silenceTimeoutRef.current); silenceTimeoutRef.current = null; }

        // Auto-submit path (3s silence)
        if (autoSubmitRef.current && captured.length > 2) {
          isListeningRef.current = false;
          recognitionRef.current = null;
          setIsListening(false);
          if (api?.setWindowFocusable) {
            try { api.setWindowFocusable(false); } catch (_) { }
          }
          setState('Listening');
          setInputText(captured);
          setLastUserTranscript(captured);
          setTimeout(() => handleSubmit(captured), 100);
          return;
        }

        // User manually stopped: keep review UI if we have text
        if (explicitStopRef.current) {
          isListeningRef.current = false;
          recognitionRef.current = null;
          setIsListening(false);
          if (api?.setWindowFocusable) {
            try { api.setWindowFocusable(false); } catch (_) { }
          }
          if (captured.length > 0) {
            setState('Listening');
            setInputText(captured);
            setLastUserTranscript(captured);
          } else {
            setState('Idle');
          }
          return;
        }

        // Unexpected end (common in Web Speech): restart to keep listening
        try {
          const attempt = restartAttemptsRef.current++;
          const backoffMs = Math.min(8000, 400 * Math.pow(2, attempt));
          if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
          restartTimerRef.current = setTimeout(() => {
            try { recognition.start(); } catch (_) { }
          }, backoffMs);
          setIsListening(true);
          setState('Listening');
          return;
        } catch (_) {
          // Fall back to idle
          isListeningRef.current = false;
          recognitionRef.current = null;
          setIsListening(false);
          if (api?.setWindowFocusable) {
            try { api.setWindowFocusable(false); } catch (_) { }
          }
          setState('Idle');
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      setStatusText(`Speech init error: ${err?.message || String(err)}`);
      pushDebugEvent(`Speech init error: ${err?.message || String(err)}`);
      if (api?.setWindowFocusable) {
        try { await api.setWindowFocusable(false); } catch (_) { }
      }
      setState('Idle');
      setIsListening(false);
      isListeningRef.current = false;
    }
  }, [pushDebugEvent, state]);

  const stopListening = useCallback(() => {
    if (!isListeningRef.current) return;
    if (silenceTimeoutRef.current) { clearTimeout(silenceTimeoutRef.current); silenceTimeoutRef.current = null; }
    if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
    explicitStopRef.current = true;
    const api = (window as any).omniAPI;
    if (api?.setWindowFocusable) {
      try { api.setWindowFocusable(false); } catch (_) { }
    }
    try { recognitionRef.current?.stop(); } catch (_) { }
    cleanupAudio();
  }, [cleanupAudio]);

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

    // Fetch contextual data from Electron if available
    const api = (window as any).omniAPI;
    let visualBuffer = undefined;
    let screenDimensions = undefined;
    let environmentInfo = undefined;
    if (api?.getVisualBuffer) {
      try { visualBuffer = await api.getVisualBuffer(); } catch (e) { console.error(e); }
    }
    if (api?.getScreenDimensions) {
      try { screenDimensions = await api.getScreenDimensions(); } catch (e) { console.error(e); }
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
      } catch (e) { console.error(e); }
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
      pushDebugEvent(`AI error: ${err.message || String(err)}`);
      const errorMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: `Error: ${err.message || 'Failed to get AI response. Check API key.'}`,
        timestamp: new Date(),
        status: 'error',
      };
      setMessages(prev => [...prev, errorMsg]);
      setCurrentResponse({ explanation: err.message || 'Failed to get AI response.', actions: [], status: 'error' });
      setDisplayedText(err.message || 'Failed to get AI response.');
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
        <AnimatePresence mode="popLayout">
          {(state === 'Listening' || state === 'Talking') && (
            <motion.div
              layout
              key="transcript"
              initial={{ opacity: 0, scale: 0.9, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: -20, filter: 'blur(4px)' }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="w-72 max-h-[50vh] flex flex-col p-5 rounded-3xl bg-zinc-900/60 backdrop-blur-2xl border border-white/10 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-semibold text-white/50 tracking-wider uppercase">
                  {state === 'Talking' ? 'Thinking..' : (isListening ? 'Listening..' : 'Review')}
                </span>
                <button
                  onClick={() => {
                    explicitStopRef.current = true;
                    stopListening();
                    setState('Idle');
                    setInputText('');
                    setStatusText('');
                    setLastUserTranscript('');
                    setCurrentResponse(null);
                    setDisplayedText('');
                    setIsTypingResponse(false);
                    setDebugEvents([]);
                  }}
                  className="p-1.5 rounded-full hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto min-h-[40px] custom-scrollbar pr-1 select-text">
                <input
                  ref={inputRef}
                  type="text"
                  value={state === 'Talking' ? lastUserTranscript : inputText}
                  onChange={(e) => {
                    userEditedRef.current = true;
                    setInputText(e.target.value);
                    setLastUserTranscript(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      explicitStopRef.current = true;
                      const current = (e.currentTarget as HTMLInputElement).value;
                      if (current.trim()) handleSubmit(current);
                    }
                  }}
                  placeholder="Ask something..."
                  className="w-full bg-transparent outline-none text-[14px] text-white/90 font-medium leading-relaxed break-words placeholder:text-white/30"
                  disabled={state === 'Acting'}
                />
                {statusText && (
                  <p className="mt-2 text-[11px] text-amber-300/80 font-medium leading-relaxed break-words whitespace-pre-wrap">
                    {statusText}
                  </p>
                )}
                {DEBUG_OVERLAY && debugEvents.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-white/5 space-y-1">
                    {debugEvents.slice(0, 4).map((e, idx) => (
                      <p key={idx} className="text-[10px] text-white/40 font-medium leading-relaxed break-words whitespace-pre-wrap">
                        {e}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              {state === 'Listening' && inputText.trim().length > 0 && !isListening && (
                <div className="flex justify-end mt-4">
                  <button
                    onClick={() => {
                      explicitStopRef.current = true;
                      handleSubmit(inputText);
                    }}
                    className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white font-medium text-sm transition-colors shadow-lg shadow-emerald-500/20"
                  >
                    <span>Send</span>
                    <Send size={14} />
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {state === 'Talking' && (
            <motion.div
              layout
              key="thinking"
              initial={{ opacity: 0, scale: 0.9, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: -20 }}
              transition={{ duration: 0.3 }}
              className="px-5 py-3 rounded-full bg-zinc-900/60 backdrop-blur-2xl border border-white/10 shadow-2xl flex items-center gap-3"
            >
              <Brain className="text-blue-400 animate-pulse" size={16} />
              <div className="flex gap-1" style={{ paddingTop: '2px' }}>
                <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0 }} className="w-1.5 h-1.5 bg-blue-400 rounded-full" />
                <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0.2 }} className="w-1.5 h-1.5 bg-blue-400 rounded-full" />
                <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0.4 }} className="w-1.5 h-1.5 bg-blue-400 rounded-full" />
              </div>
              <span className="text-xs text-white/70 font-medium tracking-wide">Thinking...</span>
            </motion.div>
          )}

          {(state === 'Responding' || state === 'Acting') && currentResponse && (
            <motion.div
              layout
              key="response"
              initial={{ opacity: 0, scale: 0.9, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: -20, filter: 'blur(4px)' }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="w-80 max-h-[60vh] flex flex-col p-5 rounded-3xl bg-zinc-900/70 backdrop-blur-2xl border border-emerald-500/20 shadow-[0_0_40px_rgba(16,185,129,0.15)]"
            >
              <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2">
                  <Brain className="text-emerald-400" size={14} />
                  <span className="text-xs font-semibold text-emerald-400/80 tracking-wider uppercase">Omni Response</span>
                </div>
                <button
                  onClick={() => {
                    setState('Idle');
                    setCurrentResponse(null);
                    setDisplayedText('');
                    setIsTypingResponse(false);
                    setStatusText('');
                  }}
                  className="p-1.5 rounded-full hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto min-h-[80px] max-h-[42vh] custom-scrollbar pr-1 select-text">
                <div className="space-y-2">
                  {messages.slice(-12).map((m) => (
                    <div
                      key={m.id}
                      className={
                        m.role === 'user'
                          ? 'ml-6 rounded-2xl px-3 py-2 bg-white/5 border border-white/10'
                          : 'mr-6 rounded-2xl px-3 py-2 bg-emerald-500/5 border border-emerald-500/15'
                      }
                    >
                      <div className="text-[10px] uppercase tracking-wider text-white/40 font-semibold mb-1">
                        {m.role === 'user' ? 'You' : 'Omni'}
                      </div>
                      <div className="text-[13px] text-white/85 font-medium leading-relaxed break-words whitespace-pre-wrap">
                        {m.role === 'assistant' ? <ReactMarkdown>{m.content}</ReactMarkdown> : m.content}
                      </div>
                    </div>
                  ))}

                  {isTypingResponse && (
                    <div className="mr-6 rounded-2xl px-3 py-2 bg-emerald-500/5 border border-emerald-500/15">
                      <div className="text-[10px] uppercase tracking-wider text-white/40 font-semibold mb-1">Omni</div>
                      <div className="text-[13px] text-white/85 font-medium leading-relaxed break-words whitespace-pre-wrap">
                        {displayedText}<span className="typing-cursor" />
                      </div>
                    </div>
                  )}

                  <div ref={chatEndRef} />
                </div>
              </div>

              {ALLOW_AUTOMATION && currentResponse.actions.length > 0 && !isTypingResponse && (
                <div className="mt-3 pt-3 border-t border-white/5">
                  <div className="flex items-center gap-2">
                    <Zap className="text-amber-400" size={12} />
                    <span className="text-[11px] text-amber-400/70 font-medium">{currentResponse.actions.length} action{currentResponse.actions.length > 1 ? 's' : ''} queued</span>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {state === 'Acting' && (
            <motion.div
              layout
              key="acting"
              initial={{ opacity: 0, scale: 0.9, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: -20 }}
              className="max-w-[300px] px-5 py-3 rounded-full bg-amber-500/10 backdrop-blur-2xl border border-amber-500/30 shadow-[0_0_30px_rgba(245,158,11,0.2)] flex items-center gap-3"
            >
              <Loader2 className="animate-spin text-amber-500 shrink-0" size={14} />
              <span className="text-xs text-amber-500/90 font-medium truncate">{currentActionDesc || 'Executing...'}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          layout
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          animate={state === 'Listening' ? { scale: 1.05 } : { scale: 1 }}
          onClick={() => {
            if (isListening) {
              // First click while recording: stop and process
              autoSubmitRef.current = false;
              stopListening();
            } else if (state === 'Listening') {
              // We are in listening/review state but not recording: submit
              if (inputText.trim()) handleSubmit(inputText);
            } else if (state === 'Responding') {
              // Follow-up question in the same chat: start a new recording
              startListening();
            } else if (state === 'Talking' || state === 'Acting') {
              setStatusText('Busy. Please wait...');
            } else if (state === 'Idle') {
              startListening();
            }
          }}
          className={`flex items-center gap-2.5 px-4 h-11 rounded-full shadow-2xl transition-all duration-300 backdrop-blur-2xl border relative group z-50 ${state === 'Listening'
            ? 'bg-zinc-900/80 border-blue-500/50 shadow-[0_0_30px_rgba(59,130,246,0.2)]'
            : state === 'Acting'
              ? 'bg-zinc-900/80 border-amber-500/50 shadow-[0_0_30px_rgba(245,158,11,0.2)]'
              : state === 'Talking'
                ? 'bg-zinc-900/80 border-blue-500/50 shadow-[0_0_30px_rgba(59,130,246,0.2)]'
                : state === 'Responding'
                  ? 'bg-zinc-900/80 border-emerald-500/50 shadow-[0_0_30px_rgba(16,185,129,0.2)]'
                  : 'bg-zinc-900/60 border-zinc-700/50 hover:bg-zinc-800/80 hover:border-white/20 hover:shadow-[0_0_20px_rgba(255,255,255,0.05)]'
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
