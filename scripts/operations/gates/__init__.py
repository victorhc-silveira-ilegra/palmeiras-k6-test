from __future__ import annotations

from collections.abc import Callable

from operations.gates import docker_area, github_area, scripts_area, typescript_area

AREAS = ("typescript", "docker", "github", "scripts")
STAGES = ("lint", "security", "test", "validate", "build", "clean", "pipeline", "all")

_HANDLERS: dict[str, Callable[[str, int, bool], None]] = {
    "typescript": typescript_area.run_stage,
    "docker": docker_area.run_stage,
    "github": github_area.run_stage,
    "scripts": scripts_area.run_stage,
}


def run_area_stage(
    area: str,
    stage: str,
    coverage_fail_under: int = 100,
    light_clean: bool = False,
) -> None:
    handler = _HANDLERS.get(area)
    if handler is None:
        raise ValueError(f"Area desconhecida: {area}")
    handler(stage, coverage_fail_under, light_clean)
