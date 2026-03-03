/**
 * Visual Memory Buffer
 * A fixed-size FIFO rolling queue of recent screenshots with metadata.
 * 
 * From spec: "Capacity: 5 to 10 frames. Replacement policy: First-in-first-out.
 * Retention: Only recent interaction context. Older frames are discarded automatically."
 */
import { VisualFrame } from '../src/types';

export class VisualMemoryBuffer {
    private buffer: VisualFrame[] = [];
    private capacity: number;
    private nextIndex: number = 0;

    constructor(capacity: number = 8) {
        this.capacity = capacity;
    }

    /**
     * Add a new frame to the buffer.
     * If at capacity, the oldest frame is evicted (FIFO).
     */
    addFrame(frame: VisualFrame): void {
        if (this.buffer.length >= this.capacity) {
            this.buffer.shift(); // Remove oldest
        }
        this.buffer.push(frame);
        this.nextIndex++;
    }

    /**
     * Get all frames in chronological order.
     */
    getFrames(): VisualFrame[] {
        return [...this.buffer];
    }

    /**
     * Get the most recent N frames.
     */
    getRecentFrames(count: number): VisualFrame[] {
        return this.buffer.slice(-count);
    }

    /**
     * Get the latest frame (current screen state).
     */
    getLatestFrame(): VisualFrame | null {
        return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1] : null;
    }

    /**
     * Get the next sequential index for a new frame.
     */
    getNextIndex(): number {
        return this.nextIndex;
    }

    /**
     * Get the current number of frames in the buffer.
     */
    getSize(): number {
        return this.buffer.length;
    }

    /**
     * Clear all frames from the buffer.
     */
    clear(): void {
        this.buffer = [];
    }
}
