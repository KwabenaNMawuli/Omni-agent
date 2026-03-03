# Omni Architecture & Design Decisions

This document explains the internal architecture of Omni, the design decisions made during development, and the rationale behind each major subsystem.

---

## High-Level Overview

Omni is an Electron desktop application with a React renderer that acts as a transparent overlay. It observes the user's screen via `desktopCapturer`, reasons about it with Google Gemini, and performs visible automation actions via nut.js.

```
┌─────────────────────────────────────────────────┐
│                  User's Desktop                 │
│                                                 │
│   ┌──────────┐    ┌───────────────────────┐     │
│   │ Terminal  │    │ Browser / IDE / etc.  │     │
│   │ (visible) │    │                       │     │
│   └──────────┘    └───────────────────────┘     │
│                                                 │
│   ┌─────────────────────────────────────────┐   │
│   │        Omni Overlay (transparent)       │   │
│   │   ┌───────────┐  ┌──────────────────┐   │   │
│   │   │ Visual    │  │ Chat Panel       │   │   │
│   │   │ Overlay   │  │ (bottom-right)   │   │   │
│   │   │ (pointer) │  │                  │   │   │
│   │   └───────────┘  └──────────────────┘   │   │
│   └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
        │                       │
        │ IPC (contextBridge)   │
        ▼                       ▼
┌─────────────────────────────────────────────────┐
│              Electron Main Process              │
│                                                 │
│  ┌──────────────┐  ┌─────────────────────────┐  │
│  │ScreenCapture │  │   ActionExecutor        │  │
│  │(desktopCapt.)│  │   (nut.js + clipboard)  │  │
│  └──────────────┘  └─────────────────────────┘  │
│  ┌──────────────┐  ┌─────────────────────────┐  │
│  │VisualMemory  │  │   SessionController     │  │
│  │(8-frame FIFO)│  │   (FSM state machine)   │  │
│  └──────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────┘
        │
        │ HTTPS
        ▼
┌─────────────────────┐
│  Google Gemini API   │
│  (2.5 Flash)         │
│  Multimodal + JSON   │
└─────────────────────┘
```

---

## Process Architecture

### Main Process (`electron/main.ts`)

Responsibilities:
- Creates the transparent, frameless, always-on-top `BrowserWindow`
- Registers all IPC handlers
- Manages screen capture (hiding overlay before each capture)
- Runs background screenshot polling (every 10s when idle)
- Hosts the `VisualMemoryBuffer`, `ActionExecutor`, and `SessionController` singletons

**Key design decision**: The main process owns all native OS access. The renderer never touches `desktopCapturer`, the file system, or nut.js directly. Everything passes through `contextBridge` IPC.

### Renderer Process (`src/`)

A standard React 19 app bundled by Vite. In Electron mode, it renders only the `OverlayWidget` on a transparent background. In browser mode, it renders a full landing page.

**Key design decision**: The renderer detects Electron by checking for `window.omniAPI`. This allows the same codebase to run as a normal web app (with limited features) or as a full desktop agent.

### Preload Script (`electron/preload.ts`)

The only bridge between worlds. Exposes a curated `window.omniAPI` object with typed methods. No `nodeIntegration`, no `remote` — full `contextIsolation`.

---

## Subsystem Details

### 1. Screen Capture

**Problem**: The AI was seeing its own overlay in screenshots and trying to click its own buttons.

**Solution**: Before every screenshot, the overlay window is hidden (`mainWindow.hide()`), a 150ms delay allows the OS compositor to update, the capture runs, then the overlay is re-shown with `showInactive()` (not `show()`) to avoid stealing keyboard focus from whatever the user is watching.

This applies to:
- On-demand captures (`screen:capture` IPC)
- Background idle captures (every 10s)
- Stability detection polling (`action:wait-for-stable`)

### 2. Visual Memory Buffer (`electron/visualMemory.ts`)

An 8-frame FIFO queue. Each frame stores:
- Base64 screenshot data
- UTC timestamp
- Application name and window title
- Sequential index

Frames are automatically evicted when the buffer is full. This gives Gemini a "temporal timeline" of what the user has been doing — it can see transitions, loading states, and dialog changes across time.

### 3. Action Executor (`electron/actionExecutor.ts`)

Translates AI action plans into OS-level operations. Every action is designed to be **visible and educational**.

#### Command Execution Flow

