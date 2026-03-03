import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Terminal, FileCode, Folder, FolderPlus, Monitor, Cpu, Globe, HardDrive, CheckCircle2 } from 'lucide-react';
import { SetupAction, EnvironmentInfo } from '../types';

interface SetupEnvironmentProps {
  lastAction: SetupAction | null;
  environmentInfo?: EnvironmentInfo;
}

interface LogEntry {
  type: 'info' | 'command' | 'success' | 'error' | 'output';
  text: string;
  timestamp: string;
}

export default function SetupEnvironment({ lastAction, environmentInfo }: SetupEnvironmentProps) {
  const [logs, setLogs] = useState<LogEntry[]>([
    { type: 'info', text: '● Omni Virtual Environment initialized.', timestamp: new Date().toLocaleTimeString() },
    { type: 'info', text: '● Waiting for instructions...', timestamp: new Date().toLocaleTimeString() }
  ]);
  const [files, setFiles] = useState<{ name: string; isNew: boolean }[]>([
    { name: 'package.json', isNew: false },
    { name: 'README.md', isNew: false }
  ]);
  const [typingCommand, setTypingCommand] = useState<string | null>(null);
  const [typedChars, setTypedChars] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Typed command animation
  useEffect(() => {
    if (typingCommand && typedChars < typingCommand.length) {
      const timer = setTimeout(() => {
        setTypedChars(prev => prev + 1);
      }, 30 + Math.random() * 40); // Variable typing speed for realism
      return () => clearTimeout(timer);
    } else if (typingCommand && typedChars >= typingCommand.length) {
      // Command fully typed — add output
      const timestamp = new Date().toLocaleTimeString();
      setTimeout(() => {
        setLogs(prev => [...prev, { type: 'success', text: '✓ Command executed successfully.', timestamp }]);
        setTypingCommand(null);
        setTypedChars(0);
      }, 600);
    }
  }, [typingCommand, typedChars]);

  useEffect(() => {
    if (lastAction) {
      const timestamp = new Date().toLocaleTimeString();
      if (lastAction.type === 'command') {
        // Start typed animation
        setTypingCommand(lastAction.value || 'echo "done"');
        setTypedChars(0);
        setLogs(prev => [...prev, {
          type: 'command',
          text: `$ ${lastAction.value || ''}`,
          timestamp
        }]);
      } else if (lastAction.type === 'type') {
        setLogs(prev => [...prev, {
          type: 'info',
          text: `📝 Writing to ${lastAction.target || 'file'}...`,
          timestamp
        }]);
        // Simulate file creation
        if (lastAction.target) {
          setTimeout(() => {
            setFiles(prev => {
              if (prev.find(f => f.name === lastAction.target)) return prev;
              return [...prev, { name: lastAction.target!, isNew: true }];
            });
          }, 500);
        }
      } else if (lastAction.type === 'click') {
        setLogs(prev => [...prev, {
          type: 'info',
          text: `🖱️ ${lastAction.description}`,
          timestamp
        }]);
      } else if (lastAction.type === 'wait') {
        setLogs(prev => [...prev, {
          type: 'info',
          text: `⏳ ${lastAction.description}`,
          timestamp
        }]);
      }
    }
  }, [lastAction]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, typedChars]);

  const defaultEnv: EnvironmentInfo = environmentInfo || {
    os: 'Windows 11',
    shell: 'PowerShell 7',
    runtimes: [
      { name: 'Node.js', version: '—', installed: false },
      { name: 'Python', version: '—', installed: false },
      { name: 'Java', version: '—', installed: false }
    ],
    tools: [
      { name: 'Git', installed: false },
      { name: 'VS Code', installed: true },
      { name: 'Docker', installed: false }
    ]
  };

  return (
    <div className="grid grid-cols-12 gap-4 h-full relative" style={{ backgroundColor: '#050505' }}>
      {/* Sidebar — File Explorer */}
      <div className="col-span-3 rounded-2xl p-4 flex flex-col gap-4 glass-card">
        <div className="flex items-center gap-2 px-2 text-zinc-400">
          <Folder size={14} className="text-emerald-500" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Project Explorer</span>
        </div>
        <div className="space-y-0.5">
          <AnimatePresence>
            {files.map((file, idx) => (
              <motion.div
                key={file.name}
                initial={file.isNew ? { opacity: 0, x: -20, height: 0 } : false}
                animate={{ opacity: 1, x: 0, height: 'auto' }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer hover:bg-zinc-800/50 transition-colors group"
              >
                <FileCode size={14} className={file.isNew ? 'text-emerald-400' : 'text-blue-400'} />
                <span className="text-zinc-300 group-hover:text-white transition-colors text-xs font-mono">
                  {file.name}
                </span>
                {file.isNew && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="ml-auto text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded"
                  >
                    NEW
                  </motion.span>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Environment Info Panel */}
        <div className="mt-auto space-y-3 pt-4 border-t border-zinc-800/50">
          <div className="flex items-center gap-2 px-2 text-zinc-400">
            <HardDrive size={14} className="text-blue-400" />
            <span className="text-[10px] font-bold uppercase tracking-wider">System</span>
          </div>
          <div className="space-y-2 px-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-zinc-500">OS</span>
              <span className="text-[10px] font-mono text-zinc-300">{defaultEnv.os}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-zinc-500">Shell</span>
              <span className="text-[10px] font-mono text-zinc-300">{defaultEnv.shell}</span>
            </div>
          </div>
          <div className="space-y-1 px-2">
            {defaultEnv.runtimes.map(rt => (
              <div key={rt.name} className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-500">{rt.name}</span>
                <span className={`text-[10px] font-mono ${rt.installed ? 'text-emerald-400' : 'text-zinc-600'}`}>
                  {rt.installed ? rt.version : 'Not installed'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content — Terminal */}
      <div className="col-span-9 flex flex-col gap-4">
        <div className="flex-1 rounded-2xl overflow-hidden shadow-2xl flex flex-col glass-card">
          {/* Terminal Header */}
          <div className="px-4 py-2.5 border-b border-zinc-800/50 flex items-center justify-between bg-zinc-900/80">
            <div className="flex items-center gap-3">
              {/* Traffic lights */}
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
              </div>
              <div className="flex items-center gap-2">
                <Terminal size={12} className="text-zinc-500" />
                <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                  omni-env — {defaultEnv.shell}
                </span>
              </div>
            </div>
          </div>

          {/* Terminal Body */}
          <div ref={scrollRef} className="flex-1 p-5 font-mono text-[13px] overflow-y-auto custom-scrollbar space-y-1.5 bg-[#0a0a0a]">
            {logs.map((log, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="flex gap-3"
              >
                <span className="text-zinc-700 shrink-0 text-[11px]">[{log.timestamp}]</span>
                <span className={
                  log.type === 'command' ? 'text-emerald-300 font-bold' :
                    log.type === 'success' ? 'text-emerald-500' :
                      log.type === 'error' ? 'text-red-400' :
                        log.type === 'output' ? 'text-zinc-300' : 'text-zinc-500'
                }>
                  {log.text}
                </span>
              </motion.div>
            ))}

            {/* Typing animation for current command */}
            {typingCommand && (
              <div className="flex gap-3">
                <span className="text-zinc-700 shrink-0 text-[11px]">[{new Date().toLocaleTimeString()}]</span>
                <span className="text-emerald-300 font-bold">
                  $ {typingCommand.slice(0, typedChars)}
                  <span className="typing-cursor" />
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Tool Status Cards */}
        <div className="grid grid-cols-3 gap-3">
          {defaultEnv.tools.map((tool, i) => (
            <motion.div
              key={tool.name}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 * i }}
              className="rounded-xl p-3 flex items-center gap-3 glass-card group hover:bg-zinc-800/30 transition-all"
            >
              <div className={`p-2 rounded-lg ${tool.installed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
                {tool.installed ? <CheckCircle2 size={16} /> : <Monitor size={16} />}
              </div>
              <div>
                <p className="text-[11px] font-bold text-zinc-300">{tool.name}</p>
                <p className={`text-[10px] font-mono ${tool.installed ? 'text-emerald-400' : 'text-zinc-600'}`}>
                  {tool.installed ? 'Installed' : 'Not found'}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
