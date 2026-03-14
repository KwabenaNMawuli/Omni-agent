import { GoogleGenAI, Type, Modality } from "@google/genai";
import { GeminiResponse, SetupAction, VisualFrame, ChatMessage } from "../types";

// Lazy-initialize the client so a missing API key doesn't crash the whole app
let _ai: GoogleGenAI | null = null;

let _lastGoodThinkingModel: string | null = null;

async function generateWithFallback(args: {
  models: string[];
  request: (model: string) => Promise<any>;
}): Promise<{ model: string; response: any }> {
  let lastError: any = null;
  for (const m of args.models) {
    try {
      const response = await args.request(m);
      return { model: m, response };
    } catch (e: any) {
      lastError = e;
      const msg = (e?.message || String(e) || '').toLowerCase();
      if (msg.includes('not found') || msg.includes('model') || msg.includes('404')) {
        continue;
      }
      // Non-model error: fail fast
      throw e;
    }
  }
  const message = lastError?.message || String(lastError) || 'No available model succeeded';
  throw new Error(message);
}

function getAI(): GoogleGenAI {
  if (!_ai) {
    // In Vite renderer builds, env vars are available via import.meta.env.
    // We also support the string define() shim (process.env.GEMINI_API_KEY) for compatibility.
    const key =
      (import.meta as any)?.env?.GEMINI_API_KEY ||
      (process.env as any)?.GEMINI_API_KEY;
    if (!key) {
      throw new Error(
        "GEMINI_API_KEY is not set. Create a .env.local file with GEMINI_API_KEY=your_key"
      );
    }
    // Ensure the underlying websocket URL is well-formed in Electron builds.
    _ai = new GoogleGenAI({ apiKey: key, baseUrl: 'https://generativelanguage.googleapis.com' } as any);
  }
  return _ai;
}

export type LiveAgentEvent =
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'interrupted' }
  | { type: 'text'; text: string }
  | { type: 'audio'; mimeType: string; data: string }
  | { type: 'error'; message: string };

export interface LiveAgentSession {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  sendText: (text: string, turnComplete?: boolean) => Promise<void>;
  sendAudioChunk: (pcm16Base64: string, mimeType?: string) => Promise<void>;
  interrupt: () => Promise<void>;
  onEvent: (handler: (e: LiveAgentEvent) => void) => () => void;
  getState: () => { connected: boolean };
}

export function createLiveAgentSession(args?: {
  model?: string;
  responseModalities?: Array<'AUDIO' | 'TEXT'>;
}): LiveAgentSession {
  const model = args?.model || 'gemini-2.0-flash-live-preview-04-09';
  const responseModalities = args?.responseModalities || ['AUDIO'];

  let connected = false;
  let session: any = null;
  let readerTask: Promise<void> | null = null;
  const handlers = new Set<(e: LiveAgentEvent) => void>();

  const emit = (e: LiveAgentEvent) => {
    for (const h of handlers) h(e);
  };

  const connect = async () => {
    if (connected) return;
    try {
      // Protect against a hung websocket connect by using an AbortController timeout.
      const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutMs = 15000;
      const timeout = setTimeout(() => abortController?.abort(), timeoutMs);
      try {
        session = await (getAI() as any).live.connect({
          model,
          config: {
            responseModalities,
            inputAudioFormat: {
              mimeType: 'audio/pcm;rate=16000',
            },
            outputAudioFormat: {
              mimeType: 'audio/pcm;rate=24000',
            },
          },
          ...(abortController ? { signal: abortController.signal } : {}),
        });
      } finally {
        clearTimeout(timeout);
      }
      connected = true;
      emit({ type: 'connected' });

      readerTask = (async () => {
        try {
          for await (const message of session) {
            const sc = message?.serverContent;
            if (sc?.interrupted) {
              emit({ type: 'interrupted' });
              continue;
            }

            const parts = sc?.modelTurn?.parts || sc?.parts || [];
            for (const p of parts) {
              if (typeof p?.text === 'string' && p.text.trim()) {
                emit({ type: 'text', text: p.text });
              }
              const inline = p?.inlineData;
              if (inline?.data && inline?.mimeType) {
                emit({ type: 'audio', mimeType: inline.mimeType, data: inline.data });
              }
            }
          }
          // Iterator ended -> treat as disconnected
          if (connected) {
            connected = false;
            emit({ type: 'disconnected' });
          }
        } catch (e: any) {
          if (connected) {
            connected = false;
            emit({ type: 'disconnected' });
          }
          const msg = e?.name === 'AbortError'
            ? 'Live connect timed out (15s). Check GEMINI_API_KEY, network, and model id.'
            : (e?.message || String(e));
          emit({ type: 'error', message: msg });
        }
      })();
    } catch (e: any) {
      const msg = e?.name === 'AbortError'
        ? 'Live connect timed out (15s). Check GEMINI_API_KEY, network, and model id.'
        : (e?.message || String(e));
      emit({ type: 'error', message: msg });
      throw e;
    }
  };

  const disconnect = async () => {
    if (!connected) return;
    try {
      connected = false;
      try {
        await session?.close?.();
      } catch (_) {}
      session = null;
      emit({ type: 'disconnected' });
      await readerTask;
    } finally {
      readerTask = null;
    }
  };

  const sendText = async (text: string, turnComplete: boolean = true) => {
    if (!connected || !session) throw new Error('Live session is not connected');
    await session.sendClientContent({ turns: text, turnComplete });
  };

  const sendAudioChunk = async (pcm16Base64: string, mimeType: string = 'audio/pcm;rate=16000') => {
    if (!connected || !session) throw new Error('Live session is not connected');
    // @google/genai live sessions accept client content with inlineData parts.
    // We send raw PCM16 mono 16kHz frames as base64.
    try {
      await session.sendClientContent({
        turns: [
          {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: pcm16Base64,
                },
              },
            ],
          },
        ],
        turnComplete: false,
      });
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.toLowerCase().includes('websocket') || msg.toLowerCase().includes('closed')) {
        connected = false;
        emit({ type: 'disconnected' });
      }
      throw e;
    }
  };

  const interrupt = async () => {
    if (!connected || !session) return;
    try {
      await session.sendClientContent({ turns: ' ', turnComplete: true });
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.toLowerCase().includes('websocket') || msg.toLowerCase().includes('closed')) {
        connected = false;
        emit({ type: 'disconnected' });
      }
      throw e;
    }
  };

  const onEvent = (handler: (e: LiveAgentEvent) => void) => {
    handlers.add(handler);
    return () => handlers.delete(handler);
  };

  const getState = () => ({ connected });

  return { connect, disconnect, sendText, sendAudioChunk, interrupt, onEvent, getState };
}

