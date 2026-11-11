from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

from operations.gates.common import (
    ALLOWED_PROD_BLOCKLIST_FILES,
    MAX_FILE_LINES,
    ROOT,
    SRC_DIR,
    TESTS_DIR,
    check_no_emojis,
    check_secrets_and_prod,
    run_cmd,
)


def has_ts_comments(content: str) -> list[int]:
    lines_with_comments: list[int] = []
    i = 0
    n = len(content)
    line = 1
    in_single = False
    in_double = False
    in_template = False
    escaped = False

    while i < n:
        ch = content[i]
        nxt = content[i + 1] if i + 1 < n else ""
        if ch == "\n":
            line += 1
            escaped = False
            i += 1
            continue
        if escaped:
            escaped = False
            i += 1
            continue
        if in_single or in_double or in_template:
            if ch == "\\":
                escaped = True
            elif in_single and ch == "'":
                in_single = False
            elif in_double and ch == '"':
                in_double = False
            elif in_template and ch == "`":
                in_template = False
            i += 1
            continue
        if ch == "'":
            in_single = True
            i += 1
            continue
        if ch == '"':
            in_double = True
            i += 1
            continue
        if ch == "`":
            in_template = True
            i += 1
            continue
        if ch == "/" and nxt == "/":
            lines_with_comments.append(line)
            while i < n and content[i] != "\n":
                i += 1
            continue
        if ch == "/" and nxt == "*":
            lines_with_comments.append(line)
            i += 2
            while i + 1 < n and not (content[i] == "*" and content[i + 1] == "/"):
                if content[i] == "\n":
                    line += 1
                i += 1
            i += 2
            continue
        if ch == "/":
            prev_idx = i - 1
            while prev_idx >= 0 and content[prev_idx] in " \t\r\n":
                prev_idx -= 1
            prev_ch = content[prev_idx] if prev_idx >= 0 else ""
            if prev_ch in ("", "(", "[", "{", ",", "=", ":", ";", "!", "&", "|", "?", "\n"):
                j = i + 1
                rx_escaped = False
                in_class = False
                while j < n and content[j] != "\n":
                    rc = content[j]
                    if rx_escaped:
                        rx_escaped = False
                    elif rc == "\\":
                        rx_escaped = True
                    elif rc == "[":
                        in_class = True
                    elif rc == "]" and in_class:
                        in_class = False
                    elif rc == "/" and not in_class:
                        i = j + 1
                        break
                    j += 1
                else:
                    i += 1
                continue
        i += 1
    return lines_with_comments


def _verify_ts_source_rules() -> None:
    for path in sorted(SRC_DIR.rglob("*.ts")):
        text = path.read_text(encoding="utf-8")
        line_count = len(text.splitlines())
        rel = path.relative_to(ROOT).as_posix()
        if line_count > MAX_FILE_LINES:
            raise RuntimeError(f"Arquivo excede {MAX_FILE_LINES} linhas: {rel} ({line_count})")
        if not path.name.endswith(".d.ts"):
            comment_lines = has_ts_comments(text)
            if comment_lines:
                raise RuntimeError(f"Comentarios proibidos em {rel}: linhas {comment_lines}")

    doc_and_code = [
        *sorted(SRC_DIR.rglob("*.ts")),
        *sorted(TESTS_DIR.rglob("*.ts")),
        *sorted((ROOT / "docs").rglob("*.md")),
        ROOT / "README.md",
        ROOT / "AGENTS.md",
    ]
    check_no_emojis(doc_and_code)


def _verify_markdown_links() -> None:
    md_link_rx = re.compile(r"(?<!!)\[[^\]]+\]\(([^)]+)\)")
    md_files = [
        p
        for p in ROOT.rglob("*.md")
        if "node_modules" not in p.parts
        and "dist" not in p.parts
        and "coverage" not in p.parts
        and ".venv" not in p.parts
    ]
    for md_path in sorted(md_files):
        in_fence = False
        for line_no, raw_line in enumerate(md_path.read_text(encoding="utf-8").splitlines(), start=1):
            if raw_line.strip().startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence:
                continue
            for match in md_link_rx.finditer(raw_line):
                target = match.group(1).split("#", 1)[0].strip()
                if not target or target.startswith(("http://", "https://", "mailto:", "file://")):
                    continue
                resolved = (md_path.parent / target).resolve()
                if not resolved.exists():
                    rel = md_path.relative_to(ROOT).as_posix()
                    raise RuntimeError(f"Link Markdown quebrado em {rel}:{line_no} -> {target}")


