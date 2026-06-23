import { Terminal, Download, ArrowRight } from "lucide-react";

interface Props {
  onDismiss: () => void;
}

export default function Onboarding({ onDismiss }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0f]/90 backdrop-blur-sm">
      <div className="glass rounded-2xl p-8 max-w-lg w-full mx-4 text-center">
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-2)] flex items-center justify-center mx-auto mb-5">
          <Terminal size={28} className="text-white" />
        </div>

        <h1 className="text-xl font-bold mb-2">Welcome to Pingo</h1>
        <p className="text-sm text-white/60 mb-6">
          Pingo monitors your AI coding agents and notifies you when they need attention.
        </p>

        <div className="bg-white/5 rounded-xl p-5 mb-6 text-left">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Download size={16} className="text-[var(--color-accent)]" />
            Install the CLI
          </h3>
          <p className="text-xs text-white/50 mb-3">
            Pingo works by wrapping AI agents in your terminal. To get started, install the CLI:
          </p>
          <div className="bg-[#0a0a0f] rounded-lg px-4 py-3 text-sm font-mono text-white/80 select-all">
            npm install -g pingo
          </div>
        </div>

        <div className="bg-white/5 rounded-xl px-5 py-4 mb-6 text-left">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <ArrowRight size={16} className="text-[var(--color-accent)]" />
            Quick Start
          </h3>
          <ol className="text-xs text-white/50 space-y-2 list-decimal list-inside">
            <li>Open a terminal and install: <code className="px-1 py-0.5 rounded bg-white/10 font-mono">npm install -g pingo</code></li>
            <li>Run your agent through Pingo: <code className="px-1 py-0.5 rounded bg-white/10 font-mono">pingo claude</code></li>
            <li>Keep this desktop app running to receive notifications</li>
          </ol>
        </div>

        <button
          onClick={onDismiss}
          className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/15 transition-colors text-sm font-medium"
        >
          I understand, continue in standalone mode
        </button>
        <p className="text-[10px] text-white/30 mt-3">
          Notifications will still work through your terminal
        </p>
      </div>
    </div>
  );
}
