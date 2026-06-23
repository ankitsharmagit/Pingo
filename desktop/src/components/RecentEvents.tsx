import { Bell, Trash2 } from "lucide-react";
import { useStore } from "../store/useStore";
import { CATEGORY_COLOR, CATEGORY_TINT, formatTime } from "../lib/ui";
import { CATEGORY_LABELS } from "../lib/types";

export default function RecentEvents() {
  const events = useStore((s) => s.events);
  const clearEvents = useStore((s) => s.clearEvents);

  return (
    <section className="glass rounded-2xl p-5 flex flex-col min-h-0 h-full">
      <div className="flex items-center gap-2 mb-4">
        <Bell size={18} className="text-[var(--color-accent)]" />
        <h2 className="text-sm font-semibold tracking-wide uppercase text-white/70">
          Recent Events
        </h2>
        <span className="ml-auto text-xs text-white/40">{events.length}</span>
        {events.length > 0 && (
          <button
            onClick={() => clearEvents()}
            className="ml-2 text-white/40 hover:text-[var(--color-prio-high)] transition-colors"
            title="Clear event history"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>

      {events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-white/40">
          <Bell size={28} className="mb-2 opacity-50" />
          <p className="text-sm">No events yet.</p>
        </div>
      ) : (
        <div className="overflow-y-auto -mr-2 pr-2 flex flex-col gap-1.5">
          {events.map((e) => (
            <div
              key={e.id}
              className="flex items-start gap-3 rounded-xl px-3 py-2.5 border border-white/5 hover:border-white/10 transition-colors"
              style={{ background: CATEGORY_TINT[e.event_type] ?? "rgba(255,255,255,0.03)" }}
            >
              <span
                className="mt-1 w-2 h-2 rounded-full shrink-0"
                style={{ background: CATEGORY_COLOR[e.event_type] ?? "#888" }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className="text-xs font-semibold"
                    style={{ color: CATEGORY_COLOR[e.event_type] ?? "#ccc" }}
                  >
                    {CATEGORY_LABELS[e.event_type] ?? e.event_type}
                  </span>
                  <span className="text-xs text-white/50">· {e.agent}</span>
                </div>
                <p className="text-sm text-white/80 truncate" title={e.message}>
                  {e.message}
                </p>
              </div>
              <span className="text-xs text-white/35 shrink-0 font-mono">
                {formatTime(e.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