```
1. First command?
   → Spawn a visible PowerShell window via `start powershell -NoExit`
   → Wait 4 seconds for full initialization

2. Echo a description comment
   → typeSlowly(`echo "Omni: Install JDK 21 via winget"`)
   → Press Enter → user sees what's about to happen

3. Paste the actual command via clipboard
   → clipboard.setContent("winget install ...")
   → Ctrl+V to paste (100% reliable, no dropped characters)
   → 600ms pause so user can read the command

4. Press Enter to execute
   → User watches the output in real time
```

**Why clipboard paste instead of typing?** Character-by-character typing via nut.js can drop characters when the system is under load (e.g., an installer running in the background). The clipboard approach is 100% reliable while still being visible — the user sees the full command appear instantly before Enter is pressed.

**Why echo before the command?** The user needs context. Without the echo, they see a command appear and execute without knowing *why*. The echo acts as a narration layer.

#### Mouse Operations

- **Speed**: 600px/s (down from the default 2000px/s) — slow enough to follow with your eyes
- **Hover pause**: 400ms dwell on target before clicking — user sees exactly where the click will land
- **Post-click dwell**: 300ms after click — user sees the immediate result

#### Typing

- Character-by-character at 35-60ms per character (~20 chars/sec)
- Random jitter in the delay for a natural feel

### 4. Session Controller (`electron/sessionController.ts`)

A finite state machine with four states:

```
Idle → Listening → Talking → Acting → Idle
  ↑                                     │
  └─────────────────────────────────────┘
```

- **Idle**: Waiting for user input
- **Listening**: Voice recognition is active (Web Speech API)
- **Talking**: Gemini is processing and/or TTS is playing
- **Acting**: Action plan is being executed on the desktop

### 5. Gemini Integration (`src/services/gemini.ts`)

#### Prompt Engineering

The system prompt is heavily engineered to prevent common failure modes:

| Problem | Prompt Mitigation |
|---------|-------------------|
| AI clicking its own overlay | "NEVER try to click on the Omni overlay/widget" + overlay hidden during capture |
| AI generating only `wait` actions | "NEVER generate a 'wait' action as your first or only action" |
| AI not knowing the OS | Environment info (OS, shell, Node version) passed explicitly |
| Imprecise mouse coordinates | Exact screen resolution + px-per-unit calculation + landmark guidance (taskbar y=96-100%) |
| AI chaining commands with `&&` | "Keep commands simple and one-per-action" |

#### Multimodal Input

Each request sends to Gemini:
1. Conversation history (last 6 messages)
2. Visual buffer frames (up to 8 screenshots with timestamps and metadata)
3. Current screenshot (full resolution)
4. User's text request

The response schema is enforced via Gemini's `responseMimeType: "application/json"` with a full JSON Schema definition, ensuring the AI always returns valid structured actions.

### 6. Visual Stability Detection

**Problem**: Fixed delays (e.g., "wait 3 seconds after click") are unreliable — some actions complete in 200ms, others take 30 seconds.

**Solution**: After each action, the system rapidly polls the screen at low resolution (480×270) every 800ms. When two consecutive frames are byte-identical, the screen has stopped changing and the next action can begin.

**Overlay handling**: The overlay is hidden before each stability snapshot and re-shown with `showInactive()` afterward. Without this, the overlay's own animations (pulsing status dot, action progress indicators) would make every frame look different, causing the check to timeout.

**Timeout strategy**:
- Regular actions (click, type, keypress): 15 seconds
- Commands (installations, builds): 120 seconds (2 minutes)
- Background commands (large downloads): May exceed timeout — the system proceeds anyway

### 7. Overlay Window

The Electron window is configured as:
- **Transparent**: `transparent: true` — only rendered pixels are visible
- **Frameless**: `frame: false` — no title bar or borders
- **Always on top**: `alwaysOnTop: true` — stays above all windows
- **Click-through**: `setIgnoreMouseEvents(true, { forward: true })` — mouse events pass through to the desktop

The click-through is toggled off when the mouse enters the chat panel (`onMouseEnter` / `onMouseLeave`), allowing the user to interact with the overlay UI when needed.

During action execution, click-through is re-enabled globally so nut.js mouse clicks reach the actual desktop targets beneath the overlay.

---

## Data Flow: Complete Request Lifecycle

