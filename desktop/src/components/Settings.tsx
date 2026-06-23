import { useRef } from "react";
import { Volume2, VolumeX, Play, Upload, RotateCcw, Pause, PlayCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useStore, isPaused, isMuted } from "../store/useStore";
import { PREF_KEYS } from "../lib/types";
import { CATEGORY_COLOR } from "../lib/ui";

const SOUND_ROWS: { category: string; label: string; prefKey: string }[] = [
  { category: "permission", label: "Permission", prefKey: PREF_KEYS.soundPermission },
  { category: "success", label: "Success", prefKey: PREF_KEYS.soundSuccess },
  { category: "error", label: "Error", prefKey: PREF_KEYS.soundError },
  { category: "authentication", label: "Authentication", prefKey: PREF_KEYS.soundAuthentication },
];

function SoundRow({ category, label, prefKey }: { category: string; label: string; prefKey: string }) {
  const prefs = useStore((s) => s.prefs);
  const setPref = useStore((s) => s.setPref);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasCustom = !!prefs[prefKey];

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setPref(prefKey, reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex items-center gap-3 py-2.5 border-t border-white/5">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: CATEGORY_COLOR[category] }} />
      <span className="text-sm flex-1">{label}</span>
      <span className="text-xs text-white/40">{hasCustom ? "custom" : "default"}</span>
      <button
        onClick={() => invoke("test_sound", { category })}
        className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/5"
        title="Test sound"
      >
        <Play size={15} />
      </button>
      <button
        onClick={() => inputRef.current?.click()}
        className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/5"
        title="Upload custom sound"
      >
        <Upload size={15} />
      </button>
      {hasCustom && (
        <button
          onClick={() => setPref(prefKey, "")}
          className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/5"
          title="Reset to default"
        >
          <RotateCcw size={15} />
        </button>
      )}
      <input ref={inputRef} type="file" accept="audio/*" onChange={onFile} className="hidden" />
    </div>
  );
}

export default function Settings() {
  const prefs = useStore((s) => s.prefs);
  const setPref = useStore((s) => s.setPref);
  const muted = isMuted(prefs);
  const paused = isPaused(prefs);

  return (
    <div className="flex flex-col gap-4">
      <section className="glass rounded-2xl p-5">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-white/70 mb-4">
          Monitoring
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPref(PREF_KEYS.monitoringPaused, paused ? "false" : "true")}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
            style={{
              background: paused ? "var(--color-prio-medium)" : "rgba(255,255,255,0.06)",
              color: paused ? "#1a1a22" : "#fff",
            }}
          >
            {paused ? <PlayCircle size={16} /> : <Pause size={16} />}
            {paused ? "Resume Monitoring" : "Pause Monitoring"}
          </button>
          <p className="text-sm text-white/50">
            {paused
              ? "Events are not being recorded or notified."
              : "Actively watching connected agents."}
          </p>
        </div>
      </section>

      <section className="glass rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-white/70">Sounds</h2>
          <button
            onClick={() => setPref(PREF_KEYS.muteSounds, muted ? "false" : "true")}
            className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{
              background: muted ? "rgba(255,93,115,0.18)" : "rgba(90,209,154,0.15)",
              color: muted ? "var(--color-prio-high)" : "var(--color-prio-low)",
            }}
          >
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            {muted ? "Muted" : "Sounds On"}
          </button>
        </div>
        <p className="text-xs text-white/40 mb-1">
          Choose custom sound files per alert type, or test the defaults.
        </p>
        {SOUND_ROWS.map((row) => (
          <SoundRow key={row.category} {...row} />
        ))}
      </section>
    </div>
  );
}
