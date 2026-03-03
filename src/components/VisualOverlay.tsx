import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Point, AgentMode, SetupAction } from '../types';
import { MousePointer2 } from 'lucide-react';

interface VisualOverlayProps {
  mode: AgentMode;
  coordinates: Point | null;
  isActive: boolean;
  actionDescription?: string;
}

export default function VisualOverlay({ mode, coordinates, isActive, actionDescription }: VisualOverlayProps) {
  if (!isActive || !coordinates) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[100]">
      <AnimatePresence>
        {mode === 'Active' ? (
          // Visual Pointer for Active Mode — with tooltip + ripple
          <motion.div
            key="pointer"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{
              opacity: 1,
              scale: 1,
              left: `${coordinates.x}%`,
              top: `${coordinates.y}%`
            }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="absolute -translate-x-1/2 -translate-y-1/2"
          >
            <div className="relative">
              {/* Pointer icon */}
              <MousePointer2 className="text-white drop-shadow-lg fill-emerald-500" size={32} />

              {/* Pulsing glow ring */}
              <motion.div
                animate={{ scale: [1, 1.8, 1], opacity: [0.5, 0, 0.5] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
                className="absolute -inset-2 bg-emerald-500 rounded-full blur-md -z-10"
              />

              {/* Click ripple effect */}
              <motion.div
                initial={{ scale: 0, opacity: 0.6 }}
                animate={{ scale: 3, opacity: 0 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="absolute inset-0 border-2 border-emerald-400 rounded-full -z-10"
              />

              {/* Tooltip with action description */}
              {actionDescription && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute top-10 left-0 whitespace-nowrap"
                >
                  <div className="bg-zinc-900/95 backdrop-blur-md border border-emerald-500/30 rounded-lg px-3 py-1.5 shadow-xl">
                    <p className="text-xs font-medium text-emerald-400">{actionDescription}</p>
                  </div>
                  <div className="w-2 h-2 bg-zinc-900 border-l border-t border-emerald-500/30 rotate-45 absolute -top-1 left-4" />
                </motion.div>
              )}
            </div>
          </motion.div>
        ) : (
          // Highlight for Passive Mode — with tooltip + connecting line
          <motion.div
            key="highlight"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{
              opacity: 1,
              scale: 1,
              left: `${coordinates.x}%`,
              top: `${coordinates.y}%`
            }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="absolute -translate-x-1/2 -translate-y-1/2"
          >
            {/* Dashed border ring */}
            <div className="w-28 h-28 rounded-full border-[3px] border-dashed border-amber-500 animate-[spin_12s_linear_infinite]" />

            {/* Inner glow */}
            <div className="absolute inset-2 bg-amber-500/15 rounded-full blur-lg animate-pulse" />

            {/* Pulse ring */}
            <motion.div
              animate={{ scale: [0.9, 1.3, 0.9], opacity: [0.4, 0, 0.4] }}
              transition={{ repeat: Infinity, duration: 2 }}
              className="absolute -inset-4 border border-amber-500/30 rounded-full"
            />

            {/* Tooltip */}
            {actionDescription && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="absolute -bottom-14 left-1/2 -translate-x-1/2 whitespace-nowrap"
              >
                <div className="bg-zinc-900/95 backdrop-blur-md border border-amber-500/30 rounded-lg px-3 py-1.5 shadow-xl">
                  <p className="text-xs font-medium text-amber-400">{actionDescription}</p>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
