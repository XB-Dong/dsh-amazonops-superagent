"""Validate pre-P0 specifications and repository hygiene, never product behavior."""
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = (
    "README.md", "AGENTS.md", "CONSTITUTION.md", "NEXT-WAVES.md", "THIRD-PARTY-NOTICES.md",
    "docs/README.md", "docs/product/REQUIREMENTS.zh.md", "docs/product/changes/2026-11-02.md",
    "docs/discovery/FEATURE-PARITY.zh.md", "docs/discovery/REFACTOR-ASSESSMENT.zh.md",
    "docs/discovery/UPSTREAM-SEAMS.zh.md", "docs/discovery/upstream-baseline.json",
    "docs/discovery/feature-catalog.json", "specs/architecture.md", "specs/contracts/domain-v0.1.md",
    "specs/contracts/tools-v0.1.md", "specs/security-and-isolation.md", "specs/data-and-recovery.md",
    "docs/testing/STRATEGY.zh.md", "docs/testing/acceptance.json", "docs/preparation/state.json",
    "docs/preparation/tasks.json", "docs/preparation/P0-READINESS.zh.md", "docs/preparation/COLLABORATION.zh.md",
    "docs/audit/context-maps/PREPARATION-20261102.md", "docs/audit/reviews/PREPARATION-20261102.zh.md",
    "docs/audit/reports/PREPARATION-20261102.zh.md", ".github/workflows/preparation.yml",
)
IDENTIFIER = re.compile(r"\b(?:CC|SA)-[A-Z]+(?:-[A-Z]+)*-\d{3}\b")
SHA = re.compile(r"[0-9a-f]{40}")
LINK = re.compile(r"\[[^\]\n]+\]\(([^)\n]+)\)")
PRIVATE_PATH = re.compile(r"[A-Za-z]:[/\\](?:Users|project)[/\\]", re.I)
SECRET = re.compile(r"\b(?:ghp_|github_pat_|sk-)[A-Za-z0-9_]{20,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|https?://[^\s/:]+:[^\s/@]+@")
IPV4 = re.compile(r"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])")
EXAMPLES = tuple(ipaddress.ip_network(value) for value in ("127.0.0.0/8", "192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24"))

def read_json(name: str):
    return json.loads((ROOT / name).read_text(encoding="utf-8"))

