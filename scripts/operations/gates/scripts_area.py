from __future__ import annotations

import shutil
import sys

from operations.gates.common import (
    ROOT,
    check_no_emojis,
    check_secrets_and_prod,
    resolve_tool,
    run_cmd,
)

SCRIPTS_DIR = ROOT / "scripts"
LINTERS_DIR = ROOT / "linters"


def run_stage(stage: str, coverage_fail_under: int = 100, light_clean: bool = False) -> None:
    _ = coverage_fail_under, light_clean
    script_files = [
        *sorted([p for p in SCRIPTS_DIR.rglob("*") if p.is_file() and "__pycache__" not in p.parts]),
        *sorted([p for p in LINTERS_DIR.rglob("*") if p.is_file()]),
        ROOT / "Makefile",
        ROOT / ".pre-commit-config.yaml",
        ROOT / ".githooks" / "pre-commit",
        ROOT / ".githooks" / "commit-msg",
    ]
    sh_scripts = [
        SCRIPTS_DIR / "recon-hml.sh",
        SCRIPTS_DIR / "cloudwatch-summary.sh",
        LINTERS_DIR / "git-hooks" / "install.sh",
        LINTERS_DIR / "git-hooks" / "pre-commit",
        LINTERS_DIR / "git-hooks" / "commitlint.sh",
        LINTERS_DIR / "git-hooks" / "commit-msg",
        LINTERS_DIR / "git-hooks" / "bin" / "resolve_venv_python.sh",
        LINTERS_DIR / "git-hooks" / "bin" / "python",
        LINTERS_DIR / "git-hooks" / "bin" / "pre-commit",
        ROOT / ".githooks" / "pre-commit",
        ROOT / ".githooks" / "commit-msg",
    ]

    if stage == "lint":
        print("=== [Scripts | Lint] ===")
        check_no_emojis(script_files)
        shellcheck = resolve_tool("shellcheck")
        if shellcheck:
            run_cmd([shellcheck, *[p.relative_to(ROOT).as_posix() for p in sh_scripts]])
        return

    if stage == "security":
        print("=== [Scripts | Seguranca] ===")
        check_secrets_and_prod(script_files, check_prod=False)
        return

    if stage == "test":
        print("=== [Scripts | Testes] ===")
        run_cmd([sys.executable, "scripts/operations/clean_workspace.py", "--help"])
        if shutil.which("make"):
            run_cmd(["make", "-n", "hml-smoke", "hml-fanbase", "docker-smoke", "app-ci"])
            run_cmd(["make", "hml-anti-prod"])
        return

    if stage == "validate":
        print("=== [Scripts | Validate] ===")
        for sh in sh_scripts:
            if not sh.is_file():
                raise RuntimeError(f"Script ausente: {sh.relative_to(ROOT).as_posix()}")
            run_cmd(["bash", "-n", sh.relative_to(ROOT).as_posix()])
        for req in (
            SCRIPTS_DIR / "README.md",
            LINTERS_DIR / "README.md",
            LINTERS_DIR / "commitlint.config.mjs",
            ROOT / "Makefile",
            ROOT / ".pre-commit-config.yaml",
        ):
            if not req.is_file():
                raise RuntimeError(f"Arquivo de script/config ausente: {req.relative_to(ROOT).as_posix()}")
        return

    if stage == "build":
        print("=== [Scripts | Build] ===")
        run_cmd([sys.executable, "-m", "compileall", "-q", "scripts/operations"])
        return

    if stage == "clean":
        print("=== [Scripts | Clean] ===")
        return

    raise ValueError(f"Estagio desconhecido: {stage}")
