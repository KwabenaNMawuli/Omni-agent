/**
 * Action Executor
 * Translates AI-generated action plans into OS-level mouse and keyboard
 * operations using nut.js.
 * 
 * Every action is VISIBLE to the user — mouse movements, typing, terminal
 * commands — so they can learn by watching and repeat the steps later.
 */
import { SetupAction, Point } from '../src/types';

// nut.js for OS-level mouse / keyboard automation
let nut: any = null;
try {
    nut = require('@nut-tree-fork/nut-js');
    // Slow enough for the user to follow the cursor visually
    if (nut?.mouse) nut.mouse.config.mouseSpeed = 600;
} catch {
    console.warn('[ActionExecutor] @nut-tree-fork/nut-js not found — actions will be simulated only.');
}

export interface ActionResult {
    success: boolean;
    action: SetupAction;
    duration: number;
    error?: string;
}

export class ActionExecutor {
    private screenWidth: number = 1920;
    private screenHeight: number = 1080;
    private scaleFactor: number = 1;
    /** Whether we've already opened a visible terminal in this session */
    private terminalOpen: boolean = false;

    constructor() {
        // Get actual screen dimensions when available
        try {
            const { screen } = require('electron');
            const primary = screen.getPrimaryDisplay();
            this.scaleFactor = primary.scaleFactor || 1;
            // Use the actual pixel size (accounts for DPI scaling)
            this.screenWidth = primary.size.width;
            this.screenHeight = primary.size.height;
            console.log(`[ActionExecutor] Screen: ${this.screenWidth}x${this.screenHeight} @ ${this.scaleFactor}x scale`);
        } catch {
            // Not in Electron context — use defaults
        }
    }

    /** Expose screen dimensions so Gemini can be told the exact resolution */
    getScreenDimensions() {
        return { width: this.screenWidth, height: this.screenHeight, scaleFactor: this.scaleFactor };
    }

    /**
     * Convert normalized coordinates (0-100) to absolute pixel positions.
     */
    private normalizedToPixels(coords: Point): { x: number; y: number } {
        return {
            x: Math.round((coords.x / 100) * this.screenWidth),
            y: Math.round((coords.y / 100) * this.screenHeight),
        };
    }

    /**
     * Execute a single action.
     */
    async execute(action: SetupAction): Promise<ActionResult> {
        const startTime = Date.now();

        try {
            switch (action.type) {
                case 'click':
                    await this.executeClick(action);
                    break;
                case 'type':
                    await this.executeType(action);
                    break;
                case 'command':
                    await this.executeCommand(action);
                    break;
                case 'scroll':
                    await this.executeScroll(action);
                    break;
                case 'keypress':
                    await this.executeKeypress(action);
                    break;
                case 'wait':
                    await this.executeWait(action);
                    break;
                case 'highlight':
                    // Highlight is visual-only, no OS action needed
                    break;
                default:
                    throw new Error(`Unknown action type: ${action.type}`);
            }

            return {
                success: true,
                action,
                duration: Date.now() - startTime,
            };
        } catch (error) {
            return {
                success: false,
                action,
                duration: Date.now() - startTime,
                error: String(error),
            };
        }
    }

    /**
     * Move mouse visibly to coordinates, pause so the user sees
     * where we're about to click, then click.
     */
    private async executeClick(action: SetupAction): Promise<void> {
        if (!action.coordinates) {
            throw new Error('Click action requires coordinates');
        }

        const { x, y } = this.normalizedToPixels(action.coordinates);
        console.log(`[ActionExecutor] Click at (${x}, ${y}) — ${action.description}`);

        if (nut) {
            const { mouse, straightTo, Button } = nut;
            const NutPoint = nut.Point;
            // Visible mouse movement (speed limited to 600 px/s in config)
            await mouse.move(straightTo(new NutPoint(x, y)));
            // Hover pause — let the user see exactly where we're about to click
            await this.delay(400);
            await mouse.click(Button.LEFT);
            // Short dwell after click so user can see the result
            await this.delay(300);
        } else {
            await this.delay(500);
        }
    }

    /**
     * Type text at a human-readable pace so the user can follow along.
     */
    private async executeType(action: SetupAction): Promise<void> {
        if (!action.value) {
            throw new Error('Type action requires value');
        }

        console.log(`[ActionExecutor] Typing: "${action.value}" — ${action.description}`);

        if (nut) {
            await this.typeSlowly(action.value);
        } else {
            await this.delay(action.value.length * 50);
        }
    }

