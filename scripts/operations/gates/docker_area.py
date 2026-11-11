from __future__ import annotations

import shutil

from operations.gates.common import (
    ROOT,
    check_no_emojis,
    check_secrets_and_prod,
    resolve_tool,
    run_cmd,
)

DOCKER_DIR = ROOT / "infra" / "docker"
DOCKERFILE = DOCKER_DIR / "Dockerfile"
COMPOSE_FILE = DOCKER_DIR / "docker-compose.yml"
HADOLINT_CFG = DOCKER_DIR / ".hadolint.yaml"


def run_stage(stage: str, coverage_fail_under: int = 100, light_clean: bool = False) -> None:
    _ = coverage_fail_under, light_clean
    docker_files = [
        DOCKERFILE,
        COMPOSE_FILE,
        HADOLINT_CFG,
        ROOT / ".dockerignore",
        ROOT / "infra" / "README.md",
    ]

    if stage == "lint":
        print("=== [Docker | Lint] ===")
        check_no_emojis([f for f in docker_files if f.is_file()])
        hadolint = resolve_tool("hadolint")
        if not hadolint:
            raise RuntimeError("hadolint nao encontrado no PATH")
        run_cmd([hadolint, "-c", HADOLINT_CFG.relative_to(ROOT).as_posix(), DOCKERFILE.relative_to(ROOT).as_posix()])
        return

    if stage == "security":
        print("=== [Docker | Seguranca] ===")
        check_secrets_and_prod(docker_files, check_prod=True)
        trivy = resolve_tool("trivy")
        if trivy:
            run_cmd([
                trivy,
                "config",
                "--quiet",
                "--exit-code",
                "1",
                "--severity",
                "HIGH,CRITICAL",
                DOCKER_DIR.relative_to(ROOT).as_posix(),
            ])
        return

    if stage == "test":
        print("=== [Docker | Testes] ===")
        run_cmd(["k6", "inspect", "src/presentation/scenarios/smoke.ts"])
        return

    if stage == "validate":
        print("=== [Docker | Validate] ===")
        for req in (DOCKERFILE, COMPOSE_FILE, HADOLINT_CFG, ROOT / ".dockerignore", ROOT / "infra" / "README.md"):
            if not req.is_file():
                raise RuntimeError(f"Arquivo Docker ausente: {req.relative_to(ROOT).as_posix()}")
        if shutil.which("docker"):
            run_cmd([
                "docker",
                "compose",
                "--env-file",
                ".env.example",
                "-f",
                COMPOSE_FILE.relative_to(ROOT).as_posix(),
                "--project-directory",
                ".",
                "config",
                "-q",
            ])
        return

    if stage == "build":
        print("=== [Docker | Build] ===")
        if shutil.which("docker"):
            run_cmd(["docker", "build", "--check", "-f", DOCKERFILE.relative_to(ROOT).as_posix(), "."])
        return

    if stage == "clean":
        print("=== [Docker | Clean] ===")
        return

    raise ValueError(f"Estagio desconhecido: {stage}")
