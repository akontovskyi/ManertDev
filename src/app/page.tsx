import Link from "next/link";
import type { CSSProperties } from "react";

export default function HomePage() {
  return (
    <main style={styles.main}>
      <div style={styles.atmosphere} aria-hidden />
      <header style={styles.header}>
        <p style={styles.brand}>SentinelDev</p>
        <nav style={styles.nav}>
          <Link href="/dashboard" style={styles.navLink}>
            Open dashboard
          </Link>
        </nav>
      </header>

      <section style={styles.hero}>
        <h1 style={styles.brandHero}>SentinelDev</h1>
        <p style={styles.tagline}>
          Denuvo for apps in development — catch exposure risks before they ship.
        </p>
        <p style={styles.support}>
          Scan endpoints, secrets, entrances, and IAM docs. Propose fixes. Never
          rewrite your tree unless you ask.
        </p>
        <div style={styles.ctaRow}>
          <Link href="/dashboard" style={styles.ctaPrimary}>
            Launch console
          </Link>
          <code style={styles.ctaCode}>npm run cli -- ask &quot;exposed endpoints&quot;</code>
        </div>
      </section>

      <section style={styles.band}>
        <h2 style={styles.bandTitle}>What it watches</h2>
        <p style={styles.bandCopy}>
          Public routes, leaked keys, admin/debug doors, database surfaces, and
          overly permissive policies — with file:line evidence and Supabase-ready
          fix logs.
        </p>
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  main: {
    minHeight: "100vh",
    position: "relative",
    overflow: "hidden",
  },
  atmosphere: {
    position: "absolute",
    inset: 0,
    backgroundImage:
      "repeating-linear-gradient(0deg, transparent, transparent 47px, rgba(12,26,36,0.04) 48px), repeating-linear-gradient(90deg, transparent, transparent 47px, rgba(12,26,36,0.04) 48px)",
    pointerEvents: "none",
    animation: "none",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "1.25rem 2rem",
    position: "relative",
    zIndex: 1,
  },
  brand: {
    margin: 0,
    fontFamily: "var(--font-display)",
    fontWeight: 700,
    fontSize: "1.15rem",
    letterSpacing: "-0.02em",
  },
  nav: { display: "flex", gap: "1rem" },
  navLink: {
    color: "var(--ink)",
    fontWeight: 500,
  },
  hero: {
    position: "relative",
    zIndex: 1,
    maxWidth: 920,
    padding: "12vh 2rem 4rem",
  },
  brandHero: {
    margin: 0,
    fontFamily: "var(--font-display)",
    fontSize: "clamp(3.2rem, 9vw, 5.8rem)",
    lineHeight: 0.95,
    letterSpacing: "-0.03em",
    color: "var(--ink)",
  },
  tagline: {
    margin: "1.25rem 0 0",
    maxWidth: "34ch",
    fontSize: "clamp(1.15rem, 2.4vw, 1.45rem)",
    lineHeight: 1.35,
    color: "var(--ink-soft)",
  },
  support: {
    margin: "0.85rem 0 0",
    maxWidth: "48ch",
    color: "var(--ink-soft)",
    lineHeight: 1.5,
  },
  ctaRow: {
    marginTop: "2rem",
    display: "flex",
    flexWrap: "wrap",
    gap: "1rem",
    alignItems: "center",
  },
  ctaPrimary: {
    display: "inline-block",
    background: "var(--ink)",
    color: "var(--panel)",
    padding: "0.85rem 1.35rem",
    fontWeight: 600,
    textDecoration: "none",
    borderRadius: 2,
  },
  ctaCode: {
    fontFamily: "var(--font-mono)",
    fontSize: "0.85rem",
    background: "rgba(244,247,249,0.85)",
    padding: "0.7rem 0.9rem",
    border: "1px solid var(--line)",
  },
  band: {
    position: "relative",
    zIndex: 1,
    marginTop: "8vh",
    padding: "2.5rem 2rem 4rem",
    borderTop: "1px solid var(--line)",
    background: "rgba(244,247,249,0.55)",
  },
  bandTitle: {
    margin: 0,
    fontFamily: "var(--font-display)",
    fontSize: "1.6rem",
  },
  bandCopy: {
    margin: "0.75rem 0 0",
    maxWidth: "60ch",
    color: "var(--ink-soft)",
    lineHeight: 1.55,
  },
};