def run_stage(stage: str, coverage_fail_under: int = 100, light_clean: bool = False) -> None:
    if stage == "lint":
        print("=== [TypeScript | Lint] ===")
        _verify_ts_source_rules()
        run_cmd(["npx", "tsc", "--noEmit"])
        run_cmd(["npx", "eslint", "src", "tests"])
        return

    if stage == "security":
        print("=== [TypeScript | Seguranca] ===")
        src_ts = sorted(SRC_DIR.rglob("*.ts"))
        tests_ts = sorted(TESTS_DIR.rglob("*.ts"))
        check_secrets_and_prod(src_ts, check_prod=True, allowed_prod_files=ALLOWED_PROD_BLOCKLIST_FILES)
        check_secrets_and_prod(tests_ts, check_prod=False)
        run_cmd(["npm", "audit", "--omit=dev", "--audit-level=high"])
        return

    if stage == "test":
        print("=== [TypeScript | Testes] ===")
        if coverage_fail_under < 100:
            raise RuntimeError("Cobertura minima nao pode ser inferior a 100%")
        run_cmd(["npx", "vitest", "run", "--coverage"])
        for scenario in sorted((SRC_DIR / "presentation" / "scenarios").glob("*.ts")):
            if scenario.name.startswith("_"):
                continue
            run_cmd(["k6", "inspect", scenario.relative_to(ROOT).as_posix()])
        smoke_rel = "src/presentation/scenarios/smoke.ts"
        proc = run_cmd(["k6", "inspect", "-e", "TARGET_ENV=prod_alb", smoke_rel], allow_fail=True)
        if proc.returncode == 0 or "ABORTADO [ANTI-PROD]" not in (proc.stdout + proc.stderr):
            raise RuntimeError("Falha na verificacao anti-PROD via k6 inspect")
        return

    if stage == "validate":
        print("=== [TypeScript | Validate] ===")
        for json_path in (
            ROOT / "package.json",
            ROOT / "tsconfig.json",
            ROOT / "tsconfig.build.json",
            ROOT / "data" / "hml-dataset.json",
            ROOT / "data" / "fanbase-model.json",
        ):
            json.loads(json_path.read_text(encoding="utf-8"))

        for req in (
            ROOT / "README.md",
            ROOT / "AGENTS.md",
            ROOT / ".env.example",
            ROOT / "docs" / "README.md",
            ROOT / "docs" / "arquitetura.md",
            ROOT / "docs" / "structure.md",
            ROOT / "docs" / "engineering-typescript.md",
            ROOT / "docs" / "engineering-logging.md",
            ROOT / "docs" / "infra-docker.md",
            ROOT / "docs" / "devops.md",
            ROOT / "docs" / "recon-hml.md",
            ROOT / "src" / "README.md",
            ROOT / "tests" / "README.md",
            ROOT / "tests" / "integration" / "README.md",
        ):
            if not req.is_file():
                raise RuntimeError(f"Arquivo estrutural ausente: {req.relative_to(ROOT).as_posix()}")
        _verify_markdown_links()
        return

    if stage == "build":
        print("=== [TypeScript | Build] ===")
        run_cmd(["npx", "tsc", "-p", "tsconfig.build.json"])
        return

    if stage == "clean":
        print("=== [TypeScript | Clean] ===")
        targets = [ROOT / "coverage", ROOT / ".pytest_cache"]
        if not light_clean:
            targets.append(ROOT / "dist")
        for folder in targets:
            if folder.exists():
                shutil.rmtree(folder)
        for pycache in ROOT.rglob("__pycache__"):
            if "node_modules" not in pycache.parts and ".venv" not in pycache.parts:
                shutil.rmtree(pycache)
        return

    raise ValueError(f"Estagio desconhecido: {stage}")
