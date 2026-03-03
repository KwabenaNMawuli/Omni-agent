<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Omni: AI Setup Agent

An AI-powered desktop automation assistant that **visually** installs and configures development environments while you watch and learn. Omni uses Google Gemini's multimodal vision to understand your screen, then controls your mouse, keyboard, and terminal in real time — so you can see exactly what's happening and repeat the steps yourself.

## What It Does

Omni sits as a transparent overlay on your desktop. You tell it what you need (via text or voice), it takes a screenshot to understand your current state, then:

1. **Opens a real PowerShell window** on your screen
2. **Types commands character by character** so you can read along
3. **Moves your mouse visibly** to click buttons in installers or browsers
4. **Explains every step** in plain language in its chat panel

The user watches the entire process like a live tutorial. Every action — mouse movements, keystrokes, terminal commands — is visible and educational.

## Key Features

- **Visual Automation** — Mouse moves at readable speed (600px/s), commands are typed character by character, clicks pause so you see where they land
- **Real Screen Understanding** — Uses Electron's `desktopCapturer` for actual screenshots (not DOM capture), hides its own overlay during capture so the AI never sees itself
- **Multimodal AI** — Sends a chronological timeline of screenshots + conversation history to Gemini 2.5 Flash, which returns structured action plans
- **Voice Input** — Continuous Web Speech API recognition with auto-submit
- **Visual Memory** — 8-frame FIFO rolling buffer of recent screenshots gives the AI temporal context
- **Pre-built Templates** — One-click setups for Node.js, Python, Git, VS Code, Java + IntelliJ, and React projects
- **Two Modes** — *Active* (AI executes actions) and *Passive* (AI highlights and guides)
- **Click-through Overlay** — Transparent, frameless, always-on-top window that doesn't interfere with your desktop
- **Visual Stability Detection** — After each action, polls the screen to wait for changes to settle before proceeding
- **Screen Dimension Awareness** — Passes exact resolution and scale factor to Gemini for precise coordinate targeting

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | Electron 35 (transparent frameless overlay) |
| Frontend | React 19 + Vite 6 + TypeScript 5.8 |
| Styling | Tailwind CSS 4 + Framer Motion |
| AI Backend | Google Gemini 2.5 Flash (multimodal + structured JSON output) |
| Desktop Automation | @nut-tree-fork/nut-js (mouse, keyboard, clipboard) |
| Screen Capture | Electron `desktopCapturer` API |
| Voice | Web Speech API (SpeechRecognition) |
| TTS | Gemini 2.5 Flash Preview TTS |

## Prerequisites

