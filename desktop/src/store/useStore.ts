import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { EventLog, Rule, SessionStatus, PREF_KEYS } from "../lib/types";

const MAX_EVENTS_IN_MEMORY = 500;
// A session is considered inactive once it goes idle or stops reporting.
const SESSION_STALE_MS = 1000 * 60 * 10;

interface StoreState {
  events: EventLog[];
  rules: Rule[];
  sessions: Record<string, SessionStatus>;
  prefs: Record<string, string>;
  connected: boolean;

  loadInitial: () => Promise<void>;
  addEvent: (e: EventLog) => void;
  upsertSession: (s: SessionStatus) => void;
  pruneSessions: () => void;
  reloadRules: () => Promise<void>;
  toggleRule: (id: string, enabled: boolean) => Promise<void>;
  saveRule: (rule: Rule) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
  clearEvents: () => Promise<void>;
  setPref: (key: string, value: string) => Promise<void>;
  setConnected: (v: boolean) => void;
}

function sessionKey(s: SessionStatus): string {
  return `${s.agent}-${s.pid}`;
}

export const useStore = create<StoreState>((set, get) => ({
  events: [],
  rules: [],
  sessions: {},
  prefs: {},
  connected: false,

  loadInitial: async () => {
    const [events, rules, prefs] = await Promise.all([
      invoke<EventLog[]>("get_events").catch(() => [] as EventLog[]),
      invoke<Rule[]>("get_rules").catch(() => [] as Rule[]),
      invoke<Record<string, string>>("get_prefs").catch(() => ({})),
    ]);
    set({ events, rules, prefs });
  },

  addEvent: (e) =>
    set((state) => ({
      events: [e, ...state.events].slice(0, MAX_EVENTS_IN_MEMORY),
    })),

  upsertSession: (s) =>
    set((state) => ({
      sessions: { ...state.sessions, [sessionKey(s)]: s },
    })),

  pruneSessions: () =>
    set((state) => {
      const now = Date.now();
      const next: Record<string, SessionStatus> = {};
      for (const [k, s] of Object.entries(state.sessions)) {
        const last = new Date(s.last_activity).getTime();
        const stale = isNaN(last) ? false : now - last > SESSION_STALE_MS;
        if (s.status !== "idle" && !stale) next[k] = s;
      }
      return { sessions: next };
    }),

  reloadRules: async () => {
    const rules = await invoke<Rule[]>("get_rules").catch(() => get().rules);
    set({ rules });
  },

  toggleRule: async (id, enabled) => {
    await invoke("toggle_rule", { id, enabled });
    set((state) => ({
      rules: state.rules.map((r) => (r.id === id ? { ...r, enabled } : r)),
    }));
  },

  saveRule: async (rule) => {
    await invoke("save_rule", { rule });
    set((state) => {
      const exists = state.rules.some((r) => r.id === rule.id);
      return {
        rules: exists
          ? state.rules.map((r) => (r.id === rule.id ? rule : r))
          : [...state.rules, rule],
      };
    });
  },

  deleteRule: async (id) => {
    await invoke("delete_rule", { id });
    set((state) => ({ rules: state.rules.filter((r) => r.id !== id) }));
  },

  clearEvents: async () => {
    await invoke("clear_events");
    set({ events: [] });
  },

  setPref: async (key, value) => {
    await invoke("save_pref", { key, value });
    set((state) => ({ prefs: { ...state.prefs, [key]: value } }));
  },

  setConnected: (v) => set({ connected: v }),
}));

export const isPaused = (prefs: Record<string, string>) =>
  prefs[PREF_KEYS.monitoringPaused] === "true";
export const isMuted = (prefs: Record<string, string>) =>
  prefs[PREF_KEYS.muteSounds] === "true";
