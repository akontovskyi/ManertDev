"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
} from "react";
import { buildFixPrompt } from "@/lib/fix-prompt";

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
  evidence: { file: string; line?: number; endLine?: number; snippet: string };
  remediation: string;
  proposedPatch?: string;
  problemType?: string;
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function DashboardPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "sentinel",
      content:
        "SentinelDev console ready. Ask anything — security keywords trigger a local scan + live model; general chat goes straight to the model. I only propose fixes — I never auto-modify code.",
    },
  ]);
  const [input, setInput] = useState("");
  const [root, setRoot] = useState(".");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [pending, startTransition] = useTransition();
  const [scrambleConfirmOpen, setScrambleConfirmOpen] = useState(false);
  const [pdfName, setPdfName] = useState("");
  const [pdfLink, setPdfLink] = useState("");
  const [pdfDragOver, setPdfDragOver] = useState(false);
  const [openSeverities, setOpenSeverities] = useState<Record<string, boolean>>(
    {},
  );
  const [copiedFindingId, setCopiedFindingId] = useState<string | null>(null);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  // `sentinel dashboard` opens /dashboard?root=<absolute cwd>
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromQuery = params.get("root");
      if (fromQuery && fromQuery.trim()) {
        setRoot(fromQuery.trim());
      }
    } catch {
      // ignore
    }
  }, []);

  const findingsBySeverity = useMemo(() => {
    const order = ["Critical", "High", "Medium", "Low", "Info"];
    const groups: Record<string, Finding[]> = {};
    for (const f of findings) {
      (groups[f.severity] ||= []).push(f);
    }
    return Object.entries(groups).sort(([a], [b]) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [findings]);

  function toggleSeverity(severity: string) {
    setOpenSeverities((prev) => ({ ...prev, [severity]: !prev[severity] }));
  }

  async function copyFixPrompt(finding: Finding) {
    const ok = await copyText(buildFixPrompt(finding));
    if (!ok) return;
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
    setCopiedFindingId(finding.id);
    copyResetRef.current = setTimeout(() => {
      setCopiedFindingId(null);
      copyResetRef.current = null;
    }, 2000);
  }

  function send(preset?: string) {
    const q = (preset ?? input).trim();
    if (!q || pending) return;
    if (!preset) setInput("");

    const history = messages
      .filter((m) => m.id !== "welcome")
      .slice(-12)
      .map((m) => ({
        role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      }));

    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", content: q }]);

    startTransition(async () => {
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, root, history }),
        });
        const data = await res.json();
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "sentinel",
            content: data.reply || data.markdown || data.error || "No response.",
          },
        ]);
        if (Array.isArray(data.findings)) {
          setFindings(data.findings);
          const nextOpen: Record<string, boolean> = {};
          for (const f of data.findings as Finding[]) {
            nextOpen[f.severity] = true;
          }
          setOpenSeverities(nextOpen);
        }
      } catch (err) {
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "sentinel",
            content: `Chat failed: ${err instanceof Error ? err.message : "unknown error"}`,
          },
        ]);
      }
    });
  }

  function confirmScramble() {
    setScrambleConfirmOpen(false);
    send("scramble keys");
  }

  function analyzePdfFile(file: File) {
    setPdfName(file.name);
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
          content: data.reply || data.markdown || data.error || "PDF analysis failed.",
        },
      ]);
      if (Array.isArray(data.findings)) {
        setFindings(data.findings);
        const nextOpen: Record<string, boolean> = {};
        for (const f of data.findings as Finding[]) {
          nextOpen[f.severity] = true;
        }
        setOpenSeverities(nextOpen);
      }
    });
  }

  function onPdf(file: File | null) {
    if (!file) return;
    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setPdfName("");
      if (pdfInputRef.current) pdfInputRef.current.value = "";
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "sentinel",
          content: "Only .pdf files are accepted for IAM / policy upload.",
        },
      ]);
      return;
    }
    analyzePdfFile(file);
  }

  function onPdfLink() {
    const url = pdfLink.trim();
    if (!url || pending) return;

    startTransition(async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
        const blob = await res.blob();
        const nameGuess =
          url.split("/").pop()?.split("?")[0] || "policy.pdf";
        const fileName = nameGuess.toLowerCase().endsWith(".pdf")
          ? nameGuess
          : `${nameGuess}.pdf`;
        if (
          blob.type &&
          blob.type !== "application/pdf" &&
          !fileName.toLowerCase().endsWith(".pdf")
        ) {
          throw new Error("Link did not return a PDF");
        }
        const file = new File([blob], fileName, { type: "application/pdf" });
        setPdfLink("");
        setPdfName(file.name);
        const question =
          input.trim() ||
          "Is this overly permissive? Who can access this resource?";
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
        const analyze = await fetch("/api/pdf", { method: "POST", body: form });
        const data = await analyze.json();
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "sentinel",
            content: data.reply || data.markdown || data.error || "PDF analysis failed.",
          },
        ]);
        if (Array.isArray(data.findings)) {
          setFindings(data.findings);
          const nextOpen: Record<string, boolean> = {};
          for (const f of data.findings as Finding[]) {
            nextOpen[f.severity] = true;
          }
          setOpenSeverities(nextOpen);
        }
      } catch (err) {
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "sentinel",
            content: `Could not load PDF from link: ${
              err instanceof Error ? err.message : "unknown error"
            }. Try uploading the file instead.`,
          },
        ]);
      }
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
            placeholder="Absolute path (from sentinel dashboard)"
          />
        </label>

        <div style={styles.pdfPanel}>
          <p style={styles.pdfPanelTitle}>Analyze IAM / policy PDF</p>
          <div
            className={pdfDragOver ? "sd-pdf-drop sd-pdf-drop--active" : "sd-pdf-drop"}
            style={{
              ...styles.pdfDrop,
              ...(pdfDragOver ? styles.pdfDropActive : {}),
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              setPdfDragOver(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setPdfDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setPdfDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setPdfDragOver(false);
              onPdf(e.dataTransfer.files?.[0] ?? null);
            }}
          >
            <span style={styles.pdfIcon} aria-hidden>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <rect x="4" y="3" width="16" height="18" rx="2" stroke="#0f7a6c" strokeWidth="1.6" />
                <path d="M8 8h8M8 12h8M8 16h5" stroke="#0f7a6c" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </span>
            <p style={styles.pdfDropText}>
              Drag a PDF here or{" "}
              <button
                type="button"
                style={styles.pdfUploadLink}
                disabled={pending}
                onClick={() => pdfInputRef.current?.click()}
              >
                upload a file
              </button>
            </p>
            {pdfName ? (
              <p style={styles.pdfSelectedName}>{pdfName}</p>
            ) : null}
            <input
              ref={pdfInputRef}
              style={styles.fileHidden}
              type="file"
              accept=".pdf,application/pdf"
              onChange={(e) => onPdf(e.target.files?.[0] ?? null)}
            />
          </div>

          <div style={styles.pdfOrRow}>
            <span style={styles.pdfOrLine} />
            <span style={styles.pdfOrLabel}>OR</span>
            <span style={styles.pdfOrLine} />
          </div>

          <form
            style={styles.pdfLinkRow}
            onSubmit={(e) => {
              e.preventDefault();
              onPdfLink();
            }}
          >
            <input
              style={styles.pdfLinkInput}
              value={pdfLink}
              onChange={(e) => setPdfLink(e.target.value)}
              placeholder="Paste PDF link"
              disabled={pending}
            />
            <button
              type="submit"
              style={styles.pdfSearchBtn}
              disabled={pending || !pdfLink.trim()}
            >
              Search
            </button>
          </form>
        </div>

        <div style={styles.counts}>
          {findingsBySeverity.map(([severity, items]) => {
            const open = !!openSeverities[severity];
            return (
              <div key={severity} style={styles.severityGroup}>
                <button
                  type="button"
                  style={styles.severityToggle}
                  aria-expanded={open}
                  onClick={() => toggleSeverity(severity)}
                >
                  <span style={styles.severityToggleLeft}>
                    <span style={styles.severityCaret} aria-hidden>
                      {open ? "▾" : "▸"}
                    </span>
                    <span style={{ ...styles.badge, ...badgeColor(severity) }}>
                      {severity}
                    </span>
                  </span>
                  <span style={styles.severityCount}>{items.length}</span>
                </button>
                {open && (
                  <div style={styles.severityDropdown}>
                    {items.map((f) => (
                      <div key={f.id} style={styles.sideFinding}>
                        <strong style={styles.sideFindingTitle}>{f.title}</strong>
                        <p style={styles.sideFindingDesc}>{f.description}</p>
                        <code style={styles.code}>
                          {f.evidence.file}
                          {f.evidence.line ? `:${f.evidence.line}` : ""}
                        </code>
                        {f.remediation ? (
                          <p style={styles.sideFindingFix}>
                            Fix: {f.remediation}
                          </p>
                        ) : null}
                        <button
                          type="button"
                          style={styles.copyPromptBtn}
                          onClick={() => copyFixPrompt(f)}
                        >
                          {copiedFindingId === f.id
                            ? "Copied!"
                            : "Copy fix prompt"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {findings.length === 0 && (
            <p style={styles.muted}>Findings appear after a scan.</p>
          )}
        </div>

        <a href="/" style={styles.homeLink}>
          ← Home
        </a>
      </aside>

      <section style={styles.main}>
        <div style={styles.actions}>
          <button
            type="button"
            className="sd-action-btn"
            style={styles.actionBtn}
            disabled={pending}
            onClick={() => send("exposed endpoints")}
          >
            Exposed Endpoints
          </button>
          <button
            type="button"
            className="sd-action-btn"
            style={styles.actionBtn}
            disabled={pending}
            onClick={() => send("api exposure")}
          >
            API exposure
          </button>
          <button
            type="button"
            className="sd-action-btn"
            style={styles.actionBtn}
            disabled={pending}
            onClick={() => {
              setMessages((m) => [
                ...m,
                {
                  id: crypto.randomUUID(),
                  role: "user",
                  content: "Query Limiting",
                },
                {
                  id: crypto.randomUUID(),
                  role: "sentinel",
                  content:
                    "No dedicated Query Limiting function exists in SentinelDev yet. Endpoint scans may still suggest rate-limiting public GETs in remediations.",
                },
              ]);
            }}
          >
            Query Limiting
          </button>
          <button
            type="button"
            className="sd-scramble-btn"
            style={styles.scrambleBtn}
            disabled={pending}
            onClick={() => setScrambleConfirmOpen(true)}
          >
            Key scramble
          </button>
        </div>

        <header style={styles.top}>
          <h1 style={styles.h1}>Security console</h1>
          <p style={styles.sub}>
            Live model chat · keyword scans: endpoints · env/keys · admin/debug ·
            database · scramble · IAM · fix/patch
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
            {pending ? "Thinking…" : "Ask"}
          </button>
        </form>
      </section>

      {scrambleConfirmOpen && (
        <div
          style={styles.modalBackdrop}
          role="presentation"
          onClick={() => setScrambleConfirmOpen(false)}
        >
          <div
            style={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="scramble-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="scramble-confirm-title" style={styles.modalTitle}>
              Confirm key scramble
            </h2>
            <p style={styles.modalBody}>
              There is no going back. Key scramble suggestions will be generated
              for secret-like names in this scan root.
            </p>
            <div style={styles.modalActions}>
              <button
                type="button"
                style={styles.modalCancel}
                onClick={() => setScrambleConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                style={styles.modalDanger}
                onClick={confirmScramble}
                disabled={pending}
              >
                Scramble anyway
              </button>
            </div>
          </div>
        </div>
      )}
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
    minHeight: "100vh",
    maxHeight: "100vh",
    overflow: "hidden",
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
    borderRadius: 8,
  },
  pdfPanel: {
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    padding: "0.85rem",
    background: "#fff",
    border: "1px solid var(--line)",
    borderRadius: 16,
    color: "var(--ink)",
  },
  pdfPanelTitle: {
    margin: 0,
    textAlign: "center",
    fontSize: "0.9rem",
    fontWeight: 500,
    color: "var(--ink)",
  },
  pdfDrop: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.55rem",
    minHeight: 110,
    padding: "0.85rem 0.65rem",
    border: "1px dashed var(--line)",
    borderRadius: 10,
    background: "rgba(244,247,249,0.9)",
    textAlign: "center",
  },
  pdfDropActive: {
    borderColor: "var(--safe)",
    background: "rgba(15,122,108,0.08)",
  },
  pdfIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  pdfDropText: {
    margin: 0,
    fontSize: "0.8rem",
    color: "var(--ink-soft)",
    lineHeight: 1.4,
  },
  pdfSelectedName: {
    margin: 0,
    fontSize: "0.72rem",
    color: "var(--safe)",
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  pdfUploadLink: {
    padding: 0,
    border: "none",
    background: "none",
    color: "var(--safe)",
    fontWeight: 600,
    fontSize: "inherit",
    cursor: "pointer",
    textDecoration: "underline",
    textUnderlineOffset: 2,
  },
  pdfOrRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.55rem",
  },
  pdfOrLine: {
    flex: 1,
    height: 1,
    background: "var(--line)",
  },
  pdfOrLabel: {
    fontSize: "0.72rem",
    color: "var(--ink-soft)",
    letterSpacing: "0.04em",
  },
  pdfLinkRow: {
    display: "flex",
    gap: "0.45rem",
    alignItems: "center",
  },
  pdfLinkInput: {
    flex: 1,
    minWidth: 0,
    padding: "0.55rem 0.85rem",
    border: "1px solid var(--line)",
    borderRadius: 999,
    background: "#fff",
    color: "var(--ink)",
    fontSize: "0.8rem",
    outline: "none",
  },
  pdfSearchBtn: {
    padding: "0.55rem 0.95rem",
    border: "1px solid var(--line)",
    borderRadius: 999,
    background: "#fff",
    color: "var(--safe)",
    fontWeight: 600,
    fontSize: "0.8rem",
    cursor: "pointer",
    flexShrink: 0,
  },
  fileHidden: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    pointerEvents: "none",
  },
  actions: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.85rem 1.5rem 0",
  },
  actionBtn: {
    flex: 1,
    padding: "0.5rem 0.75rem",
    background: "#fff",
    color: "var(--ink)",
    border: "1px solid var(--line)",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: "0.82rem",
    cursor: "pointer",
    textAlign: "center",
    whiteSpace: "nowrap",
    transition: "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
  },
  scrambleBtn: {
    flex: 1,
    padding: "0.5rem 0.75rem",
    background: "#fff",
    color: "var(--ink)",
    border: "1px solid var(--line)",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: "0.82rem",
    cursor: "pointer",
    textAlign: "center",
    whiteSpace: "nowrap",
    transition: "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
  },
  counts: {
    display: "flex",
    flexDirection: "column",
    gap: "0.45rem",
    overflow: "auto",
    minHeight: 0,
    flex: 1,
  },
  severityGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
  },
  severityToggle: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    padding: "0.4rem 0.35rem",
    border: "1px solid var(--line)",
    borderRadius: 8,
    background: "#fff",
    cursor: "pointer",
    font: "inherit",
    color: "var(--ink)",
  },
  severityToggleLeft: {
    display: "flex",
    alignItems: "center",
    gap: "0.45rem",
  },
  severityCaret: {
    fontSize: "0.75rem",
    color: "var(--ink-soft)",
    width: "0.75rem",
  },
  severityCount: {
    fontFamily: "var(--font-mono)",
    fontSize: "0.85rem",
    fontWeight: 600,
  },
  severityDropdown: {
    display: "flex",
    flexDirection: "column",
    gap: "0.45rem",
    padding: "0.35rem 0.15rem 0.15rem 0.85rem",
    borderLeft: "2px solid var(--line)",
    marginLeft: "0.45rem",
  },
  sideFinding: {
    display: "flex",
    flexDirection: "column",
    gap: "0.2rem",
    paddingBottom: "0.45rem",
    borderBottom: "1px dashed var(--line)",
  },
  sideFindingTitle: {
    fontSize: "0.8rem",
    lineHeight: 1.3,
  },
  sideFindingDesc: {
    margin: 0,
    color: "var(--ink-soft)",
    fontSize: "0.75rem",
    lineHeight: 1.35,
  },
  sideFindingFix: {
    margin: "0.15rem 0 0",
    color: "var(--safe)",
    fontSize: "0.72rem",
    lineHeight: 1.35,
  },
  copyPromptBtn: {
    alignSelf: "flex-start",
    marginTop: "0.35rem",
    padding: "0.28rem 0.55rem",
    border: "1px solid var(--line)",
    borderRadius: 6,
    background: "#fff",
    color: "var(--ink)",
    fontSize: "0.7rem",
    fontWeight: 600,
    cursor: "pointer",
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
  code: {
    fontFamily: "var(--font-mono)",
    fontSize: "0.72rem",
    color: "var(--ink-soft)",
    wordBreak: "break-all",
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
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(12,26,36,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
    padding: "1rem",
  },
  modal: {
    background: "#fff",
    border: "1px solid var(--line)",
    borderRadius: 10,
    maxWidth: 420,
    width: "100%",
    padding: "1.25rem 1.35rem",
    boxShadow: "0 12px 40px rgba(12,26,36,0.18)",
  },
  modalTitle: {
    margin: 0,
    fontFamily: "var(--font-display)",
    fontSize: "1.25rem",
  },
  modalBody: {
    margin: "0.75rem 0 1.25rem",
    color: "var(--ink-soft)",
    fontSize: "0.95rem",
    lineHeight: 1.45,
  },
  modalActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.5rem",
  },
  modalCancel: {
    padding: "0.55rem 0.9rem",
    background: "#fff",
    color: "var(--ink)",
    border: "1px solid var(--line)",
    borderRadius: 8,
    fontWeight: 600,
    cursor: "pointer",
  },
  modalDanger: {
    padding: "0.55rem 0.9rem",
    background: "var(--crit)",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontWeight: 600,
    cursor: "pointer",
  },
};
