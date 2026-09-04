"""Deploy dist/ to Firebase Hosting and push the database rules.

Uses a short-lived gcloud access token instead of `firebase login`, so there is no
interactive step and no service-account key file on disk. The Firebase CLI works too
once you have run `firebase login` — see `npm run deploy:cli`.

    npm run build && python scripts/deploy.py
"""
import gzip
import hashlib
import json
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECT = "avi-math-study"
SITE = "avi-math-study"
ACCOUNT = "you@example.com"
DIST = ROOT / "dist"


def token() -> str:
    # on Windows gcloud is a .cmd shim, so it has to be resolved before exec
    exe = shutil.which("gcloud") or shutil.which("gcloud.cmd")
    if not exe:
        raise SystemExit("gcloud not found on PATH")
    out = subprocess.run(
        [exe, "auth", "print-access-token", f"--account={ACCOUNT}"],
        capture_output=True, text=True, check=True)
    return out.stdout.strip()


def call(method, url, tok, body=None, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + tok)
    req.add_header("x-goog-user-project", PROJECT)
    if data is not None:
        req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req) as r:
            body = r.read()
            return json.loads(body) if body and body[:1] in b"{[" else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:600]
        raise SystemExit(f"{method} {url}\n  HTTP {e.code}: {detail}")


def ensure_site(tok):
    sites = call("GET", f"https://firebasehosting.googleapis.com/v1beta1/projects/{PROJECT}/sites", tok)
    for s in sites.get("sites", []):
        if s["name"].endswith("/" + SITE):
            return
    call("POST", f"https://firebasehosting.googleapis.com/v1beta1/projects/{PROJECT}/sites?siteId={SITE}",
         tok, body={})
    print("hosting site created:", SITE)


def collect():
    """Every file in dist/, gzipped, keyed by its site path and content hash."""
    files = {}
    for p in sorted(DIST.rglob("*")):
        if not p.is_file():
            continue
        blob = gzip.compress(p.read_bytes(), 9, mtime=0)
        digest = hashlib.sha256(blob).hexdigest()
        path = "/" + p.relative_to(DIST).as_posix()
        files[path] = (digest, blob)
    return files


def rest_config():
    """firebase.json speaks the CLI schema; the REST API wants glob/path and a header
    map. Translating here keeps firebase.json as the one place the config is written,
    so `firebase deploy` and this script cannot drift apart."""
    cfg = json.loads((ROOT / "firebase.json").read_text(encoding="utf-8"))["hosting"]
    return {
        "rewrites": [{"glob": r["source"], "path": r["destination"]}
                     for r in cfg.get("rewrites", [])],
        "headers": [{"glob": h["source"],
                     "headers": {x["key"]: x["value"] for x in h["headers"]}}
                    for h in cfg.get("headers", [])],
    }


def push_rules(tok):
    """Firestore rules go through the Rules API: upload a ruleset, then point the
    cloud.firestore release at it. The release exists after the first deploy, so try
    to update it and fall back to creating it."""
    src = (ROOT / "firestore.rules").read_text(encoding="utf-8")
    rs = call("POST", f"https://firebaserules.googleapis.com/v1/projects/{PROJECT}/rulesets",
              tok, body={"source": {"files": [{"name": "firestore.rules", "content": src}]}})
    name = rs["name"]
    rel = f"projects/{PROJECT}/releases/cloud.firestore"
    body = {"release": {"name": rel, "rulesetName": name}}
    try:
        call("PATCH", f"https://firebaserules.googleapis.com/v1/{rel}", tok, body=body)
    except SystemExit:
        call("POST", f"https://firebaserules.googleapis.com/v1/projects/{PROJECT}/releases",
             tok, body={"name": rel, "rulesetName": name})
    print("firestore rules released:", name.rsplit("/", 1)[-1][:12])


def stamp_release(tok):
    """Tell the tabs that are already open which build is now live.

    They are listening to this document over the Firestore socket they hold anyway, so a
    deploy reaches a tablet lying on the table without polling and without a server. The
    id comes from dist/build-id.txt, written by the same vite run that baked it into the
    bundle — one value, so a client can always tell "that is me" from "that is newer".

    Written LAST, after the hosting release is live. The other order tells a tab to
    reload before the new files are being served, and it comes back on the old bundle.

    The REST API is used rather than the client SDK because this token belongs to a
    project member: it is authorised by IAM and does not go through firestore.rules,
    which is what lets the rules keep every browser out of this document.
    """
    build = (DIST / "build-id.txt").read_text(encoding="utf-8").strip()
    now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    url = (f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)"
           "/documents/meta/release"
           "?updateMask.fieldPaths=build&updateMask.fieldPaths=at")
    call("PATCH", url, tok,
         body={"fields": {"build": {"stringValue": build},
                          "at": {"timestampValue": now}}})
    print("release stamped:", build)


def main():
    if not DIST.exists():
        raise SystemExit("dist/ is missing — run `npm run build` first")
    tok = token()
    ensure_site(tok)

    files = collect()
    print(f"{len(files)} files, {sum(len(b) for _, b in files.values()) // 1024} kb gzipped")

    version = call("POST", f"https://firebasehosting.googleapis.com/v1beta1/sites/{SITE}/versions",
                   tok, body={"config": rest_config()})
    vname = version["name"]

    res = call("POST", f"https://firebasehosting.googleapis.com/v1beta1/{vname}:populateFiles",
               tok, body={"files": {p: h for p, (h, _) in files.items()}})
    need = set(res.get("uploadRequiredHashes", []))
    upload_url = res.get("uploadUrl", "")
    by_hash = {h: b for h, b in files.values()}
    for h in need:
        call("POST", f"{upload_url}/{h}", tok, raw=by_hash[h], ctype="application/octet-stream")
    print("uploaded", len(need), "of", len(files))

    call("PATCH", f"https://firebasehosting.googleapis.com/v1beta1/{vname}?update_mask=status",
         tok, body={"status": "FINALIZED"})
    call("POST", f"https://firebasehosting.googleapis.com/v1beta1/sites/{SITE}/releases?versionName={vname}",
         tok, body={})

    push_rules(tok)
    stamp_release(tok)

    print(f"\nlive: https://{SITE}.web.app")


if __name__ == "__main__":
    sys.exit(main())
