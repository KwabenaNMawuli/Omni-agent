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
  Power
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
  const [state, setState] = useState<SessionState>('Idle');
  const [mode, setMode] = useState<AgentMode>('Active');
  const [isOpen, setIsOpen] = useState(false);
  const [inputText, setInputText] = useState('');
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
  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef(false);
  const transcriptRef = useRef('');

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
        // Type 2-4 chars at a time for speed
        const chunkSize = Math.floor(Math.random() * 3) + 2;
        setDisplayedText(fullText.slice(0, displayedText.length + chunkSize));
      }, 15);
      return () => clearTimeout(timer);
    } else {
      setIsTypingResponse(false);
    }
  }, [displayedText, isTypingResponse, currentResponse]);

  // Web Speech API for voice recognition
  const startListening = useCallback(() => {
    // If already listening, ignore (prevents race conditions)
    if (isListeningRef.current || recognitionRef.current) return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      // Fallback — focus the text input
      inputRef.current?.focus();
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      isListeningRef.current = true;
      transcriptRef.current = '';
      setIsListening(true);
      setState('Listening');
    };

    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }
      if (finalTranscript) {
        transcriptRef.current += finalTranscript;
      }
      setInputText(transcriptRef.current + interimTranscript);
    };

    recognition.onend = () => {
      isListeningRef.current = false;
      recognitionRef.current = null;
      setIsListening(false);
      setState('Idle');
      // Auto-submit if we captured meaningful speech
      const captured = transcriptRef.current.trim();
      if (captured.length > 2) {
        setInputText(captured);
        // Use a short delay so the state updates propagate before submit
        setTimeout(() => handleSubmit(captured), 100);
      }
    };

    recognition.onerror = (event: any) => {
      // 'no-speech' and 'aborted' are non-fatal — don't kill the session
      if (event.error === 'no-speech' || event.error === 'aborted') {
        console.warn('Speech recognition:', event.error);
        return;
      }
      console.error('Speech recognition error:', event.error);
      isListeningRef.current = false;
      recognitionRef.current = null;
      setIsListening(false);
      setState('Idle');
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (_) {}
      // The onend handler will clean up state and auto-submit
    }
  }, []);

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

    // Add user message
    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: query,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setState('Talking');

    // Capture screen context
    const screenshot = await captureScreen();

    // Fetch visual buffer from Electron if available
    const api = (window as any).omniAPI;
    let visualBuffer = undefined;
    let screenDimensions = undefined;
    let environmentInfo = undefined;
    if (api?.getVisualBuffer) {
      try {
        visualBuffer = await api.getVisualBuffer();
      } catch (e) {
        console.error('Failed to get visual buffer:', e);
      }
    }
    if (api?.getScreenDimensions) {
      try {
        screenDimensions = await api.getScreenDimensions();
      } catch (e) {
        console.error('Failed to get screen dimensions:', e);
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
      } catch (e) {
        console.error('Failed to get env info:', e);
      }
    }

    // Call Gemini with conversation history + visual context
    const res = await getSetupInstructions(
      query,
      mode,
      screenshot || undefined,
      visualBuffer,
      messages,
      screenDimensions,
      environmentInfo
    );

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

    // Start typing animation
    setDisplayedText('');
    setIsTypingResponse(true);

    setState('Idle');
  };

  const runActions = async () => {
    if (!currentResponse || currentResponse.actions.length === 0) return;

    setState('Acting');
    // Enable click-through during action execution so nut.js clicks reach the desktop
    setClickThrough(true);

    for (let i = 0; i < currentResponse.actions.length; i++) {
      const action = currentResponse.actions[i];
      setCurrentActionIndex(i);
      setCurrentActionDesc(action.description);

      if (action.coordinates) {
        setCurrentCoords(action.coordinates);
      } else {
        setCurrentCoords(null); // Clear pointer if action has no coordinates
      }

      if (mode === 'Passive') {
        await playAudio(action.description);
        // In passive mode, wait for screen stability before next step
        const api = (window as any).omniAPI;
        if (api?.waitForScreenStable) {
          await api.waitForScreenStable({ timeoutMs: 10000 });
        } else {
          await new Promise(r => setTimeout(r, 3000));
        }
      } else {
        // Execute the action and wait for it to fully complete via IPC
        await onAction(action);

        // Wait for the screen to visually stabilize before proceeding
        // This replaces all fixed delays — the system observes the actual
        // screen and only moves on once things stop changing.
        const api = (window as any).omniAPI;
        if (api?.waitForScreenStable) {
          const result = await api.waitForScreenStable({
            timeoutMs: action.type === 'command' ? 120000 : 15000, // 2min for commands, 15s otherwise
            intervalMs: action.type === 'command' ? 1500 : 800,
          });
          console.log(`[Omni] Screen ${result.stable ? 'stabilized' : 'timed out'} after ${result.elapsed}ms`);
        } else {
          // Browser fallback — short delay
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    // Restore click-through for the widget area
    setClickThrough(false);
    setState('Idle');
    setCurrentActionIndex(-1);
    setCurrentCoords(null);
    setCurrentActionDesc('');
    confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
  };

  const handleTemplateClick = (template: SetupTemplate) => {
    handleSubmit(template.prompt);
  };

  const stateColors: Record<SessionState, string> = {
    Idle: 'bg-emerald-500',
    Listening: 'bg-red-500',
    Acting: 'bg-amber-500',
    Talking: 'bg-blue-500'
  };

  const stateGlows: Record<SessionState, string> = {
    Idle: 'glow-emerald',
    Listening: 'glow-red',
    Acting: 'glow-amber',
    Talking: 'glow-blue'
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
        className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3"
        onMouseEnter={() => setClickThrough(false)}
        onMouseLeave={() => setClickThrough(true)}
      >
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 20 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="w-[400px] bg-zinc-950 border border-zinc-800/60 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
              style={{ maxHeight: 'min(600px, calc(100vh - 120px))' }}
            >
              {/* Header */}
              <div className="px-4 py-3 border-b border-zinc-800/50 flex items-center justify-between bg-zinc-900/80 backdrop-blur-xl shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className={`w-2 h-2 rounded-full ${state === 'Listening' ? 'bg-red-500 animate-pulse' :
                    state === 'Acting' ? 'bg-amber-500' :
                      state === 'Talking' ? 'bg-blue-500 animate-bounce' : 'bg-emerald-500'
                    }`} />
                  <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-zinc-400">
                    Omni // {state}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {isCapturing && <Camera size={13} className="text-emerald-400 animate-pulse" />}
                  {isSpeaking && <Volume2 size={13} className="text-blue-400 animate-pulse" />}
                  <button onClick={() => setIsOpen(false)} className="p-1 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-all" title="Minimize">
                    <X size={14} />
                  </button>
                  <button
                    onClick={() => {
                      const api = (window as any).omniAPI;
                      if (api?.quitApp) {
                        api.quitApp();
                      } else {
                        window.close();
                      }
                    }}
                    className="p-1 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                    title="Quit Omni"
                  >
                    <Power size={14} />
                  </button>
                </div>
              </div>

              {/* Mode Toggle */}
              <div className="px-3 py-2 bg-zinc-950 border-b border-zinc-800/30 flex gap-2 shrink-0">
                <button
                  onClick={() => setMode('Active')}
                  className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all ${mode === 'Active'
                    ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                    : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
                    }`}
                >
                  <Zap size={11} /> Active
                </button>
                <button
                  onClick={() => setMode('Passive')}
                  className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all ${mode === 'Passive'
                    ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                    : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
                    }`}
                >
                  <Eye size={11} /> Passive
                </button>
              </div>

              {/* Chat Content */}
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {messages.length === 0 ? (
                  // Empty state — show templates
                  <div className="p-4 space-y-4">
                    <div className="text-center py-4">
                      <div className="inline-flex p-3 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-blue-500/10 mb-3">
                        <MessageSquare className="text-emerald-500" size={24} />
                      </div>
                      <p className="text-sm font-semibold text-zinc-300">What would you like to set up?</p>
                      <p className="text-[11px] text-zinc-600 mt-1">Choose a template or type your question</p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {TEMPLATES.map(template => (
                        <motion.button
                          key={template.id}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => handleTemplateClick(template)}
                          className="p-3 rounded-xl text-left bg-zinc-900/50 border border-zinc-800/50 hover:border-emerald-500/30 hover:bg-zinc-800/50 transition-all group"
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <div className="text-zinc-500 group-hover:text-emerald-400 transition-colors">
                              {TEMPLATE_ICONS[template.icon] || <Code2 size={16} />}
                            </div>
                            <span className="text-xs font-bold text-zinc-300 group-hover:text-white transition-colors">
                              {template.label}
                            </span>
                          </div>
                          <p className="text-[10px] text-zinc-600 leading-relaxed">
                            {template.description}
                          </p>
                        </motion.button>
                      ))}
                    </div>
                  </div>
                ) : (
                  // Chat thread
                  <div className="p-4 space-y-4">
                    {messages.map((msg, idx) => (
                      <motion.div
                        key={msg.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        {msg.role === 'user' ? (
                          // User message
                          <div className="max-w-[85%] bg-emerald-600/20 border border-emerald-500/20 rounded-2xl rounded-br-sm px-3.5 py-2.5">
                            <p className="text-sm text-emerald-100 leading-relaxed">{msg.content}</p>
                            <p className="text-[9px] text-emerald-500/50 mt-1 text-right">
                              {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        ) : (
                          // Assistant message
                          <div className="max-w-[90%] space-y-3">
                            <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-2xl rounded-bl-sm px-3.5 py-2.5">
                              <div className="prose prose-invert prose-sm max-w-none text-[13px] leading-relaxed">
                                <ReactMarkdown>
                                  {idx === messages.length - 1 && isTypingResponse
                                    ? displayedText
                                    : msg.content
                                  }
                                </ReactMarkdown>
                                {idx === messages.length - 1 && isTypingResponse && (
                                  <span className="typing-cursor" />
                                )}
                              </div>
                              <p className="text-[9px] text-zinc-700 mt-1">
                                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>

                            {/* Action steps */}
                            {msg.actions && msg.actions.length > 0 && !isTypingResponse && (
                              <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.2 }}
                                className="space-y-2"
                              >
                                <div className="flex items-center gap-2 px-1">
                                  <CircleDot size={10} className="text-zinc-600" />
                                  <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider">
                                    {msg.actions.length} Actions Planned
                                  </span>
                                </div>
                                {msg.actions.map((action, aidx) => (
                                  <motion.div
                                    key={aidx}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 0.1 * aidx }}
                                    className={`p-2.5 rounded-lg border transition-all flex items-start gap-2.5 ${currentActionIndex === aidx
                                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                      : currentActionIndex > aidx
                                        ? 'bg-zinc-800/30 border-zinc-700/50 text-zinc-500'
                                        : 'bg-zinc-900/40 border-zinc-800/50 text-zinc-300'
                                      }`}
                                  >
                                    {currentActionIndex > aidx ? (
                                      <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                                    ) : currentActionIndex === aidx ? (
                                      <Loader2 size={14} className="animate-spin shrink-0 mt-0.5" />
                                    ) : (
                                      <div className="w-3.5 h-3.5 rounded-full border-2 border-zinc-700 shrink-0 mt-0.5" />
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[12px] font-medium leading-snug">{action.description}</p>
                                      <p className="text-[9px] font-mono opacity-40 mt-0.5 uppercase">
                                        {action.type}{action.value ? ` → ${action.value}` : ''}
                                      </p>
                                    </div>
                                  </motion.div>
                                ))}

                                {/* Execute / Guide button */}
                                {state !== 'Acting' && currentActionIndex === -1 && (
                                  <motion.button
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    onClick={runActions}
                                    className="w-full py-2.5 bg-zinc-100 hover:bg-white text-zinc-900 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2"
                                  >
                                    <Play size={16} fill="currentColor" />
                                    {mode === 'Active' ? 'Execute Setup' : 'Start Guidance'}
                                  </motion.button>
                                )}
                              </motion.div>
                            )}
                          </div>
                        )}
                      </motion.div>
                    ))}

                    {/* Loading state */}
                    {state === 'Talking' && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex justify-start"
                      >
                        <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-2xl rounded-bl-sm px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Loader2 className="animate-spin text-emerald-500" size={16} />
                            <span className="text-xs text-zinc-400 animate-pulse">Analyzing your environment...</span>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    <div ref={chatEndRef} />
                  </div>
                )}
              </div>

              {/* Input Bar */}
              <div className="p-3 border-t border-zinc-800/30 bg-zinc-900/50 backdrop-blur-xl shrink-0">
                <div className="flex items-center gap-2">
                  {/* Voice button */}
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={isListening ? stopListening : startListening}
                    className={`p-2.5 rounded-xl transition-all shrink-0 ${isListening
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : 'bg-zinc-800 text-zinc-400 hover:text-emerald-400 hover:bg-zinc-700 border border-transparent'
                      }`}
                  >
                    {isListening ? <Square size={16} fill="currentColor" /> : <Mic size={16} />}
                  </motion.button>

                  {/* Text input */}
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                    placeholder={isListening ? 'Listening...' : 'Ask about any setup...'}
                    className="flex-1 bg-zinc-800/50 border border-zinc-700/50 rounded-xl px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/30 focus:bg-zinc-800 transition-all"
                    disabled={state === 'Talking' || state === 'Acting'}
                  />

                  {/* Send button */}
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleSubmit()}
                    disabled={!inputText.trim() || state === 'Talking' || state === 'Acting'}
                    className="p-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 transition-all shrink-0"
                  >
                    <Send size={16} />
                  </motion.button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* The Floating Bubble */}
        <motion.button
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          onClick={() => setIsOpen(!isOpen)}
          className={`w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-all duration-500 relative group ${stateColors[state]} ${stateGlows[state]}`}
        >
          <div className="absolute inset-0 rounded-full bg-inherit animate-ping opacity-15 group-hover:opacity-30" />
          <AnimatePresence mode="wait">
            {isOpen ? (
              <motion.div key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }}>
                <X className="text-white" size={22} />
              </motion.div>
            ) : state === 'Listening' ? (
              <motion.div key="stop" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                <Square fill="white" className="text-white" size={20} />
              </motion.div>
            ) : (
              <motion.div key="mic" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                <MessageSquare className="text-white" size={22} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>
      </div>
    </>
  );
}
