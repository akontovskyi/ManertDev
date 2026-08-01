"use client";

import { useMemo, useState, useTransition, type CSSProperties } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "sentinel";
  content: string;
};

type Finding = {
  id: string;
  severity: string;
  title: string;
  description: string;
  evidence: { file: string; line?: number; snippet: string };
  remediation: string;
};

export default function DashboardPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "sentinel",
      content:
        "SentinelDev console ready. Ask about endpoints, env/keys, admin/debug entrances, database exposure, scramble/rotate, or upload an IAM PDF. I only propose fixes — I never auto-modify code.",
    },
  ]);
  const [input, setInput] = useState("");
  const [root, setRoot] = useState(".");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [pending, startTransition] = useTransition();

  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
    return counts;
  }, [findings]);

  function send() {
    const q = input.trim();
    if (!q || pending) return;
    setInput("");
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", content: q }]);

    startTransition(async () => {
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, root }),
        });
        const data = await res.json();
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "sentinel",
            content: data.markdown || data.error || "No response.",
          },
        ]);
        if (Array.isArray(data.findings)) setFindings(data.findings);
      } catch (err) {
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "sentinel",
            content: `Scan failed: ${err instanceof Error ? err.message : "unknown error"}`,
          },
        ]);
      }
    });
  }

  async function onPdf(file: File | null) {
    if (!file) return;
    const question =
      input.trim() || "Is this overly permissive? Who can access this resource?";
    setMessages((m) => [
      ...m,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: `PDF: ${file.name} — ${question}`,
      },
    ]);

    const form = new FormData();
    form.append("file", file);
    form.append("question", question);

    startTransition(async () => {
      const res = await fetch("/api/pdf", { method: "POST", body: form });
      const data = await res.json();
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "sentinel",
          content: data.markdown || data.error || "PDF analysis failed.",
        },
      ]);
      if (Array.isArray(data.findings)) setFindings(data.findings);
    });
  }

  return (
    <div className="sd-shell" style={styles.shell}>
      <aside style={styles.side}>
        <p style={styles.sideBrand}>SentinelDev</p>
        <p style={styles.sideMeta}>Dashboard mode · propose-only</p>

        <label style={styles.label}>
          Scan root
          <input
            style={styles.input}
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            placeholder="."
          />
        </label>

        <label style={styles.label}>
          IAM / policy PDF
          <input
            style={styles.file}
            type="file"
            accept="application/pdf,text/plain,.json"
            onChange={(e) => onPdf(e.target.files?.[0] ?? null)}
          />
        </label>

        <div style={styles.counts}>
          {Object.entries(severityCounts).map(([k, v]) => (
            <div key={k} style={styles.countRow}>
              <span style={{ ...styles.badge, ...badgeColor(k) }}>{k}</span>
              <span>{v}</span>
            </div>
          ))}
          {findings.length === 0 && (
            <p style={styles.muted}>Findings appear after a scan.</p>
          )}
        </div>

        <a href="/" style={styles.homeLink}>
          ← Home
        </a>
      </aside>

      <section style={styles.main}>
        <header style={styles.top}>
          <h1 style={styles.h1}>Security console</h1>
          <p style={styles.sub}>
            Keyword routing: endpoints · env/keys · admin/debug · database ·
            scramble · IAM · fix/patch
          </p>
        </header>

        <div style={styles.chat}>
          {messages.map((m) => (
            <article
              key={m.id}
              style={{
                ...styles.bubble,
                ...(m.role === "user" ? styles.userBubble : styles.botBubble),
              }}
            >
              <header style={styles.bubbleHead}>
                {m.role === "user" ? "You" : "SentinelDev"}
              </header>
              <pre style={styles.pre}>{m.content}</pre>
            </article>
          ))}
        </div>

        {findings.length > 0 && (
          <div style={styles.findings}>
            <h2 style={styles.h2}>Latest findings</h2>
            {findings.slice(0, 12).map((f) => (
              <div key={f.id} style={styles.finding}>
                <div style={styles.findingHead}>
                  <span style={{ ...styles.badge, ...badgeColor(f.severity) }}>
                    {f.severity}
                  </span>
                  <strong>{f.title}</strong>
                </div>
                <p style={styles.muted}>{f.description}</p>
                <code style={styles.code}>
                  {f.evidence.file}
                  {f.evidence.line ? `:${f.evidence.line}` : ""}
                </code>
              </div>
            ))}
          </div>
        )}

        <form
          style={styles.composer}
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            style={styles.composerInput}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='e.g. "scan exposed endpoints" or "apply fix for secrets"'
            disabled={pending}
          />
          <button style={styles.send} type="submit" disabled={pending}>
            {pending ? "Scanning…" : "Ask"}
          </button>
        </form>
      </section>
    </div>
  );
}