- **Node.js** 18+ and npm
- **Windows 10/11** (primary target; macOS/Linux partially supported)
- A **Google Gemini API key** ([Get one here](https://ai.google.dev/))

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/your-org/omni-ai-setup-agent.git
cd omni-ai-setup-agent

# 2. Install dependencies
npm install

# 3. Set your Gemini API key
#    Copy .env.example to .env.local and fill in your key:
cp .env.example .env.local
#    Edit .env.local → GEMINI_API_KEY=your_key_here

# 4. Launch the Electron app (builds TypeScript + starts Vite + opens Electron)
npm run electron:dev
```

The overlay will appear as a floating green bubble in the bottom-right corner of your screen. Click it to open the chat panel.

## Available Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start Vite dev server only (browser mode, no desktop automation) |
| `npm run electron:dev` | Build Electron TypeScript + launch full desktop app |
| `npm run electron:build` | Compile Electron TypeScript to `dist-electron/` |
| `npm run build` | Production build of the React frontend |
| `npm run lint` | TypeScript type-checking |
| `npm run clean` | Remove `dist/` and `dist-electron/` |

## How It Works

### 1. Screen Capture Pipeline

When you send a message, Omni:
- **Hides** its own overlay window (so the AI never sees itself)
- Captures the real desktop via `desktopCapturer` at native resolution
- **Re-shows** the overlay using `showInactive()` (doesn't steal focus)
- Sends the screenshot + the last 8 frames from the visual memory buffer to Gemini

### 2. AI Decision Making

Gemini receives:
- A **system prompt** describing available actions, coordinate system, and rules
- **Environment info** (OS, shell, screen resolution, scale factor)
- **Conversation history** (last 6 messages)
- **Visual timeline** (up to 8 chronological screenshots with timestamps)
- The **current screenshot** (highest resolution)
- The **user's request**

It returns structured JSON with an explanation and an ordered array of actions.

### 3. Visible Execution

Each action is performed visibly:
- **`command`**: Opens a real PowerShell window, echoes a description comment, pastes the command via clipboard (Ctrl+V for reliability), presses Enter
- **`click`**: Mouse glides to the target at 600px/s, pauses 400ms so you see the hover, clicks, dwells 300ms
- **`type`**: Types character by character at ~20-28 chars/sec
- **`keypress`**: Presses key combinations (Enter, Ctrl+S, Tab, etc.)
- **`scroll`**: Scrolls up or down
- **`wait`**: Pauses between actions when needed

### 4. Stability Detection

After each action, Omni polls the screen at low resolution (480×270) every 800ms. When two consecutive frames are identical, it knows the action has finished and moves to the next step. The overlay is hidden during these checks to avoid false positives from its own animations.

## Project Structure

```
omni_-ai-setup-agent/
├── electron/                  # Electron main process (TypeScript source)
│   ├── main.ts               # Window creation, IPC handlers, screen capture
│   ├── preload.ts            # Secure IPC bridge (contextBridge)
│   ├── actionExecutor.ts     # OS-level automation via nut.js
│   ├── screenCapture.ts      # Screen capture utilities
│   ├── sessionController.ts  # FSM: Idle → Listening → Talking → Acting
│   └── visualMemory.ts       # 8-frame FIFO screenshot buffer
├── src/                       # React frontend (renderer process)
│   ├── App.tsx               # Root component (Electron vs browser detection)
│   ├── main.tsx              # React entry point
│   ├── types.ts              # Shared TypeScript interfaces
│   ├── components/
│   │   ├── OverlayWidget.tsx # Main chat panel + action execution UI
│   │   ├── VisualOverlay.tsx # Mouse pointer indicator + action labels
│   │   └── SetupEnvironment.tsx # Browser-mode environment display
│   └── services/
│       └── gemini.ts         # Gemini API integration (multimodal + TTS)
├── dist-electron/             # Compiled Electron JS (generated)
├── .env.example              # Template for API key
├── .env.local                # Your actual API key (gitignored)
├── package.json
├── tsconfig.json             # Frontend TypeScript config
├── tsconfig.electron.json    # Electron TypeScript config
└── vite.config.ts            # Vite configuration
```

## IPC Architecture

The Electron app uses a strict IPC boundary between the main process and the renderer:

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `screen:capture` | Renderer → Main | Capture desktop screenshot (hides overlay) |
| `screen:get-buffer` | Renderer → Main | Get visual memory buffer (last 8 frames) |
| `action:execute` | Renderer → Main | Execute a single action via nut.js |
| `action:wait-for-stable` | Renderer → Main | Wait for screen to stop changing |
| `action:progress` | Main → Renderer | Real-time action execution status |
| `system:env-info` | Renderer → Main | Get OS, shell, Node version, screen size |
| `system:screen-dimensions` | Renderer → Main | Get width, height, scale factor |
| `set-ignore-mouse-events` | Renderer → Main | Toggle click-through on the overlay |
| `app:quit` | Renderer → Main | Quit the application |

## Configuration

### Environment Variables (`.env.local`)

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### Key Parameters

| Parameter | Location | Default | Description |
|-----------|----------|---------|-------------|
| Mouse speed | `actionExecutor.ts` | 600 px/s | How fast the cursor moves during automation |
| Typing speed | `actionExecutor.ts` | 35-60ms/char | Per-character delay during visible typing |
| Visual buffer size | `main.ts` | 8 frames | Number of screenshots kept in memory |
| Background capture interval | `main.ts` | 10 seconds | How often the idle screenshot poll runs |
| Stability check interval | `main.ts` | 800ms | How often screen is polled for stability |
| Stability timeout | `OverlayWidget.tsx` | 15s (actions) / 120s (commands) | Max wait for screen to stabilize |

## Current Status & Known Limitations

### What Works
- ✅ Transparent always-on-top overlay with click-through
- ✅ Real desktop screenshot capture (overlay hidden during capture)
- ✅ Gemini multimodal analysis with visual timeline
- ✅ Visible terminal command execution (PowerShell opens, commands typed visibly)
- ✅ Visible mouse movement and clicking at readable speed
- ✅ Voice input with continuous recognition and auto-submit
- ✅ Pre-built template quick-starts
- ✅ Visual stability detection between actions
- ✅ Active and Passive agent modes
- ✅ Quit button in the overlay header

### Known Limitations
- **Windows-primary**: PowerShell opening logic is Windows-specific; macOS/Linux would need Terminal.app / gnome-terminal equivalents
- **No error recovery loop**: If a command fails (e.g., `winget` not found), the AI doesn't automatically retry with an alternative — it proceeds to the next planned action
- **Overlay flicker**: The overlay briefly hides during screen capture and stability checks, causing subtle flicker
- **Single monitor**: Currently captures only the primary display
- **No admin elevation**: Commands run at the current user's privilege level; some installations may require manual UAC approval

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes and ensure `npm run lint` passes
4. Submit a pull request
