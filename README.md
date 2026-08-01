# SentinelDev

AI-powered **in-development** security helper — “Denuvo for apps” while you build.

SentinelDev analyzes codebases, configs, API routes, and IAM-like documents to find exposure risks. It **never modifies your code automatically**. It only proposes remediations, patches, and secure rewrites.

## Features

| Capability | What it does |
|---|---|
| Endpoint exposure | Finds public/admin/debug-ish routes with file:line evidence |
| Secrets & env | Detects keys, tokens, `.env` files, weak names |
| System entrances | Maps admin/debug/swagger/CORS/ports |
| Database exposure | Flags DB routes, raw queries, injection-ish sinks |
| Key scramble | Suggests rename + rotation patterns |
| IAM / PDF | IBM-challenge style “who can / overly permissive?” with line citations |
| Fix logs | Supabase PostgreSQL-compatible rows on every finding |
| CLI + Dashboard | Natural-language keyword routing |

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → **Launch console**.

### CLI

```bash
# Full sweep of current directory
npm run cli -- scan

# Keyword-routed ask
npm run cli -- ask "are there exposed endpoints?" --root .

# Secrets only
npm run cli -- scan --kind secrets --root ./fixtures

# Include Cursor patch block
npm run cli -- ask "apply fix for secrets" --root ./fixtures

# Emit a Modal-ready task description
npm run cli -- modal "deep scan endpoints and database" --root .
```

Demo target with intentional issues: `fixtures/vulnerable-sample.ts`.

### Supabase fix logs

1. Create a Supabase project.
2. Run `supabase/migrations/001_fix_logs.sql` in the SQL editor.
3. Set in `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

If unset, scans still work; fix logs are returned in the API/CLI JSON only.

## Keyword routing

- `endpoint`, `route`, `API`, `public`, `exposed` → Endpoint scan  
- `database`, `db`, `sql`, `mongo` → Database scan  
- `env`, `keys`, `secrets`, `token` → Secrets scan  
- `admin`, `debug`, `panel` → Entrances scan  
- `scramble`, `rotate`, `secure keys` → Scramble suggestions  
- `IAM`, `permissions`, `policy`, `who can` → IAM reasoning (upload PDF)  
- `fix`, `patch`, `apply`, `run agent` → Include optional Cursor patch block  

## Output shape (always)

1. **Summary**  
2. **Findings** (severity: Critical / High / Medium / Low / Info)  
3. **Evidence** (file + line + snippet)  
4. **Proposed Fixes**  
5. **Optional Patch** (only when you request apply/patch/agent)

## API

- `POST /api/chat` `{ "query": "scan endpoints", "root": "." }`  
- `POST /api/scan` `{ "kind": "secrets", "root": "." }`  
- `POST /api/pdf` multipart `file` + `question` (or JSON `{ text, question }`)  
- `GET /api/fix-logs`

## Safety contract

- No hallucinated endpoints, keys, or IAM principals.  
- Uncertainty is stated explicitly.  
- Scanners are **propose-only** — Cursor applies patches only when you say so.

## Project layout

```
src/
  app/           # Landing + dashboard + API routes
  cli/           # Natural-language CLI
  lib/           # types, router, report, supabase
  scanners/      # endpoints, secrets, entrances, database, scramble, iam
fixtures/        # Intentionally vulnerable samples
supabase/        # fix_logs migration
```

## License

MIT — use responsibly on codebases you are authorized to assess.
