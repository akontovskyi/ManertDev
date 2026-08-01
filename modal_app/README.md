# SentinelDev Modal workers

Cloud heavy-scan + model ask for the `sentinel modal` CLI.

## One-time setup

```bash
pip install -r requirements-modal.txt
python -m modal setup
node scripts/sync-modal-env.js
```

## Commands

```bash
# Health
python -m modal run modal_app/sentinel.py --ping-only
sentinel modal --ping

# Heavy scan (uploads a capped file set)
sentinel modal "find exposed endpoints"
sentinel modal --narrate "full scan"

# Model ask (uses OPENROUTER_* from ~/.sentineldev/.env)
sentinel modal --ask "Explain SSRF in one paragraph"
```

## Deploy (optional)

```bash
python -m modal deploy modal_app/sentinel.py
```