```
User types "Install Java" and clicks Send
    │
    ├─ 1. OverlayWidget.handleSubmit()
    │     ├─ Adds user message to chat
    │     ├─ Sets state → 'Talking'
    │     ├─ Calls captureScreen() → IPC screen:capture
    │     │     ├─ Main process hides overlay
    │     │     ├─ desktopCapturer.getSources()
    │     │     ├─ Main process re-shows overlay (showInactive)
    │     │     └─ Returns base64 PNG
    │     ├─ Calls getVisualBuffer() → IPC screen:get-buffer
    │     ├─ Calls getScreenDimensions() → IPC system:screen-dimensions
    │     ├─ Calls getEnvInfo() → IPC system:env-info
    │     └─ Calls getSetupInstructions() → Gemini API
    │           ├─ Builds multimodal prompt (screenshots + history + intent)
    │           └─ Returns { explanation, actions[], status }
    │
    ├─ 2. Response displayed in chat (typing animation)
    │
    ├─ 3. User clicks "Execute Setup"
    │     └─ OverlayWidget.runActions()
    │           ├─ Sets state → 'Acting'
    │           ├─ Enables click-through (overlay becomes transparent to clicks)
    │           │
    │           ├─ For each action:
    │           │     ├─ Update UI (action index, description, pointer position)
    │           │     ├─ Call onAction(action) → App.handleAction()
    │           │     │     └─ omniAPI.executeAction(action) → IPC action:execute
    │           │     │           └─ ActionExecutor.execute(action)
    │           │     │                 ├─ command: open PowerShell → echo → paste → Enter
    │           │     │                 ├─ click: mouse.move → pause → click
    │           │     │                 ├─ type: typeSlowly()
    │           │     │                 └─ keypress: pressKey → releaseKey
    │           │     │
    │           │     └─ Wait for stability
    │           │           └─ omniAPI.waitForScreenStable() → IPC action:wait-for-stable
    │           │                 ├─ Hide overlay
    │           │                 ├─ Capture at 480×270
    │           │                 ├─ Compare with previous frame
    │           │                 ├─ Re-show overlay (showInactive)
    │           │                 └─ Repeat until stable or timeout
    │           │
    │           ├─ Disable click-through (overlay interactive again)
    │           ├─ Sets state → 'Idle'
    │           └─ Confetti celebration 🎉
    │
    └─ Done
```

---

## Security Model

- **Context Isolation**: The renderer runs in a sandboxed context with no direct Node.js access
- **No `nodeIntegration`**: All OS operations go through the curated `contextBridge` API
- **No `remote` module**: Removed entirely
- **API key in `.env.local`**: Loaded by Vite at build time, never exposed to the user
- **`--no-sandbox` flag**: Added to work around Electron's "Network service crashed" issue on Windows; this relaxes Chromium's sandbox — acceptable for a local-only desktop tool but should be revisited for distribution

---

## Evolution & Key Fixes

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| "Error connecting to AI service" | Model `gemini-2.5-flash-preview-05-20` deprecated | Changed to stable `gemini-2.5-flash` |
| AI hallucinating screen content | `html2canvas` captured only the overlay's own DOM | Switched to `desktopCapturer` via IPC |
| AI clicking its own "Execute Setup" button | Overlay visible in screenshots | Hide overlay before every capture |
| Voice input toggling off immediately | `continuous=false` + stale closure on `state` | `continuous=true` + refs for stable state |
| Actions not actually executing on desktop | `handleAction` was a no-op `setTimeout` | Wired to `omniAPI.executeAction()` via IPC |
| Coordinate offset (clicks landing wrong) | Window used `workAreaSize` (excludes taskbar) | Changed to `display.size` (full screen) |
| Actions rushing (not waiting for completion) | Fixed `setTimeout` delays | Visual stability detection via screen polling |
| "nget" instead of "winget" (dropped chars) | `keyboard.type()` drops chars when system is busy | Clipboard paste via Ctrl+V |
| Agent freezing after errors | Overlay animations made stability check never pass | Hide overlay during stability polling |
| Terminal opening with no context for user | Win+R → powershell — cryptic and unreliable | `start powershell` + echo description before each command |
| Overlay stealing focus from terminal | `mainWindow.show()` grabs focus | Changed to `showInactive()` everywhere |
| "Network service crashed" on Windows | Electron Chromium sandbox issue | Added `--no-sandbox` command-line switch |
