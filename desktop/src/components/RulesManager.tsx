import { useState } from "react";
import { Plus, Pencil, Trash2, X, Check } from "lucide-react";
import { useStore } from "../store/useStore";
import { Rule } from "../lib/types";
import { PRIORITY_COLOR } from "../lib/ui";

const CATEGORIES = ["permission", "success", "error", "authentication", "ratelimit", "input"];
const PRIORITIES = ["high", "medium", "low"];

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

  const save = async () => {
    const patterns = patternsText
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    if (!draft.name.trim() || patterns.length === 0) return;
    await saveRule({ ...draft, patterns });
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

        <label className="block text-xs text-white/50 mb-1">
          Patterns (one per line, case-insensitive substring match)
        </label>
        <textarea
          value={patternsText}
          onChange={(e) => setPatternsText(e.target.value)}
          rows={6}
          placeholder={"waiting for approval\npress enter to continue"}
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
