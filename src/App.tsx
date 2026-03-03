import React, { useState } from 'react';
import OverlayWidget from './components/OverlayWidget';
import SetupEnvironment from './components/SetupEnvironment';
import { SetupAction } from './types';
import { motion } from 'motion/react';
import {
  Sparkles, Terminal, ShieldCheck, Zap, Eye, MessageSquare,
  ArrowRight, Mic, MonitorSmartphone, Bot, Play,
  Braces, GitBranch, Code2, Coffee
} from 'lucide-react';

const STEPS = [
  {
    icon: Mic,
    title: "Speak or Type",
    desc: "Tell Omni what you need in plain English — no jargon required.",
    color: "emerald"
  },
  {
    icon: Eye,
    title: "Visual Analysis",
    desc: "Omni captures your screen and understands your current UI state.",
    color: "blue"
  },
  {
    icon: Bot,
    title: "AI Reasoning",
    desc: "Gemini analyzes the visual timeline and generates precise actions.",
    color: "violet"
  },
  {
    icon: Play,
    title: "Auto-Execute",
    desc: "Actions are performed automatically, or Omni guides you step-by-step.",
    color: "amber"
  }
];

const SHOWCASE_TEMPLATES = [
  { icon: Braces, label: "Node.js & npm", desc: "Runtime + package manager" },
  { icon: Code2, label: "Python & pip", desc: "Interpreter + packages" },
  { icon: GitBranch, label: "Git Setup", desc: "Version control config" },
  { icon: Terminal, label: "VS Code", desc: "Editor + extensions" },
  { icon: Coffee, label: "Java + IntelliJ", desc: "JDK + IDE setup" },
  { icon: MonitorSmartphone, label: "React Project", desc: "Vite + TypeScript" },
];

const stepColors: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-500', border: 'border-emerald-500/20', glow: 'shadow-[0_0_30px_rgba(16,185,129,0.15)]' },
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/20', glow: 'shadow-[0_0_30px_rgba(59,130,246,0.15)]' },
  violet: { bg: 'bg-violet-500/10', text: 'text-violet-500', border: 'border-violet-500/20', glow: 'shadow-[0_0_30px_rgba(139,92,246,0.15)]' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-500', border: 'border-amber-500/20', glow: 'shadow-[0_0_30px_rgba(245,158,11,0.15)]' },
};