    /**
     * Execute a terminal command VISUALLY.
     * 
     * 1) Opens a real PowerShell window (using `start powershell`) if not already open.
     * 2) Types a descriptive echo comment so the user knows what's about to happen.
     * 3) Pastes the actual command via clipboard (Ctrl+V) to avoid dropped characters,
     *    then presses Enter.
     * 
     * The user sees the full flow on screen and can repeat the steps later.
     */
    private async executeCommand(action: SetupAction): Promise<void> {
        if (!action.value) {
            throw new Error('Command action requires value');
        }

        console.log(`[ActionExecutor] Command (visual): ${action.value}`);

        if (nut) {
            const { keyboard, Key, clipboard } = nut;

            // Open a visible PowerShell window if we haven't already
            if (!this.terminalOpen) {
                console.log('[ActionExecutor] Opening PowerShell window...');

                // Use child_process to reliably spawn a visible PowerShell window
                const { exec } = require('child_process');
                exec('start powershell -NoExit -Command "cls"');

                // Wait for the PowerShell window to fully initialize and settle
                await this.delay(4000);

                this.terminalOpen = true;
                console.log('[ActionExecutor] PowerShell window should be open and focused.');
            }

            // --- Step 1: Type a comment describing what we're about to do ---
            // This gives the user context before the command runs.
            const desc = action.description || action.value;
            const commentText = `echo "Omni: ${desc.replace(/"/g, "'")}"`;
            await this.typeSlowly(commentText);
            await this.delay(200);
            await keyboard.pressKey(Key.Return);
            await this.delay(100);
            await keyboard.releaseKey(Key.Return);
            await this.delay(800); // Let the echo complete

            // --- Step 2: Paste the actual command via clipboard ---
            // Clipboard paste is 100% reliable vs character-by-character typing
            // which can drop characters when the system is busy.
            await clipboard.setContent(action.value);
            await this.delay(200);

            // Ctrl+V to paste
            await keyboard.pressKey(Key.LeftControl, Key.V);
            await this.delay(100);
            await keyboard.releaseKey(Key.LeftControl, Key.V);
            await this.delay(600); // Let the user read the pasted command

            // --- Step 3: Press Enter to execute ---
            await keyboard.pressKey(Key.Return);
            await this.delay(100);
            await keyboard.releaseKey(Key.Return);

            // Give the command time to start producing visible output
            await this.delay(2000);
        } else {
            // Fallback when nut.js is unavailable: silent execution
            const { exec } = require('child_process');
            await new Promise<void>((resolve, reject) => {
                const child = exec(
                    action.value,
                    { timeout: 5 * 60 * 1000 },
                    (error: any, stdout: string, stderr: string) => {
                        if (stdout) console.log(`[ActionExecutor] stdout: ${stdout.slice(-2000)}`);
                        if (stderr) console.warn(`[ActionExecutor] stderr: ${stderr.slice(-1000)}`);
                        if (error) reject(error);
                        else resolve();
                    }
                );
                child.stdout?.on('data', (data: string) => process.stdout.write(`[cmd] ${data}`));
                child.stderr?.on('data', (data: string) => process.stderr.write(`[cmd:err] ${data}`));
            });
        }
    }

    /**
     * Scroll in a direction.
     */
    private async executeScroll(action: SetupAction): Promise<void> {
        const amount = 3;
        console.log(`[ActionExecutor] Scroll ${action.value}`);

        if (nut) {
            const { mouse } = nut;
            if (action.value === 'up') {
                await mouse.scrollUp(amount);
            } else {
                await mouse.scrollDown(amount);
            }
        } else {
            await this.delay(300);
        }
    }

    /**
     * Press a key or key combination.
     */
    private async executeKeypress(action: SetupAction): Promise<void> {
        if (!action.value) {
            throw new Error('Keypress action requires value');
        }

        console.log(`[ActionExecutor] Keypress: ${action.value}`);

        if (nut) {
            const { keyboard, Key } = nut;
            // Map common key names to nut.js Key enum
            const keyMap: Record<string, any> = {
                'Enter': Key.Return, 'Return': Key.Return,
                'Tab': Key.Tab, 'Escape': Key.Escape, 'Esc': Key.Escape,
                'Backspace': Key.Backspace, 'Delete': Key.Delete,
                'Space': Key.Space, 'Up': Key.Up, 'Down': Key.Down,
                'Left': Key.Left, 'Right': Key.Right,
                'Ctrl': Key.LeftControl, 'Control': Key.LeftControl,
                'Alt': Key.LeftAlt, 'Shift': Key.LeftShift,
                'Meta': Key.LeftSuper, 'Win': Key.LeftSuper, 'Cmd': Key.LeftSuper,
                'F1': Key.F1, 'F2': Key.F2, 'F3': Key.F3, 'F4': Key.F4,
                'F5': Key.F5, 'F6': Key.F6, 'F7': Key.F7, 'F8': Key.F8,
                'F9': Key.F9, 'F10': Key.F10, 'F11': Key.F11, 'F12': Key.F12,
            };

            const parts = action.value.split('+').map(k => k.trim());
            const nutKeys = parts.map(k => {
                if (keyMap[k]) return keyMap[k];
                // Single character — try to map from Key enum
                const upper = k.toUpperCase();
                if (Key[upper] !== undefined) return Key[upper];
                return Key[k] ?? null;
            }).filter(Boolean);

            if (nutKeys.length > 0) {
                await keyboard.pressKey(...nutKeys);
                await this.delay(80);
                await keyboard.releaseKey(...nutKeys);
            }
        } else {
            await this.delay(200);
        }
    }

    /**
     * Wait for a specified duration.
     */
    private async executeWait(action: SetupAction): Promise<void> {
        const duration = parseInt(action.value || '1000', 10);
        console.log(`[ActionExecutor] Waiting ${duration}ms — ${action.description}`);
        await this.delay(duration);
    }

    /**
     * Type text character-by-character at a human-readable pace.
     * ~35-60 ms per character ≈ 17-28 chars/sec — fast enough to not
     * be boring, slow enough for the user to follow along.
     */
    private async typeSlowly(text: string): Promise<void> {
        if (!nut) return;
        const { keyboard } = nut;
        for (const char of text) {
            await keyboard.type(char);
            await this.delay(35 + Math.random() * 25);
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