function badgeColor(severity: string): CSSProperties {
  switch (severity) {
    case "Critical":
      return { background: "#a32020", color: "#fff" };
    case "High":
      return { background: "#c45c26", color: "#fff" };
    case "Medium":
      return { background: "#b8860b", color: "#111" };
    case "Low":
      return { background: "#3d6b8c", color: "#fff" };
    default:
      return { background: "#5a6b76", color: "#fff" };
  }
}

const styles: Record<string, CSSProperties> = {
  shell: {
    minHeight: "100vh",
  },
  side: {
    padding: "1.25rem",
    borderRight: "1px solid var(--line)",
    background: "rgba(244,247,249,0.8)",
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
  },
  sideBrand: {
    margin: 0,
    fontFamily: "var(--font-display)",
    fontSize: "1.35rem",
    fontWeight: 700,
  },
  sideMeta: { margin: 0, color: "var(--ink-soft)", fontSize: "0.85rem" },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
    fontSize: "0.85rem",
    fontWeight: 600,
  },
  input: {
    padding: "0.55rem 0.65rem",
    border: "1px solid var(--line)",
    background: "#fff",
    borderRadius: 2,
  },
  file: { fontSize: "0.8rem" },
  counts: { display: "flex", flexDirection: "column", gap: "0.4rem" },
  countRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  badge: {
    fontSize: "0.7rem",
    fontWeight: 600,
    padding: "0.15rem 0.45rem",
    borderRadius: 2,
    fontFamily: "var(--font-mono)",
  },
  muted: { color: "var(--ink-soft)", fontSize: "0.85rem", margin: "0.25rem 0" },
  homeLink: { marginTop: "auto", color: "var(--ink)", fontWeight: 500 },
  main: {
    display: "flex",
    flexDirection: "column",
    minHeight: "100vh",
    maxHeight: "100vh",
  },
  top: {
    padding: "1.25rem 1.5rem 0.75rem",
    borderBottom: "1px solid var(--line)",
  },
  h1: {
    margin: 0,
    fontFamily: "var(--font-display)",
    fontSize: "1.75rem",
  },
  h2: {
    margin: "0 0 0.75rem",
    fontFamily: "var(--font-display)",
    fontSize: "1.15rem",
  },
  sub: { margin: "0.35rem 0 0", color: "var(--ink-soft)", fontSize: "0.9rem" },
  chat: {
    flex: 1,
    overflow: "auto",
    padding: "1rem 1.5rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.85rem",
  },
  bubble: {
    border: "1px solid var(--line)",
    padding: "0.75rem 0.9rem",
    background: "rgba(255,255,255,0.7)",
    maxWidth: "920px",
  },
  userBubble: { alignSelf: "flex-end", background: "rgba(12,26,36,0.06)" },
  botBubble: { alignSelf: "flex-start" },
  bubbleHead: {
    fontFamily: "var(--font-mono)",
    fontSize: "0.7rem",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--ink-soft)",
    marginBottom: "0.35rem",
  },
  pre: {
    margin: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: "var(--font-body)",
    fontSize: "0.92rem",
    lineHeight: 1.45,
  },
  findings: {
    borderTop: "1px solid var(--line)",
    padding: "0.85rem 1.5rem",
    maxHeight: 220,
    overflow: "auto",
    background: "rgba(244,247,249,0.9)",
  },
  finding: {
    padding: "0.55rem 0",
    borderBottom: "1px dashed var(--line)",
  },
  findingHead: {
    display: "flex",
    gap: "0.5rem",
    alignItems: "center",
    flexWrap: "wrap",
  },
  code: {
    fontFamily: "var(--font-mono)",
    fontSize: "0.78rem",
    color: "var(--ink-soft)",
  },
  composer: {
    display: "flex",
    gap: "0.5rem",
    padding: "0.85rem 1.5rem 1.25rem",
    borderTop: "1px solid var(--line)",
    background: "rgba(244,247,249,0.95)",
  },
  composerInput: {
    flex: 1,
    padding: "0.75rem 0.85rem",
    border: "1px solid var(--line)",
    borderRadius: 2,
    background: "#fff",
  },
  send: {
    padding: "0.75rem 1.1rem",
    background: "var(--ink)",
    color: "#f4f7f9",
    border: "none",
    borderRadius: 2,
    fontWeight: 600,
    cursor: "pointer",
  },
};