export default function App() {
  const [lastAction, setLastAction] = useState<SetupAction | null>(null);
  const isElectron = !!(window as any).omniAPI;

  const handleAction = async (action: SetupAction) => {
    setLastAction(action);
    // In Electron, execute the action via IPC (nut.js)
    const api = (window as any).omniAPI;
    if (api?.executeAction) {
      try {
        await api.executeAction(action);
      } catch (e) {
        console.error('Action execution failed:', e);
      }
    } else {
      // Browser fallback — just simulate a delay
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  };

  // In Electron: render ONLY the overlay widget on a transparent background
  if (isElectron) {
    return (
      <div style={{ background: 'transparent', width: '100vw', height: '100vh' }}>
        <OverlayWidget onAction={handleAction} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100 font-sans">
      {/* Background Ambient Glow */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-15%] w-[50%] h-[50%] bg-emerald-500/[0.04] blur-[150px] rounded-full" />
        <div className="absolute bottom-[-20%] right-[-15%] w-[50%] h-[50%] bg-blue-500/[0.03] blur-[150px] rounded-full" />
        <div className="absolute top-[40%] left-[50%] -translate-x-1/2 w-[30%] h-[30%] bg-violet-500/[0.02] blur-[120px] rounded-full" />
      </div>

      {/* Navigation */}
      <nav className="relative z-10 border-b border-zinc-800/40 bg-black/30 backdrop-blur-2xl">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center glow-emerald">
              <Sparkles className="text-white" size={16} />
            </div>
            <span className="font-bold tracking-tight text-base">Omni</span>
            <span className="text-[10px] font-mono text-zinc-600 bg-zinc-800/50 px-2 py-0.5 rounded-md">AI Agent</span>
          </div>
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
              <ShieldCheck size={12} className="text-emerald-500" />
              Secure
            </div>
            <div className="h-3 w-px bg-zinc-800" />
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
              <Zap size={12} className="text-amber-500" />
              v2.0
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="relative z-10 max-w-7xl mx-auto px-6 py-16 flex flex-col gap-20">

        {/* Hero Section */}
        <header className="space-y-6 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">Powered by Gemini</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-6xl font-black tracking-tighter leading-[1.05]"
          >
            Your Personal{' '}
            <span className="gradient-text">DevOps</span>{' '}
            Copilot.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-zinc-400 text-lg leading-relaxed max-w-xl"
          >
            Omni watches your screen, understands your workspace, and automates
            complex environment setups through multimodal AI reasoning.
            Just speak your intent.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="flex items-center gap-4 pt-2"
          >
            <button className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-sm transition-all flex items-center gap-2 glow-emerald">
              <MessageSquare size={16} /> Open Omni
            </button>
            <button className="px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl font-bold text-sm transition-all border border-zinc-700">
              Learn More <ArrowRight size={14} className="inline ml-1" />
            </button>
          </motion.div>
        </header>

        {/* Terminal Simulator */}
        <section id="omni-capture-area" className="h-[550px]">
          <SetupEnvironment lastAction={lastAction} />
        </section>

        {/* How It Works */}
        <section className="space-y-10">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-bold tracking-tight">How Omni Works</h2>
            <p className="text-zinc-500 text-sm">Four simple steps from intent to execution</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {STEPS.map((step, i) => {
              const colors = stepColors[step.color];
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + i * 0.08 }}
                  className={`p-5 rounded-2xl border ${colors.border} ${colors.glow} bg-zinc-900/30 hover:bg-zinc-900/50 transition-all group relative`}
                >
                  {/* Step number */}
                  <div className="absolute top-4 right-4 text-[10px] font-mono text-zinc-700 font-bold">
                    0{i + 1}
                  </div>

                  <div className={`w-10 h-10 ${colors.bg} rounded-xl flex items-center justify-center mb-3 ${colors.text}`}>
                    <step.icon size={20} />
                  </div>
                  <h3 className="font-bold text-sm mb-1.5 text-zinc-200">{step.title}</h3>
                  <p className="text-xs text-zinc-500 leading-relaxed">{step.desc}</p>

                  {/* Connecting arrow (except last) */}
                  {i < STEPS.length - 1 && (
                    <div className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 text-zinc-700 z-10">
                      <ArrowRight size={14} />
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* Template Showcase */}
        <section className="space-y-8">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-bold tracking-tight">Quick Setup Templates</h2>
            <p className="text-zinc-500 text-sm">One-click setup for popular development tools</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {SHOWCASE_TEMPLATES.map((tpl, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.06 }}
                className="p-4 rounded-xl glass-card hover:bg-zinc-800/30 transition-all group cursor-pointer gradient-border"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-zinc-800/80 text-zinc-400 group-hover:text-emerald-400 group-hover:bg-emerald-500/10 transition-all">
                    <tpl.icon size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-zinc-300 group-hover:text-white transition-colors">{tpl.label}</h3>
                    <p className="text-[11px] text-zinc-600">{tpl.desc}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Feature Grid */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              title: "Visual Memory",
              desc: "Continuously logs UI state changes into a rolling screenshot buffer, giving Gemini temporal awareness of your workflow.",
              icon: Eye,
              gradient: "from-emerald-500/10 to-blue-500/5"
            },
            {
              title: "Precise Execution",
              desc: "Generates unambiguous, OS-specific instructions with nut.js automation for mouse and keyboard actions.",
              icon: Zap,
              gradient: "from-amber-500/10 to-orange-500/5"
            },
            {
              title: "Voice + Text",
              desc: "Natural language interaction via microphone or keyboard. Complex configurations feel like a conversation.",
              icon: Mic,
              gradient: "from-violet-500/10 to-blue-500/5"
            }
          ].map((feature, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.08 }}
              className={`p-6 rounded-2xl bg-gradient-to-br ${feature.gradient} border border-zinc-800/50 hover:border-zinc-700/50 transition-all group`}
            >
              <div className="w-10 h-10 bg-zinc-800/50 rounded-xl flex items-center justify-center mb-4 group-hover:bg-emerald-500/10 group-hover:text-emerald-500 transition-colors text-zinc-400">
                <feature.icon size={20} />
              </div>
              <h3 className="font-bold text-sm mb-2 text-zinc-200">{feature.title}</h3>
              <p className="text-xs text-zinc-500 leading-relaxed">{feature.desc}</p>
            </motion.div>
          ))}
        </section>
      </main>

      {/* The Widget */}
      <OverlayWidget onAction={handleAction} />

      {/* Footer */}
      <footer className="relative z-10 border-t border-zinc-900/50 py-10 mt-12">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 bg-emerald-500 rounded-md flex items-center justify-center">
              <Sparkles className="text-white" size={12} />
            </div>
            <p className="text-zinc-600 text-xs font-mono uppercase tracking-wider">
              © 2026 Omni Systems // Built with Gemini
            </p>
          </div>
          <div className="flex gap-6">
            <a href="#" className="text-zinc-600 hover:text-zinc-300 text-xs font-semibold uppercase tracking-wider transition-colors">Docs</a>
            <a href="#" className="text-zinc-600 hover:text-zinc-300 text-xs font-semibold uppercase tracking-wider transition-colors">Privacy</a>
            <a href="#" className="text-zinc-600 hover:text-zinc-300 text-xs font-semibold uppercase tracking-wider transition-colors">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