/**
 * Build a multimodal prompt with temporal screenshot sequence + user intent.
 * Follows the spec: "These images represent the recent interaction history,
 *   ordered chronologically. The final image is the current screen."
 */
export async function getSetupInstructions(
  userIntent: string,
  mode: 'Passive' | 'Active',
  automationEnabled: boolean,
  currentScreenBase64?: string,
  visualBuffer?: VisualFrame[],
  conversationHistory?: ChatMessage[],
  screenDimensions?: { width: number; height: number; scaleFactor: number },
  environmentInfo?: { os: string; shell: string; nodeVersion?: string; electronVersion?: string }
): Promise<GeminiResponse> {
  const preferredModels = [
    "gemini-3.0-flash",
    "gemini-3.1-flash-lite-preview",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
  ];

  const modelsToTry = (
    _lastGoodThinkingModel
      ? [_lastGoodThinkingModel, ...preferredModels.filter(m => m !== _lastGoodThinkingModel)]
      : preferredModels
  );

  const screenInfo = screenDimensions
    ? `\nSCREEN RESOLUTION: ${screenDimensions.width}x${screenDimensions.height} pixels (scale factor: ${screenDimensions.scaleFactor}).
The screenshots sent match this exact resolution.
COORDINATE SYSTEM: You return coordinates as percentages (0-100) of the full screen.
  - x=0 is the left edge, x=100 is the right edge.
  - y=0 is the top edge, y=100 is the bottom edge.
  - Each x unit = ${(screenDimensions.width / 100).toFixed(1)}px, each y unit = ${(screenDimensions.height / 100).toFixed(1)}px.
  - AIM FOR THE CENTER of clickable elements. Be as precise as possible — even 1-2% off can miss a button.
  - For the Windows taskbar (usually at the bottom), y is typically 96-100%.
  - For title bar buttons (close/minimize), y is typically 0-3%.`
    : '';

  const envInfo = environmentInfo
    ? `\nENVIRONMENT:
  - Operating System: ${environmentInfo.os}
  - Default Shell: ${environmentInfo.shell}
  - Node.js: ${environmentInfo.nodeVersion || 'unknown'}
  - Package Managers: On Windows use "winget" (preferred) or PowerShell. On macOS use "brew". On Linux use "apt" / "dnf" as appropriate.`
    : '';

  const systemInstruction = automationEnabled
    ? `You are Omni, an AUTONOMOUS desktop agent.

You can propose actions for the system to execute (shell commands, mouse/keyboard automation). Keep actions safe and minimal.

CRITICAL RULES:
1. Never click on the Omni overlay/widget itself.
2. Prefer 'command' actions for install/config tasks.
3. Use 'click' actions only when necessary and only for elements visible on the real desktop.
4. Keep commands simple and one-per-action.

CONTEXT:
- Screenshots show the user's REAL desktop (the Omni overlay is hidden during capture).
- The screenshots are ordered chronologically — the LAST image is the CURRENT screen state.${screenInfo}${envInfo}

MODE: ${mode}
- Active Mode: You may output actions for automation.
- Passive Mode: You may output guidance and optional highlight coordinates.

RESPONSE FORMAT (JSON):
- explanation: Friendly, clear markdown.
- actions: Ordered array of concrete actions to perform.
- status: 'success' | 'pending' | 'error'.`
    : `You are Omni, an AUTONOMOUS desktop agent.

IMPORTANT:
- Automation is currently DISABLED in the app.
- You must NOT output any actions. Return an empty actions array always.
- Provide only guidance in explanation.

CONTEXT:
- Screenshots show the user's REAL desktop (the Omni overlay is hidden during capture).
- The screenshots are ordered chronologically — the LAST image is the CURRENT screen state.${screenInfo}${envInfo}

MODE: ${mode}

RESPONSE FORMAT (JSON):
- explanation: Friendly, clear markdown.
- actions: []
- status: 'success' | 'pending' | 'error'.`;

  // Build content parts: conversation context + visual frames + current intent
  const contents: any[] = [];

  // Add conversation history context if available
  if (conversationHistory && conversationHistory.length > 0) {
    const historyText = conversationHistory
      .slice(-6) // Last 6 messages for context
      .map(m => `[${m.role}]: ${m.content}`)
      .join('\n');
    contents.push({ text: `Previous conversation:\n${historyText}\n\n---\n\n` });
  }

  // Add visual buffer frames (temporal sequence)
  if (visualBuffer && visualBuffer.length > 0) {
    contents.push({
      text: `The following ${visualBuffer.length} screenshots show the user's recent activity in chronological order:`
    });

    for (const frame of visualBuffer) {
      contents.push({
        text: `[Frame ${frame.index} — ${frame.timestamp}${frame.appName ? ` — ${frame.appName}` : ''}${frame.windowTitle ? `: ${frame.windowTitle}` : ''}]`
      });
      contents.push({
        inlineData: {
          mimeType: "image/webp",
          data: frame.image.split(',')[1] || frame.image
        }
      });
    }
  }

  // Add current screenshot
  if (currentScreenBase64) {
    contents.push({ text: "Current screen state (most recent):" });
    contents.push({
      inlineData: {
        mimeType: "image/png",
        data: currentScreenBase64.split(',')[1] || currentScreenBase64
      }
    });
  }

  // Add user intent
  contents.push({ text: `\nUser's request: ${userIntent}` });

  try {
    const { model, response } = await generateWithFallback({
      models: modelsToTry,
      request: (model) =>
        getAI().models.generateContent({
          model,
          contents: { parts: contents },
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                explanation: { type: Type.STRING },
                actions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      type: {
                        type: Type.STRING,
                        enum: ['type', 'click', 'wait', 'command', 'highlight', 'scroll', 'keypress']
                      },
                      target: { type: Type.STRING },
                      value: { type: Type.STRING },
                      description: { type: Type.STRING },
                      coordinates: {
                        type: Type.OBJECT,
                        properties: {
                          x: { type: Type.NUMBER },
                          y: { type: Type.NUMBER }
                        },
                        required: ['x', 'y']
                      }
                    },
                    required: ['type', 'description']
                  }
                },
                status: { type: Type.STRING, enum: ['success', 'error', 'pending'] }
              },
              required: ['explanation', 'actions', 'status']
            }
          }
        }),
    });

    const parsed = JSON.parse(response.text || "{}") as GeminiResponse;
    _lastGoodThinkingModel = model;
    return { ...parsed, modelUsed: model };
  } catch (error) {
    console.error("Gemini API Error:", error);
    return {
      explanation: "I encountered an error connecting to the AI service. Please check your API key and try again.",
      actions: [],
      status: 'error'
    };
  }
}

/**
 * Generate speech audio from text using Gemini TTS.
 * Returns base64 encoded audio data.
 */
export async function generateSpeech(text: string): Promise<string | null> {
  try {
    const response = await getAI().models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Say clearly and helpfully: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio || null;
  } catch (error) {
    console.error("TTS Error:", error);
    return null;
  }
}
