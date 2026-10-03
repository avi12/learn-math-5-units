"""The Python twin of shared/env.mjs: the one `.env` at the repo root.

Kept to the same three answers, so the deploy scripts and the JS tooling cannot disagree
about which project they mean. Import with:

    sys.path.insert(0, str(<repo root> / "shared")); import env
"""
import os
from pathlib import Path

FILE = Path(__file__).resolve().parent.parent / ".env"


def _from_file() -> dict[str, str]:
    if not FILE.exists():
        return {}
    pairs = (line.partition("=") for line in FILE.read_text(encoding="utf-8").splitlines())
    return {k.strip(): v.strip() for k, sep, v in pairs if sep and k.strip().isupper()}


_FILE = _from_file()


def env(name: str) -> str:
    """A value from the environment, else from `.env`. Exits with the fix, not a trace."""
    value = os.environ.get(name) or _FILE.get(name)
    if not value:
        raise SystemExit(f"{name} is not set - copy .env.example to .env at the repo root and fill it in")
    return value


def firebase_project() -> str:
    return env("VITE_FIREBASE_PROJECT_ID")


def pad_origin() -> str:
    return os.environ.get("PAD_ORIGIN") or _FILE.get("PAD_ORIGIN") or f"https://{firebase_project()}.web.app"
