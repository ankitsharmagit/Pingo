import { useState } from "react";
import { Plus, Pencil, Trash2, X, Check } from "lucide-react";
import { useStore } from "../store/useStore";
import { Rule, KNOWN_AGENTS } from "../lib/types";
import { PRIORITY_COLOR } from "../lib/ui";

const CATEGORIES = ["permission", "success", "error", "authentication", "ratelimit", "input"];
const PRIORITIES = ["high", "medium", "low"];

const AGENT_BADGE_COLORS: Record<string, string> = {
  claude: "#7c6cff",
  opencode: "#5ad19a",
  codex: "#ffb347",
  gemini: "#4fc3f7",
  aider: "#ff5d73",
  cursor: "#ff8fab",
};

function emptyRule(): Rule {
  return {
    id: crypto.randomUUID(),
    name: "",
    category: "permission",
    priority: "high",
    enabled: true,
    patterns: [],
  };
}

function RuleEditor({
  rule,
  onClose,
}: {
  rule: Rule;
  onClose: () => void;
}) {
  const saveRule = useStore((s) => s.saveRule);
  const [draft, setDraft] = useState<Rule>({ ...rule, patterns: [...rule.patterns] });
  const [patternsText, setPatternsText] = useState(rule.patterns.join("\n"));
  const [negativeText, setNegativeText] = useState((rule.negative_patterns ?? []).join("\n"));

  const save = async () => {
    const patterns = patternsText
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    const negative_patterns = negativeText
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    if (!draft.name.trim() || patterns.length === 0) return;
    await saveRule({ ...draft, patterns, negative_patterns: negative_patterns.length > 0 ? negative_patterns : undefined });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="glass rounded-2xl w-full max-w-lg p-6 flash-in">
        <div className="flex items-center mb-4">
          <h3 className="text-base font-semibold">
            {rule.name ? "Edit Rule" : "New Rule"}
          </h3>
          <button onClick={onClose} className="ml-auto text-white/50 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <label className="block text-xs text-white/50 mb-1">Name</label>
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Rule name"
          className="w-full mb-4 px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-[var(--color-accent)] outline-none text-sm"
        />

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs text-white/50 mb-1">Category</label>
            <select
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 outline-none text-sm capitalize"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c} className="bg-[#1a1a22]">
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-white/50 mb-1">Priority</label>
            <select
              value={draft.priority}
              onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 outline-none text-sm capitalize"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p} className="bg-[#1a1a22]">
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-white/50 mb-1">Apply to agents (empty = all agents)</label>
          <div className="flex flex-wrap gap-1.5">
            {KNOWN_AGENTS.map((agent) => {
              const selected = draft.agents?.includes(agent) ?? false;
              return (
                <button
                  key={agent}
                  onClick={() => {
                    const current = draft.agents ?? [];
                    setDraft({
                      ...draft,
                      agents: selected
                        ? current.filter((a) => a !== agent)
                        : [...current, agent],
                    });
                  }}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium capitalize transition-colors"
                  style={{
                    background: selected ? `${AGENT_BADGE_COLORS[agent] ?? "#888"}33` : "rgba(255,255,255,0.06)",
                    color: selected ? AGENT_BADGE_COLORS[agent] ?? "#fff" : "rgba(255,255,255,0.5)",
                    border: selected
                      ? `1px solid ${AGENT_BADGE_COLORS[agent] ?? "#888"}44`
                      : "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  {agent}
                </button>
              );
            })}
          </div>
        </div>

        <label className="block text-xs text-white/50 mb-1">
          Match patterns (one per line, case-insensitive)
        </label>
        <textarea
          value={patternsText}
          onChange={(e) => setPatternsText(e.target.value)}
          rows={5}
          placeholder={"waiting for approval\npress enter to continue"}
          className="w-full mb-3 px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-[var(--color-accent)] outline-none text-sm font-mono resize-none"
        />

        <label className="block text-xs text-white/50 mb-1">
          Negative patterns (if any match, rule is skipped)
        </label>
        <textarea
          value={negativeText}
          onChange={(e) => setNegativeText(e.target.value)}
          rows={3}
          placeholder={"already approved\nnot completed"}
          className="w-full mb-4 px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-[var(--color-accent)] outline-none text-sm font-mono resize-none"
        />

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-white/70 hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--color-accent)] hover:opacity-90 flex items-center gap-1.5"
          >
            <Check size={15} /> Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RulesManager() {
  const rules = useStore((s) => s.rules);
  const toggleRule = useStore((s) => s.toggleRule);
  const deleteRule = useStore((s) => s.deleteRule);
  const [editing, setEditing] = useState<Rule | null>(null);

  return (
    <section className="glass rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-white/70">
          Detection Rules
        </h2>
        <button
          onClick={() => setEditing(emptyRule())}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-accent)] hover:opacity-90"
        >
          <Plus size={14} /> New Rule
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {rules.map((r) => (
          <div
            key={r.id}
            className="flex items-center gap-3 rounded-xl px-4 py-3 border border-white/5 bg-white/[0.02]"
          >
            <button
              onClick={() => toggleRule(r.id, !r.enabled)}
              className="relative w-9 h-5 rounded-full transition-colors shrink-0"
              style={{ background: r.enabled ? "var(--color-accent)" : "rgba(255,255,255,0.12)" }}
              title={r.enabled ? "Enabled" : "Disabled"}
            >
              <span
                className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
                style={{ left: r.enabled ? "18px" : "2px" }}
              />
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-medium ${r.enabled ? "" : "text-white/40"}`}>
                  {r.name}
                </span>
                <span
                  className="text-[10px] uppercase px-1.5 py-0.5 rounded font-semibold"
                  style={{
                    color: PRIORITY_COLOR[r.priority] ?? "#aaa",
                    background: `${PRIORITY_COLOR[r.priority] ?? "#888"}22`,
                  }}
                >
                  {r.priority}
                </span>
                <span className="text-[10px] uppercase text-white/40">{r.category}</span>
                {(r.agents?.length ?? 0) > 0 && (
                  <span className="text-[10px] text-white/30">· {r.agents!.join(", ")}</span>
                )}
              </div>
              <p className="text-xs text-white/40 truncate mt-0.5">
                {r.patterns.length} pattern{r.patterns.length === 1 ? "" : "s"}: {r.patterns.join(", ")}
              </p>
            </div>

            <button
              onClick={() => setEditing(r)}
              className="text-white/40 hover:text-white p-1"
              title="Edit"
            >
              <Pencil size={15} />
            </button>
            <button
              onClick={() => deleteRule(r.id)}
              className="text-white/40 hover:text-[var(--color-prio-high)] p-1"
              title="Delete"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>

      {editing && <RuleEditor rule={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}
