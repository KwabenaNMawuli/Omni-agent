/**
 * Session Controller
 * Finite-state manager governing the agent's interaction lifecycle.
 * 
 * States: Idle → Listening → Talking → Acting → Idle
 * 
 * From spec: "Finite-state manager governing Idle, Listening, Acting, and Talking."
 */
import { SessionState } from '../src/types';

type TransitionCallback = (from: SessionState, to: SessionState) => void;

const VALID_TRANSITIONS: Record<SessionState, SessionState[]> = {
    Idle: ['Listening'],
    Listening: ['Talking', 'Idle'],
    Talking: ['Acting', 'Idle'],
    Acting: ['Idle', 'Talking'],
};

export class SessionController {
    private state: SessionState = 'Idle';
    private listeners: TransitionCallback[] = [];
    private stateHistory: { state: SessionState; timestamp: string }[] = [];

    /**
     * Get the current session state.
     */
    getState(): SessionState {
        return this.state;
    }

    /**
     * Attempt to transition to a new state.
     * Returns true if the transition is valid and was performed.
     */
    transition(newState: SessionState): boolean {
        const validTargets = VALID_TRANSITIONS[this.state];
        if (!validTargets.includes(newState)) {
            console.warn(
                `[SessionController] Invalid transition: ${this.state} → ${newState}. ` +
                `Valid targets: ${validTargets.join(', ')}`
            );
            return false;
        }

        const oldState = this.state;
        this.state = newState;
        this.stateHistory.push({
            state: newState,
            timestamp: new Date().toISOString(),
        });

        // Notify listeners
        for (const cb of this.listeners) {
            cb(oldState, newState);
        }

        return true;
    }

    /**
     * Register a callback for state transitions.
     */
    onTransition(callback: TransitionCallback): void {
        this.listeners.push(callback);
    }

    /**
     * Get the state transition history.
     */
    getHistory(): { state: SessionState; timestamp: string }[] {
        return [...this.stateHistory];
    }

    /**
     * Reset to idle state.
     */
    reset(): void {
        const oldState = this.state;
        this.state = 'Idle';
        for (const cb of this.listeners) {
            cb(oldState, 'Idle');
        }
    }
}
