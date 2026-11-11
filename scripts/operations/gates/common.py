from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC_DIR = ROOT / "src"
TESTS_DIR = ROOT / "tests"
MAX_FILE_LINES = 300

EMOJI_PATTERN = re.compile(r"[\U0001F300-\U0001FAFF\u2600-\u27BF]")
SECRET_PATTERNS = (
    ("aws_access_key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("private_key_block", re.compile(r"BEGIN [A-Z ]*PRIVATE KEY")),
    ("hardcoded_bearer", re.compile(r"Bearer\s+[A-Za-z0-9\-._~+/]{20,}")),
)
PROD_FORBIDDEN_PATTERNS = (
    ("Prod-Site-Azion", re.compile(r"Prod-Site-Azion")),
    ("www.palmeiras.com.br", re.compile(r"www\.palmeiras\.com\.br")),
    ("1627138501", re.compile(r"1627138501")),
)
ALLOWED_PROD_BLOCKLIST_FILES = {
    "src/domain/value_objects/TargetEnvironment.ts",
    "src/domain/policies/ResponseSafetyPolicy.ts",
}


def resolve_tool(name: str) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    local_bin = Path.home() / ".local" / "bin" / name
    if local_bin.is_file() and os.access(local_bin, os.X_OK):
        return str(local_bin)
    return None


def run_cmd(cmd: list[str], allow_fail: bool = False) -> subprocess.CompletedProcess[str]:
    print(f"[RUN] {' '.join(cmd)}")
    proc = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True)
    if proc.stdout:
        print(proc.stdout.rstrip())
    if proc.stderr:
        print(proc.stderr.rstrip(), file=sys.stderr)
    if proc.returncode != 0 and not allow_fail:
        raise RuntimeError(f"Comando falhou ({proc.returncode}): {' '.join(cmd)}")
    return proc


def check_no_emojis(paths: list[Path]) -> None:
    for path in paths:
        if not path.is_file():
            continue
        content = path.read_text(encoding="utf-8")
        if EMOJI_PATTERN.search(content):
            rel = path.relative_to(ROOT).as_posix()
            raise RuntimeError(f"Emoji detectado em {rel}")


def check_secrets_and_prod(
    paths: list[Path],
    *,
    check_prod: bool = True,
    allowed_prod_files: set[str] | None = None,
) -> None:
    allowed = allowed_prod_files or set()
    for path in paths:
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT).as_posix()
        text = path.read_text(encoding="utf-8")
        for label, rx in SECRET_PATTERNS:
            if rx.search(text):
                raise RuntimeError(f"Possivel segredo exposto ({label}) em {rel}")
        if check_prod and rel not in allowed:
            for label, rx in PROD_FORBIDDEN_PATTERNS:
                if rx.search(text):
                    raise RuntimeError(f"Referencia proibida a PROD ({label}) em {rel}")
