import { useEffect, useState } from "react";
import { Wifi, WifiOff, Cpu, Activity } from "lucide-react";
import { useStore } from "../store/useStore";

interface Props {
  cliVersion: string | null;
}

export default function ConnectionStatus({ cliVersion }: Props) {
  const connected = useStore((s) => s.connected);
  const sessions = Object.values(useStore((s) => s.sessions));
  const [heartbeat, setHeartbeat] = useState<"alive" | "stale" | "dead">("dead");

  useEffect(() => {
    const id = setInterval(() => {
      const last = sessions.reduce((latest, s) => {
        const t = new Date(s.last_activity).getTime();
        return isNaN(t) ? latest : Math.max(latest, t);
      }, 0);
      if (last === 0) {
        setHeartbeat(connected ? "alive" : "dead");
      } else {
        const elapsed = Date.now() - last;
        setHeartbeat(elapsed < 30000 ? "alive" : elapsed < 120000 ? "stale" : "dead");
      }
    }, 10000);
    return () => clearInterval(id);
  }, [connected, sessions]);

  const pulseColor =
    heartbeat === "alive"
      ? "var(--color-prio-low)"
      : heartbeat === "stale"
        ? "var(--color-prio-medium)"
        : "var(--color-prio-high)";

  return (
    <section className="glass rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Activity size={18} className="text-[var(--color-accent-2)]" />
        <h2 className="text-sm font-semibold tracking-wide uppercase text-white/70">
          Connection Status
        </h2>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/50">Desktop App</span>
          <span className="flex items-center gap-1.5">
            {connected ? (
              <Wifi size={14} className="text-[var(--color-prio-low)]" />
            ) : (
              <WifiOff size={14} className="text-[var(--color-prio-high)]" />
            )}
            <span style={{ color: connected ? "var(--color-prio-low)" : "var(--color-prio-high)" }}>
              {connected ? "Connected" : "Disconnected"}
            </span>
          </span>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-white/50">CLI Version</span>
          <span className="text-white/80">
            {cliVersion ?? <span className="text-white/30">Not detected</span>}
          </span>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-white/50">Heartbeat</span>
          <span className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: pulseColor }}
            />
            <span style={{ color: pulseColor }}>
              {heartbeat === "alive" ? "Active" : heartbeat === "stale" ? "Stale" : "No signal"}
            </span>
          </span>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-white/50">Active Sessions</span>
          <span className="flex items-center gap-1.5">
            <Cpu size={14} className="text-[var(--color-accent)]" />
            {sessions.length}
          </span>
        </div>
      </div>
    </section>
  );
}
