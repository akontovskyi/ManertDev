# ManertDev Modal workers

Cloud heavy-scan + model ask for the `manert modal` CLI.

## One-time setup

```bash
pip install -r requirements-modal.txt
python -m modal setup
node scripts/sync-modal-env.js
```

## Commands

```bash
# Health
python -m modal run modal_app/manert.py --ping-only
manert modal --ping

# Heavy scan (uploads a capped file set)
manert modal "find exposed endpoints"
manert modal --narrate "full scan"

# Model ask (uses OPENROUTER_* from ~/.manertdev/.env)
manert modal --ask "Explain SSRF in one paragraph"
```

## Deploy (optional)

```bash
python -m modal deploy modal_app/manert.py
```
