from __future__ import annotations

import json
import re

from operations.gates.common import (
    ROOT,
    check_no_emojis,
    check_secrets_and_prod,
    resolve_tool,
    run_cmd,
)

GITHUB_DIR = ROOT / ".github"
AGENTS_DIR = ROOT / ".agents"
CI_WORKFLOW = GITHUB_DIR / "workflows" / "ci.yml"
RELEASE_TEMPLATE = GITHUB_DIR / "workflows" / "templates" / "release-announcement.yaml"


def _verify_naming_parity() -> None:
    expected_prefixes = ("TypeScript | ", "Docker | ", "GitHub | ", "Scripts | ")
    precommit = (ROOT / ".pre-commit-config.yaml").read_text(encoding="utf-8")
    hook_names = re.findall(r'name:\s*"([^"]+)"', precommit)
    if len(hook_names) < 20:
        raise RuntimeError("Hooks insuficientes em .pre-commit-config.yaml (esperados 20 pares tecnologia|step)")
    for hook in hook_names:
        if not hook.startswith(expected_prefixes):
            raise RuntimeError(f"Nome de hook fora do padrao NOME_DA_TECNOLOGIA | STEP: {hook}")

    for action in sorted((GITHUB_DIR / "actions" / "ci").glob("validate-*/action.yml")):
        if action.parent.name == "validate-commitlint":
            continue
        content = action.read_text(encoding="utf-8")
        if not any(f'- name: {p}' in content for p in expected_prefixes):
            raise RuntimeError(f"Action sem steps no padrao NOME_DA_TECNOLOGIA | STEP: {action}")


def run_stage(stage: str, coverage_fail_under: int = 100, light_clean: bool = False) -> None:
    _ = coverage_fail_under, light_clean
    gh_files = sorted([p for p in GITHUB_DIR.rglob("*") if p.is_file()])
    agent_files = sorted([p for p in AGENTS_DIR.rglob("*") if p.is_file()])

    if stage == "lint":
        print("=== [GitHub | Lint] ===")
        check_no_emojis([*gh_files, *agent_files])
        actionlint = resolve_tool("actionlint")
        if not actionlint:
            raise RuntimeError("actionlint nao encontrado no PATH")
        run_cmd([actionlint, CI_WORKFLOW.relative_to(ROOT).as_posix()])
        return

    if stage == "security":
        print("=== [GitHub | Seguranca] ===")
        check_secrets_and_prod(gh_files, check_prod=True)
        gitleaks = resolve_tool("gitleaks")
        if gitleaks:
            run_cmd([gitleaks, "dir", ".github", "--no-banner"])
        return

    if stage == "test":
        print("=== [GitHub | Testes] ===")
        _verify_naming_parity()
        return

    if stage == "validate":
        print("=== [GitHub | Validate] ===")
        required = (
            CI_WORKFLOW,
            RELEASE_TEMPLATE,
            GITHUB_DIR / "actions" / "ci" / "setup-node" / "action.yml",
            GITHUB_DIR / "actions" / "ci" / "validate-commitlint" / "action.yml",
            GITHUB_DIR / "actions" / "ci" / "validate-typescript" / "action.yml",
            GITHUB_DIR / "actions" / "ci" / "validate-docker" / "action.yml",
            GITHUB_DIR / "actions" / "ci" / "validate-github" / "action.yml",
            GITHUB_DIR / "actions" / "ci" / "validate-scripts" / "action.yml",
            GITHUB_DIR / "actions" / "ci" / "sync-tags" / "action.yml",
            GITHUB_DIR / "actions" / "ci" / "release" / "action.yml",
            GITHUB_DIR / "actions" / "shared" / "pipeline-summary" / "action.yml",
            AGENTS_DIR / "README.md",
            AGENTS_DIR / "rules" / "architecture.md",
            AGENTS_DIR / "rules" / "testing-tdd.md",
            AGENTS_DIR / "rules" / "observability.md",
            AGENTS_DIR / "rules" / "hml-safety.md",
            AGENTS_DIR / "skills" / "quality-gate" / "SKILL.md",
            AGENTS_DIR / "skills" / "run-hml-suite" / "SKILL.md",
        )
        for req in required:
            if not req.is_file():
                raise RuntimeError(f"Arquivo GitHub/Agents ausente: {req.relative_to(ROOT).as_posix()}")
        return

    if stage == "build":
        print("=== [GitHub | Build] ===")
        json.loads((ROOT / "linters" / "releaserc.json").read_text(encoding="utf-8"))
        if "{VERSION}" not in RELEASE_TEMPLATE.read_text(encoding="utf-8"):
            raise RuntimeError("Template de release invalido")
        return

    if stage == "clean":
        print("=== [GitHub | Clean] ===")
        return

    raise ValueError(f"Estagio desconhecido: {stage}")
