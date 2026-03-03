import { GoogleGenAI, Type, Modality } from "@google/genai";
import { GeminiResponse, SetupAction, VisualFrame, ChatMessage } from "../types";

// Lazy-initialize the client so a missing API key doesn't crash the whole app
let _ai: GoogleGenAI | null = null;

function getAI(): GoogleGenAI {
  if (!_ai) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error(
        "GEMINI_API_KEY is not set. Create a .env.local file with GEMINI_API_KEY=your_key"
      );
    }
    _ai = new GoogleGenAI({ apiKey: key });
  }
  return _ai;
}

/**
 * Build a multimodal prompt with temporal screenshot sequence + user intent.
 * Follows the spec: "These images represent the recent interaction history,
 *   ordered chronologically. The final image is the current screen."
 */
export async function getSetupInstructions(
  userIntent: string,
  mode: 'Passive' | 'Active',
  currentScreenBase64?: string,
  visualBuffer?: VisualFrame[],
  conversationHistory?: ChatMessage[],
  screenDimensions?: { width: number; height: number; scaleFactor: number },
  environmentInfo?: { os: string; shell: string; nodeVersion?: string; electronVersion?: string }
): Promise<GeminiResponse> {
  const model = "gemini-2.5-flash";

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

  const systemInstruction = `You are Omni, an AUTONOMOUS desktop automation agent that installs and configures development tools.
You have DIRECT control of the user's computer through shell commands and mouse/keyboard automation.
EVERYTHING YOU DO IS VISIBLE to the user — they watch the mouse move, see text being typed character
by character, and observe commands running in a real terminal window. This is intentional: the user
is learning by watching you work so they can repeat the steps on their own later.

CRITICAL RULES:
1. For software installation or configuration, ALWAYS prefer 'command' actions that run actual shell commands.
   When you use a 'command' action, the system VISUALLY opens a PowerShell window (if not already open),
   types the command character by character so the user can read it, then presses Enter.
   Examples: "winget install --id Oracle.JDK.21 -e --accept-source-agreements --accept-package-agreements",
             "choco install openjdk", "brew install openjdk", "sudo apt install openjdk-21-jdk"
2. NEVER generate a 'wait' action as your first or only action. Always produce substantive actions.
3. NEVER try to click on the Omni overlay/widget itself — it is NOT part of the desktop you're operating.
   The Omni overlay is removed from screenshots. You must never click 'Execute Setup' or any Omni UI element.
4. Use 'click' actions only when you need to interact with REAL applications on the desktop (e.g., clicking
   a browser download link, a dialog button, or an installer Next button that is actually visible on screen).
5. Produce a COMPLETE action plan in one response. Don't say "I'll wait for analysis" — YOU are the analyzer.
6. For multi-step installs, chain all commands in order. The system waits for each to finish before the next.
   All commands go into the SAME terminal window, so they share state (env vars, working directory, etc.).
7. Keep commands simple and one-per-action. Don't chain with && or ; — use separate actions instead so
   the user can see each step clearly.

CONTEXT:
- Screenshots show the user's REAL desktop (the Omni overlay is hidden during capture).
- The screenshots are ordered chronologically — the LAST image is the CURRENT screen state.${screenInfo}${envInfo}

MODE: ${mode}
- Active Mode: You generate actions for the system to execute automatically using desktop automation.
  The user WATCHES everything happen — mouse movements, typing, terminal commands are all visible.
  Provide precise coordinates (0-100 normalized) for mouse operations.
- Passive Mode: You guide the user step-by-step with clear instructions and visual highlights.
  Provide coordinates (0-100 normalized) for where highlights should appear.

AVAILABLE ACTIONS (use 'command' as your primary tool):
- 'command': Run a shell command in a VISIBLE terminal. value = the command string.
   The system opens a real PowerShell window, types the command at readable speed, and presses Enter.
   The user sees everything. This is your MAIN TOOL for installations and configuration.
- 'click': Click at a screen position. The mouse visibly moves to the target, pauses, then clicks.
   coordinates = {x, y} as percentages (0-100). Only for REAL desktop apps visible on screen.
- 'type': Type text into a focused field at readable speed. target = field description, value = text.
- 'keypress': Press a key combination. value = key string (e.g., 'Enter', 'Ctrl+S', 'Tab').
- 'scroll': Scroll in a direction. value = 'up' | 'down'.
- 'highlight': (Passive mode) Highlight an area. coordinates = {x, y}, description = what to look for.
- 'wait': Wait for a process. value = duration in ms. Use SPARINGLY and only between other real actions.

RESPONSE FORMAT (JSON):
- explanation: Friendly, jargon-free markdown explaining what you're doing and why
- actions: Ordered array of concrete actions to perform (always include at least one substantive action)
- status: 'success' if you can help, 'pending' if you need more info, 'error' if something is wrong

EXAMPLE — Installing JDK on Windows:
{
  "explanation": "I'll install the Java Development Kit (JDK 21) using Windows Package Manager (winget)...",
  "actions": [
    { "type": "command", "value": "winget install --id Oracle.JDK.21 -e --accept-source-agreements --accept-package-agreements", "description": "Install JDK 21 via winget" },
    { "type": "command", "value": "java -version", "description": "Verify Java installation" }
  ],
  "status": "success"
}`;

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
    const response = await getAI().models.generateContent({
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
    });

    return JSON.parse(response.text || "{}") as GeminiResponse;
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