def check(final: bool) -> dict:
    errors: list[str] = []
    execution_path = ROOT / "docs/waves/P0/state.json"
    execution = json.loads(execution_path.read_text(encoding="utf-8")) if execution_path.is_file() else None
    executing = execution is not None
    for name in REQUIRED:
        if not (ROOT / name).is_file():
            errors.append(f"Missing preparation artifact: {name}")
    if errors:
        return {"check": "pre-p0-artifacts-only", "errors": errors, "productTests": "not_run"}

    catalog = read_json("docs/discovery/feature-catalog.json")
    acceptance = read_json("docs/testing/acceptance.json")
    state = read_json("docs/preparation/state.json")
    tasks = read_json("docs/preparation/tasks.json")["tasks"]
    baselines = read_json("docs/discovery/upstream-baseline.json")
    requirements = catalog["requirements"]
    required_ids = {row["id"] for row in requirements if row["scope"] == "p0_parity"}
    all_ids = {row["id"] for row in requirements}
    cases = acceptance["cases"]
    case_ids = {row["id"] for row in cases}
    if len(all_ids) != len(requirements) or len(case_ids) != len(cases):
        errors.append("Duplicate requirement or acceptance ID")
    if len(required_ids) != 20 or "CC-TASK-COPY-001" not in required_ids:
        errors.append("Incomplete full-P0 parity baseline")
    if set(row["requirementId"] for row in cases) != required_ids:
        errors.append("Acceptance coverage differs from complete P0 requirement set")
    if not {"A17-04", "A17-05"}.issubset(case_ids):
        errors.append("Missing independently reviewed source-admission or stable-operation acceptance")
    for row in requirements:
        linked = {case["id"] for case in cases if case["requirementId"] == row["id"]}
        if set(row["acceptanceIds"]) != linked:
            errors.append(f"Broken traceability: {row['id']}")
        if row["scope"] == "p0_parity" and (not linked or (not executing and row["implementationStatus"] != "not_started")):
            errors.append(f"Invalid preparation implementation state: {row['id']}")
    for row in cases:
        status = row["status"]
        if row["mandatory"] is not True or not row["expected"]:
            errors.append(f"Missing mandatory acceptance definition: {row['id']}")
        if not executing and (status != "not_run" or row["evidence"]):
            errors.append(f"Product evidence cannot be prefilled: {row['id']}")
        if executing and (status not in {"not_run", "passed", "failed", "blocked", "partial"}
                          or (status == "passed" and not row["evidence"])):
            errors.append(f"Execution result requires real evidence: {row['id']}")
    for key in ("ccagent", "superagent", "harness"):
        if not SHA.fullmatch(baselines[key]["sha"]):
            errors.append(f"Unpinned source baseline: {key}")
    if not executing and baselines["productDependenciesInstalled"] is not False:
        errors.append("Dependencies must remain uninstalled in preparation")
    expected = {"phase": "preparation_before_p0_plan", "p0PlanStatus": "not_created",
                "p0ExecutionStatus": "not_started", "productImplementationStatus": "not_started",
                "productAcceptanceStatus": "not_run", "upstreamRuntimeVerification": "not_run",
                "modelApiStatus": "not_run", "cloudAccess": "not_performed", "productionDeployment": "not_performed",
                "productionMigration": "not_performed", "legacyProjectWrites": "not_performed",
                "legacyAutomationChanges": "not_performed", "laterWaves": []}
    for key, value in expected.items():
        if state.get(key) != value:
            errors.append(f"Preparation boundary changed: {key}")
    if not executing and ((ROOT / "docs/waves/P0/PLAN.md").exists() or (ROOT / "package.json").exists()):
        errors.append("P0 execution plan and product scaffold are outside current preparation scope")
    if state["github"]["repository"] != "XB-Dong/dsh-amazonops-superagent" or state["github"]["visibility"] != "private":
        errors.append("Unexpected repository identity or visibility")
    for task in tasks:
        for field in ("id", "rootTask", "owner", "baselineSha", "specVersion", "inputBaselines", "acceptance", "repairCondition", "stopConditions", "deliverable"):
            if not task.get(field):
                errors.append(f"Incomplete dispatch: {task.get('id')}/{field}")
        if not SHA.fullmatch(task["baselineSha"]):
            errors.append(f"Invalid dispatch baseline: {task['id']}")
        if task["owner"] != "Leader" and task["allowedWritePaths"]:
            errors.append(f"Read-only agent gained writes: {task['id']}")
    if final:
        if state["preparationStatus"] != "ready_to_plan" or state["independentReview"]["status"] != "accepted":
            errors.append("Final preparation requires independent review and ready_to_plan state")
        if any(task["status"] != "completed" for task in tasks):
            errors.append("Final preparation has unfinished discovery/design/review tasks")

    output = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT)
    names = sorted(set(name.decode("utf-8") for name in output.split(b"\0") if name))
    local_links = 0
    for name in names:
        path = ROOT / name
        if not path.is_file():
            errors.append(f"Missing indexed entry: {name}")
            continue
        if path.suffix in {".db", ".sqlite", ".key", ".pem", ".pfx", ".p12", ".csv", ".xlsx"}:
            errors.append(f"Runtime/private artifact: {name}")
        if (path.name == ".env" or (path.name.startswith(".env.") and path.name != ".env.example")
                or {"runtime", "data", "sessions", "generated-skills", "worktrees", ".worktrees", "evidence", ".local"}.intersection(path.relative_to(ROOT).parts)):
            errors.append(f"Private configuration or runtime directory: {name}")
        raw = path.read_bytes()
        vendored = name.startswith("vendor/superagent/")
        if vendored:
            if SECRET.search(raw.decode("utf-8", errors="replace")):
                errors.append(f"Credential pattern in vendored source: {name}")
            continue
        try:
            content = raw.decode("utf-8")
        except UnicodeDecodeError:
            errors.append(f"Non-text preparation file: {name}")
            continue
        if b"\r" in raw or content.startswith("\ufeff") or (raw and not raw.endswith(b"\n")):
            errors.append(f"Use UTF-8 without BOM, LF and final newline: {name}")
        if any(line.rstrip() != line for line in content.splitlines()):
            errors.append(f"Trailing whitespace: {name}")
        if PRIVATE_PATH.search(content) or SECRET.search(content):
            errors.append(f"Private path or credential pattern: {name}")
        for match in IPV4.finditer(content):
            try:
                address = ipaddress.ip_address(match.group())
            except ValueError:
                continue
            if not any(address in network for network in EXAMPLES):
                errors.append(f"Non-example address: {name}")
        if path.suffix == ".json":
            try:
                json.loads(content)
            except json.JSONDecodeError:
                errors.append(f"Invalid JSON: {name}")
        if path.suffix == ".md":
            unknown = set(IDENTIFIER.findall(content)) - all_ids
            if unknown:
                errors.append(f"Unknown requirement IDs in {name}: {sorted(unknown)}")
            if len(re.findall(r"^```", content, re.M)) % 2:
                errors.append(f"Unbalanced fenced block: {name}")
            for match in LINK.finditer(content):
                target = match.group(1).strip().strip("<>")
                if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", target) or target.startswith("#"):
                    continue
                resolved = (path.parent / unquote(target.split("#", 1)[0])).resolve()
                local_links += 1
                if not resolved.is_relative_to(ROOT) or not resolved.is_file():
                    errors.append(f"Invalid local link in {name}: {target}")
    if executing:
        if execution.get("waveId") != "P0" or execution.get("phase") not in {"executing", "partial", "blocked", "completed"}:
            errors.append("Invalid P0 execution phase")
        if execution.get("cloudAccess") != "not_performed" or execution.get("legacyAutomationChanges") != "not_performed":
            errors.append("Local P0 boundary changed")
        if execution.get("laterWaves"):
            errors.append("Later waves are outside P0 authorization")
        if not (ROOT / "docs/waves/P0/PLAN.md").is_file():
            errors.append("Missing actual P0 execution plan")
        if execution.get("phase") == "completed" and any(row["status"] != "passed" for row in cases):
            errors.append("P0 cannot complete with mandatory acceptance outstanding")
        vendor = ROOT / "vendor/superagent"
        provenance = read_json("vendor/superagent/UPSTREAM.json")
        patches = read_json("vendor/superagent/patch-manifest.json")
        if provenance["sha"] != baselines["superagent"]["sha"] or patches["upstreamSha"] != provenance["sha"]:
            errors.append("Vendor provenance differs from pinned baseline")
        if not (vendor / "LICENSE").is_file() or "MIT" not in (vendor / "LICENSE").read_text(encoding="utf-8"):
            errors.append("Missing upstream MIT license")
        core = patches.get("unchangedCore", [])
        if {row["path"] for row in core} != {str(path.relative_to(vendor)).replace(chr(92), "/") for path in (vendor / "src/core").glob("*.ts")}:
            errors.append("Unchanged-core provenance inventory incomplete")
        for row in core:
            file = (vendor / row["path"]).resolve()
            if not file.is_relative_to(vendor.resolve()) or not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != row["sha256"]:
                errors.append(f"Upstream core changed without an architecture decision: {row['path']}")
        for name in patches.get("modifiedUpstreamFiles", []):
            if not (vendor / name).is_file():
                errors.append(f"Patch manifest references missing file: {name}")
    return {"check": "p0-execution-artifacts" if executing else "pre-p0-artifacts-only", "files": len(names), "localLinks": local_links,
            "p0Requirements": len(required_ids), "mandatoryCasesDesigned": len(cases),
            "productTests": "see execution evidence; this command is not a product test" if executing else "not_run", "errors": errors}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--final", action="store_true")
    args = parser.parse_args()
    result = check(args.final)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(bool(result["errors"]))
