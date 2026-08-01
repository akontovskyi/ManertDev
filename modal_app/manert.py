"""
ManertDev Modal workers — heavy scan + LLM model on Modal cloud.

Auth: ~/.modal.toml or MODAL_TOKEN_ID / MODAL_TOKEN_SECRET

Usage:
  python -m modal run modal_app/manert.py --ping-only
  python -m modal run modal_app/manert.py --payload-file job.json
  python -m modal run modal_app/manert.py --ask "explain XSS"
  python -m modal deploy modal_app/manert.py
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Any

import modal

app = modal.App("manertdev")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("httpx>=0.27.0")
)

SECRET_PATTERNS = [
    (r"\bAKIA[0-9A-Z]{16}\b", "AWS Access Key ID", "Critical"),
    (
        r"\b(api[_-]?key|secret[_-]?key|access[_-]?token)\b\s*[:=]\s*['\"][^'\"]{8,}['\"]",
        "Hardcoded API/secret key",
        "Critical",
    ),
    (r"\bsk-[A-Za-z0-9]{20,}\b", "OpenAI-style key", "Critical"),
    (r"\bospy_[a-f0-9]{32,}\b", "Ossprey-style key", "High"),
    (r"-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----", "Private key block", "Critical"),
    (
        r"\b(password|passwd|pwd)\b\s*[:=]\s*['\"][^'\"]{4,}['\"]",
        "Hardcoded password",
        "High",
    ),
]

ROUTE_PATTERNS = [
    (
        r"\b(app|router|server)\.(get|post|put|patch|delete|all|use)\s*\(\s*[`'\"]([^`'\"]+)[`'\"]",
        "Express-style route",
    ),
    (
        r"export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(",
        "Next.js route handler",
    ),
    (
        r"@(Get|Post|Put|Patch|Delete)\s*\(\s*[`'\"]([^`'\"]+)[`'\"]",
        "Decorator route",
    ),
]

DANGEROUS_PATH = re.compile(
    r"/(admin|debug|internal|manage|actuator|swagger|graphql|ws)\b",
    re.I,
)


def _emit(obj: Any) -> None:
    """Print a parseable JSON blob for the Node CLI (markers survive Modal logs)."""
    print("MANERT_JSON_START", flush=True)
    print(json.dumps(obj, ensure_ascii=True), flush=True)
    print("MANERT_JSON_END", flush=True)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _make_id(prefix: str, file: str, line: int) -> str:
    safe = re.sub(r"[^a-zA-Z0-9]+", "_", f"{prefix}_{file}_{line}")[:80]
    return safe.strip("_").lower() or f"{prefix}_{line}"


def _scan_files(files: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for item in files:
        path = item.get("path") or "unknown"
        content = item.get("content") or ""
        lines = content.splitlines()
        lower_path = path.lower()

        if kind in ("full", "secrets") and (
            lower_path.endswith(".env")
            or "/.env" in lower_path
            or lower_path.startswith(".env")
        ):
            if not lower_path.endswith(".example"):
                findings.append(
                    {
                        "id": _make_id("env", path, 1),
                        "severity": "High",
                        "category": "secrets",
                        "title": f"Environment file present: {path}",
                        "description": "Real env file found in payload — ensure it is never committed or served.",
                        "evidence": {
                            "file": path,
                            "line": 1,
                            "snippet": "\n".join(lines[:5])[:400],
                        },
                        "remediation": "Remove from VCS, use secrets manager, keep only .env.example.",
                        "problemType": "secret_leak",
                    }
                )

        for idx, line in enumerate(lines, start=1):
            if kind in ("full", "secrets"):
                for pat, title, sev in SECRET_PATTERNS:
                    if re.search(pat, line, re.I):
                        findings.append(
                            {
                                "id": _make_id("sec", path, idx),
                                "severity": sev,
                                "category": "secrets",
                                "title": title,
                                "description": f"Possible secret material at {path}:{idx}",
                                "evidence": {
                                    "file": path,
                                    "line": idx,
                                    "snippet": line[:240],
                                },
                                "remediation": "Rotate the credential and move it to env/secrets storage.",
                                "problemType": "secret_leak",
                            }
                        )

            if kind in ("full", "endpoints", "entrances"):
                for pat, hint in ROUTE_PATTERNS:
                    m = re.search(pat, line, re.I)
                    if not m:
                        continue
                    route = next(
                        (g for g in m.groups() if g and str(g).startswith("/")),
                        None,
                    )
                    sev = "High" if route and DANGEROUS_PATH.search(route) else "Medium"
                    title = (
                        f"Exposed route candidate: {route}"
                        if route
                        else f"Route registration ({hint})"
                    )
                    findings.append(
                        {
                            "id": _make_id("ep", path, idx),
                            "severity": sev,
                            "category": "endpoints" if sev != "High" else "entrances",
                            "title": title,
                            "description": f"{hint} detected during Modal heavy scan.",
                            "evidence": {
                                "file": path,
                                "line": idx,
                                "snippet": line[:240],
                            },
                            "remediation": "Confirm authz middleware; hide debug/admin routes in production.",
                            "problemType": "exposed_endpoint"
                            if sev != "High"
                            else "debug_exposure",
                        }
                    )

    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for f in findings:
        if f["id"] in seen:
            continue
        seen.add(f["id"])
        unique.append(f)
    return unique


def _openrouter_chat(
    messages: list[dict[str, str]],
    *,
    api_key: str | None = None,
    model: str | None = None,
    temperature: float = 0.7,
) -> str:
    import httpx

    key = (
        api_key
        or os.environ.get("OPENROUTER_API_KEY")
        or os.environ.get("OPENROUTER_FALLBACK_API_KEY")
        or ""
    )
    if not key:
        raise RuntimeError(
            "No OpenRouter key. Pass api_key in payload or set OPENROUTER_API_KEY "
            "(Modal secret or ~/.manertdev/.env)."
        )

    model = model or os.environ.get("OPENROUTER_MODEL") or "openrouter/free"
    base = os.environ.get("OPENROUTER_BASE_URL") or "https://openrouter.ai/api/v1"

    with httpx.Client(timeout=90.0) as client:
        res = client.post(
            f"{base.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {key}",
                "HTTP-Referer": "https://github.com/alvi83252-dot/ManertDev",
                "X-Title": "ManertDev-Modal",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": messages,
                "temperature": temperature,
            },
        )
        res.raise_for_status()
        data = res.json()
        return (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
            .strip()
        )


@app.function(image=image, timeout=120)
def ping() -> dict[str, Any]:
    return {
        "ok": True,
        "app": "manertdev",
        "time": _now(),
        "message": "ManertDev Modal worker is alive",
    }


@app.function(image=image, timeout=300, memory=2048)
def heavy_scan(payload: dict[str, Any]) -> dict[str, Any]:
    kind = (payload.get("kind") or "full").lower()
    query = payload.get("query") or kind
    root = payload.get("root") or "."
    files = payload.get("files") or []
    if not isinstance(files, list):
        files = []

    files = files[:80]
    for f in files:
        content = f.get("content") or ""
        if len(content) > 80_000:
            f["content"] = content[:80_000]

    findings = _scan_files(files, kind)
    order = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3, "Info": 4}
    findings.sort(key=lambda x: order.get(x.get("severity", "Info"), 9))

    summary = (
        f"Modal heavy scan ({kind}) on `{root}`: {len(findings)} finding(s) "
        f"across {len(files)} file(s). Propose-only — no files modified."
    )

    narration = None
    if payload.get("narrate"):
        try:
            narration = _openrouter_chat(
                [
                    {
                        "role": "system",
                        "content": (
                            "You are ManertDev on Modal. Summarize security findings "
                            "precisely. Propose fixes only. Plain text."
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Query: {query}\n\nFindings JSON:\n"
                            + json.dumps(findings[:25], indent=2)
                        ),
                    },
                ],
                api_key=payload.get("api_key"),
                model=payload.get("model"),
            )
        except Exception as err:  # noqa: BLE001
            narration = f"(model narration skipped: {err})"

    return {
        "summary": summary,
        "findings": findings,
        "scanKind": kind,
        "targetPath": root,
        "scannedAt": _now(),
        "fileCount": len(files),
        "narration": narration,
        "engine": "modal",
    }


@app.function(image=image, timeout=180)
def ask_model(payload: dict[str, Any]) -> dict[str, Any]:
    model = payload.get("model")
    messages = payload.get("messages")
    if not messages:
        prompt = payload.get("prompt") or ""
        messages = [
            {
                "role": "system",
                "content": "You are ManertDev's Modal-hosted security assistant.",
            },
            {"role": "user", "content": prompt},
        ]

    text = _openrouter_chat(
        messages,
        api_key=payload.get("api_key"),
        model=model,
    )
    return {
        "ok": True,
        "engine": "modal+openrouter",
        "model": model or os.environ.get("OPENROUTER_MODEL") or "openrouter/free",
        "content": text,
        "time": _now(),
    }


@app.local_entrypoint()
def main(
    kind: str = "full",
    query: str = "full scan",
    root: str = ".",
    ask: str = "",
    ping_only: bool = False,
    payload_file: str = "",
    narrate: bool = False,
):
    if ping_only:
        _emit(ping.remote())
        return

    if payload_file:
        with open(payload_file, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
        mode = payload.get("mode") or ("ask" if payload.get("prompt") else "scan")
        if mode == "ask":
            _emit(ask_model.remote(payload))
        else:
            _emit(heavy_scan.remote(payload))
        return

    if ask:
        api_key = os.environ.get("OPENROUTER_API_KEY") or os.environ.get(
            "OPENROUTER_FALLBACK_API_KEY"
        )
        _emit(
            ask_model.remote(
                {
                    "prompt": ask,
                    "api_key": api_key,
                    "model": os.environ.get("OPENROUTER_MODEL") or "openrouter/free",
                }
            )
        )
        return

    sample = [
        {
            "path": "demo.ts",
            "content": (
                "app.get('/admin/users', (req,res) => res.json([]))\n"
                "const api_key = 'sk-test-demo-key-1234567890'\n"
            ),
        }
    ]
    result = heavy_scan.remote(
        {
            "root": root,
            "kind": kind,
            "query": query,
            "files": sample,
            "narrate": narrate,
            "api_key": os.environ.get("OPENROUTER_API_KEY")
            or os.environ.get("OPENROUTER_FALLBACK_API_KEY"),
        }
    )
    _emit(result)
