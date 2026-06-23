import { Activity, Cpu } from "lucide-react";
import { useStore } from "../store/useStore";
import { SESSION_COLOR, timeAgo } from "../lib/ui";

export default function ActiveSessions() {
  // Select the stable map and derive the array in render (a selector returning
  // Object.values(...) creates a new array each call and breaks zustand v5's
  // snapshot caching -> infinite render loop / blank screen).
  const sessionMap = useStore((s) => s.sessions);
  const sessions = Object.values(sessionMap);

  return (
    <section className="glass rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Activity size={18} className="text-[var(--color-accent-2)]" />
        <h2 className="text-sm font-semibold tracking-wide uppercase text-white/70">
          Active Sessions
        </h2>
        <span className="ml-auto text-xs text-white/40">{sessions.length} running</span>
      </div>

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-white/40">
          <Cpu size={32} className="mb-3 opacity-50" />
          <p className="text-sm font-medium text-white/50">No active agents</p>
          <p className="text-xs mt-1 text-white/30 max-w-xs text-center leading-relaxed">
            Open a terminal and run{" "}
            <code className="px-1.5 py-0.5 rounded bg-white/10 font-mono">pingo claude</code>,{" "}
            <code className="px-1.5 py-0.5 rounded bg-white/10 font-mono">pingo opencode</code>, or{" "}
            <code className="px-1.5 py-0.5 rounded bg-white/10 font-mono">pingo aider</code>{" "}
            to start monitoring an agent.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-white/40 text-xs uppercase tracking-wider">
                <th className="pb-2 font-medium">Agent</th>
                <th className="pb-2 font-medium">PID</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Started</th>
                <th className="pb-2 font-medium">Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={`${s.agent}-${s.pid}`} className="border-t border-white/5">
                  <td className="py-2.5 font-medium">{s.agent}</td>
                  <td className="py-2.5 text-white/60 font-mono text-xs">{s.pid}</td>
                  <td className="py-2.5">
                    <span
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs"
                      style={{
                        background: `${SESSION_COLOR[s.status] ?? "#888"}22`,
                        color: SESSION_COLOR[s.status] ?? "#aaa",
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: SESSION_COLOR[s.status] ?? "#aaa" }}
                      />
                      {s.status}
                    </span>
                  </td>
                  <td className="py-2.5 text-white/60">{timeAgo(s.start_time)}</td>
                  <td className="py-2.5 text-white/60">{timeAgo(s.last_activity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
