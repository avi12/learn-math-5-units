r"""Build the site into a container and deploy it to Cloud Run.

    python scripts/deploy_run.py

Cloud Build builds server/Dockerfile with the repo root as its context, so the site is
built INSIDE the image: what ships is what the image built, and there is no locally built
dist/ that could be an edit behind. .gcloudignore decides what the build gets to see.

This does not touch Firebase Hosting. Until the links are switched over, Hosting is still
what serves the site and `python scripts/deploy.py` is still how the site is
released — so a bad deploy here changes nothing that anyone is looking at, which is the
whole reason the migration is done in this order.

One-time setup, before the first run (both are per-project and stick):

    gcloud services enable cloudbuild.googleapis.com run.googleapis.com \
        --project <your-project-id>

The account, the project and the Firestore rules push are taken from deploy.py rather than
written again — it is the same project, the same login, and the same rules file. When
Hosting goes, deploy.py keeps `token`, `call` and `push_rules`; only its Hosting half is
deleted.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

# sys.path[0] is this file's directory when it is run as a path, which is how it is run.
import deploy

ROOT = Path(__file__).resolve().parent.parent
PROJECT = deploy.PROJECT
ACCOUNT = deploy.ACCOUNT
REGION = os.environ.get("REGION", "me-west1")
SERVICE = os.environ.get("SERVICE", PROJECT)
IMAGE = os.environ.get("IMAGE", f"gcr.io/{PROJECT}/{SERVICE}")


def gcloud(*args: str, capture: bool = False) -> str:
    # on Windows gcloud is a .cmd shim, so it has to be resolved before exec — the same
    # reason deploy.py resolves it before asking for a token
    exe = shutil.which("gcloud") or shutil.which("gcloud.cmd")
    if not exe:
        raise SystemExit("gcloud not found on PATH")
    argv = [exe, *args, f"--project={PROJECT}", *([f"--account={ACCOUNT}"] if ACCOUNT else []), "--quiet"]
    out = subprocess.run(argv, cwd=str(ROOT), text=True,
                         capture_output=capture)
    if out.returncode:
        raise SystemExit(f"gcloud {args[0]} {args[1]} failed"
                         + (f":\n{out.stderr.strip()}" if capture else ""))
    return (out.stdout or "").strip()


def main() -> int:
    print(f"building {IMAGE} via Cloud Build...")
    gcloud("builds", "submit", ".",
           "--config=server/cloudbuild.yaml",
           f"--substitutions=TAG_NAME={IMAGE}",
           "--suppress-logs")

    # A static site holds nothing in memory, so it scales from zero: no instance is paid
    # for while nobody is writing, and a cold start is one node process and two files.
    print(f"deploying {SERVICE} to Cloud Run in {REGION}...")
    gcloud("run", "deploy", SERVICE,
           f"--image={IMAGE}",
           "--platform=managed",
           f"--region={REGION}",
           "--allow-unauthenticated",
           "--port=8080",
           "--memory=256Mi",
           "--min-instances=0",
           "--max-instances=2")

    url = gcloud("run", "services", "describe", SERVICE,
                 f"--region={REGION}", "--format=value(status.url)", capture=True)

    # The rules belong to the app, not to whatever is serving it, so they are released by
    # every deploy path there is. Deliberately after the service is up, like deploy.py:
    # nothing is gained by widening access before the code that needs it is live.
    deploy.push_rules(deploy.token())

    print(f"\nlive: {url}")
    print(f"Firebase Hosting is untouched and still serving https://{deploy.SITE}.web.app")
    return 0


if __name__ == "__main__":
    sys.exit(main())
