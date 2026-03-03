export type AgentMode = 'Passive' | 'Active';
export type SessionState = 'Idle' | 'Listening' | 'Acting' | 'Talking';

export interface Point {
  x: number;
  y: number;
}

export interface SetupAction {
  type: 'type' | 'click' | 'wait' | 'command' | 'highlight' | 'scroll' | 'keypress';
  target?: string;
  value?: string;
  description: string;
  coordinates?: Point; // Normalized coordinates (0-100)
}

export interface GeminiResponse {
  explanation: string;
  actions: SetupAction[];
  status: 'success' | 'error' | 'pending';
}

export interface VisualFrame {
  image: string;        // base64 encoded screenshot
  timestamp: string;    // UTC ISO timestamp
  appName?: string;     // Active application name
  windowTitle?: string; // Active window title
  index: number;        // Sequential frame index
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  actions?: SetupAction[];
  timestamp: Date;
  status?: 'pending' | 'complete' | 'error';
}

export interface SetupTemplate {
  id: string;
  label: string;
  description: string;
  prompt: string;
  icon: string; // Lucide icon name
  category: 'runtime' | 'tool' | 'framework' | 'config';
  difficulty: 'beginner' | 'intermediate';
}

export interface EnvironmentInfo {
  os: string;
  shell: string;
  runtimes: { name: string; version: string; installed: boolean }[];
  tools: { name: string; installed: boolean }[];
}

// IPC channel names for Electron communication
export const IPC_CHANNELS = {
  CAPTURE_SCREEN: 'screen:capture',
  GET_VISUAL_BUFFER: 'screen:get-buffer',
  EXECUTE_ACTION: 'action:execute',
  ACTION_PROGRESS: 'action:progress',
  SESSION_STATE: 'session:state',
  GET_ENV_INFO: 'system:env-info',
} as const;
