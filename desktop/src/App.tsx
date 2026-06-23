import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Bell, LayoutDashboard, SlidersHorizontal, Settings as SettingsIcon } from "lucide-react";
import { useStore, isPaused } from "./store/useStore";
import { EventLog, SessionStatus } from "./lib/types";
import { ensureNotificationPermission, notify } from "./lib/notify";
import ActiveSessions from "./components/ActiveSessions";
import RecentEvents from "./components/RecentEvents";
import RulesManager from "./components/RulesManager";
import Settings from "./components/Settings";

type Tab = "dashboard" | "rules" | "settings";

const NAV: { id: Tab; label: string; icon: typeof Bell }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "rules", label: "Rules", icon: SlidersHorizontal },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [, setTick] = useState(0);

  const loadInitial = useStore((s) => s.loadInitial);
  const addEvent = useStore((s) => s.addEvent);
  const upsertSession = useStore((s) => s.upsertSession);
  const pruneSessions = useStore((s) => s.pruneSessions);
  const prefs = useStore((s) => s.prefs);
  const setPref = useStore((s) => s.setPref);
  const events = useStore((s) => s.events);
  // Select the raw map (stable reference) and derive the array in render.
  // Returning Object.values(...) directly from the selector creates a new
  // array every call, which breaks zustand v5 / useSyncExternalStore snapshot
  // caching and causes an infinite render loop.
  const sessionMap = useStore((s) => s.sessions);
  const sessions = Object.values(sessionMap);

  const paused = isPaused(prefs);

  // Load persisted data + request OS notification permission once.
  useEffect(() => {
    loadInitial();
    ensureNotificationPermission();
  }, [loadInitial]);

  // Subscribe to backend events. The store is read lazily inside the handler
  // via getState() so the listener doesn't need to re-register on pref changes.
  useEffect(() => {
    const unlisten: Array<Promise<() => void>> = [];

    unlisten.push(
      listen<EventLog>("event-detected", (e) => {
        addEvent(e.payload);
        // The native backend plays the alert sound; here we only raise the
        // OS notification.
        notify(e.payload);
      })
    );

    unlisten.push(
      listen<SessionStatus>("session-status", (e) => {
        upsertSession(e.payload);
      })
    );

    unlisten.push(
      listen<boolean>("monitoring-status-changed", (e) => {
        // Reflect tray-driven pause/resume in the UI without re-persisting.
        useStore.setState((s) => ({
          prefs: { ...s.prefs, monitoring_paused: e.payload ? "true" : "false" },
        }));
      })
    );

    return () => {
      unlisten.forEach((p) => p.then((fn) => fn()).catch(() => {}));
    };
  }, [addEvent, upsertSession]);

  // Keep relative timestamps fresh and prune idle sessions.
  useEffect(() => {
    const id = setInterval(() => {
      pruneSessions();
      setTick((t) => t + 1);
    }, 15000);
    return () => clearInterval(id);
  }, [pruneSessions]);

  const attention = sessions.some((s) => s.status === "waiting" || s.status === "error");

  return (
    <div className="h-full flex text-white">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 flex flex-col gap-2 p-4 border-r border-white/5">
        <div className="flex items-center gap-2.5 px-2 py-3 mb-2">
          <div className="relative">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-2)] flex items-center justify-center">
              <Bell size={18} className="text-white" />
            </div>
            {attention && (
              <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-[var(--color-prio-high)] border-2 border-[#0a0a0f] live-dot" />
            )}
          </div>
          <div>
            <h1 className="font-semibold leading-tight">Pingo</h1>
            <p className="text-[10px] text-white/40 leading-tight">agent monitor</p>
          </div>
        </div>

        {NAV.map((n) => {
          const Icon = n.icon;
          const active = tab === n.id;
          return (
            <button
              key={n.id}
              onClick={() => setTab(n.id)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors text-left"
              style={{
                background: active ? "var(--color-bg-panel-strong)" : "transparent",
                color: active ? "#fff" : "rgba(255,255,255,0.6)",
              }}
            >
              <Icon size={17} />
              {n.label}
            </button>
          );
        })}

        <div className="mt-auto px-3 py-2 rounded-xl glass">
          <div className="flex items-center gap-2 text-xs">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: paused ? "var(--color-prio-medium)" : "var(--color-prio-low)" }}
            />
            <span className="text-white/60">{paused ? "Paused" : "Monitoring"}</span>
          </div>
          <p className="text-[10px] text-white/30 mt-1">
            {events.length} events · {sessions.length} sessions
          </p>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center px-6 py-4 border-b border-white/5">
          <h2 className="text-lg font-semibold capitalize">{tab}</h2>
          {paused && (
            <button
              onClick={() => setPref("monitoring_paused", "false")}
              className="ml-auto text-xs px-3 py-1.5 rounded-lg bg-[var(--color-prio-medium)] text-[#1a1a22] font-medium"
            >
              Monitoring paused — Resume
            </button>
          )}
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          {tab === "dashboard" && (
            <div className="flex flex-col gap-4 h-full">
              <ActiveSessions />
              <div className="flex-1 min-h-0">
                <RecentEvents />
              </div>
            </div>
          )}
          {tab === "rules" && <RulesManager />}
          {tab === "settings" && <Settings />}
        </div>
      </main>
    </div>
  );
}

export default App;
