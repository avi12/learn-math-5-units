"""Build the WebView wrapper, and install it if a tablet is plugged in.

    python scripts/apk.py [--install]

Neither Gradle nor a JDK is on PATH on this machine, and the ones that are installed are
the wrong versions for AGP: `java` is 24 and Android Studio's bundled JBR is 25, while
AGP 8.5 wants 17 or 21. Rather than ask anyone to remember that, this finds the JDK 21
Gradle already provisioned for itself and the Gradle distribution already in its cache,
so the build needs no new download and no PATH surgery.
"""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECT = ROOT / "android"
GRADLE_HOME = Path.home() / ".gradle"
SDK = Path.home() / "AppData" / "Local" / "Android" / "Sdk"
APK = PROJECT / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"


def find(pattern: str, root: Path, name: str) -> Path:
    hits = sorted(root.glob(pattern))
    if not hits:
        raise SystemExit(f"no {name} found under {root} ({pattern})")
    return hits[-1]


def main() -> int:
    if not PROJECT.exists():
        raise SystemExit("android/ is missing")
    # AGP 8.5 runs on 17 or 21; take the newest provisioned JDK that is not newer than 21
    jdk = find("jdks/*-21-*/", GRADLE_HOME, "JDK 21")
    gradle = find("wrapper/dists/gradle-8.9-bin/*/gradle-8.9/bin/gradle.bat", GRADLE_HOME, "Gradle 8.9")
    (PROJECT / "local.properties").write_text(
        "sdk.dir=" + SDK.as_posix() + "\n", encoding="utf-8")

    env = dict(os.environ, JAVA_HOME=str(jdk))
    print("jdk   :", jdk)
    print("gradle:", gradle.parent.parent.name)
    r = subprocess.run([str(gradle), "--no-daemon", ":app:assembleDebug"],
                       cwd=str(PROJECT), env=env)
    if r.returncode:
        return r.returncode
    print("\napk:", APK, f"({APK.stat().st_size // 1024} kb)")

    if "--install" not in sys.argv:
        return 0

    adb = SDK / "platform-tools" / "adb.exe"
    devices = subprocess.run([str(adb), "devices"], capture_output=True, text=True)
    attached = [l for l in devices.stdout.splitlines()[1:] if l.strip().endswith("device")]
    if not attached:
        raise SystemExit("no device attached — plug the tablet in with USB debugging on")
    subprocess.run([str(adb), "install", "-r", str(APK)], check=True)
    subprocess.run([str(adb), "shell", "am", "start", "-n",
                    "app.avimath.pen/.MainActivity"], check=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
