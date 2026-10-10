"""Refit registered ModelTrace banks, record held-out metrics, and sync clients."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path

# Set before importing NumPy through bank_builder.
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")
REPOSITORY = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPOSITORY))

import bank_builder
from rebuild_unified_bank import SOURCES


def encode(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--family", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--report", type=Path, required=True, help="JSON report outside canonical reference files")
    parser.add_argument("--dry-run", action="store_true", help="Only write the report; leave all banks and assets untouched")
    args = parser.parse_args()
    if args.family not in SOURCES:
        parser.error("Register the family in rebuild_unified_bank.SOURCES first")
    rows = []
    reference_hashes = {}
    for family_id, (family_name, path) in SOURCES.items():
        rows.extend({**row, "family_id": family_id, "family_name": family_name} for row in bank_builder.read_rows(path))
        reference_hashes[str(path.relative_to(REPOSITORY))] = hashlib.sha256(path.read_bytes()).hexdigest()
    owners: dict[str, set[str]] = {}
    for row in rows:
        owners.setdefault(row["source"], set()).add(row["family_id"])
    if any(len(families) > 1 for families in owners.values()):
        parser.error("Model labels must be unique across all families")
    if owners.get(args.model) != {args.family}:
        parser.error("Requested model is absent from the registered family")
    bank_path = REPOSITORY / "data" / "unified_bank.json"
    family_path = REPOSITORY / "data" / f"{args.family}_bank.json"
    copies = [REPOSITORY / "static" / "data" / "unified_bank.json", REPOSITORY / "web" / "public" / "data" / "unified_bank.json"]
    protected = {path.resolve() for _, path in SOURCES.values()}
    protected.update(path.resolve() for path in [bank_path, family_path, *copies])
    if args.report.resolve() in protected or REPOSITORY in args.report.resolve().parents:
        parser.error("Write the validation report outside the repository")
    validation = {}
    original = bank_builder.calibration_records

    def capture(input_rows: list[dict], model_ids: list[str], query_count: int) -> list:
        records = original(input_rows, model_ids, query_count)
        target = model_ids.index(args.model)
        positive_predictions = Counter()
        false_positives = 0
        negative_groups = 0
        for scores, truth in records:
            predicted = max(range(len(scores)), key=scores.__getitem__)
            if truth == target:
                positive_predictions[model_ids[predicted]] += 1
            else:
                negative_groups += 1
                false_positives += predicted == target
        total = sum(positive_predictions.values())
        correct = positive_predictions[args.model]
        validation[str(query_count)] = {
            "correct": correct, "total": total, "recall": correct / total if total else None,
            "predictions_for_target": dict(positive_predictions),
            "false_positives": false_positives, "negative_groups": negative_groups,
        }
        print(json.dumps({"queries": query_count, **validation[str(query_count)]}), flush=True)
        return records

    bank_builder.calibration_records = capture
    try:
        unified = bank_builder.build_bank(rows)
    finally:
        bank_builder.calibration_records = original
    family_bank = bank_builder.build_bank([row for row in rows if row["family_id"] == args.family])
    unified_text = encode(unified)
    family_text = encode(family_bank)
    report = {
        "model": args.model, "family": args.family, "dry_run": args.dry_run,
        "built_at": unified["built_at"], "reference_sha256": reference_hashes,
        "unified_bank_sha256": hashlib.sha256(unified_text.encode()).hexdigest(),
        "target_held_out": validation, "global_calibration": unified["calibration"],
        "scope": "Grouped held-out evaluation on saved references; overlapping groups are not independent trials; no new endpoint sampling.",
    }
    if not args.dry_run:
        family_path.write_text(family_text, encoding="utf-8")
        bank_path.write_text(unified_text, encoding="utf-8")
        for path in copies:
            shutil.copyfile(bank_path, path)
        subprocess.run(["node", "codex-plugin/build-plugin.mjs"], cwd=REPOSITORY, check=True)
        plugin_bank = REPOSITORY / "codex-plugin" / "modeltrace-guard" / "assets" / "unified_bank.json"
        if any(path.read_bytes() != bank_path.read_bytes() for path in [*copies, plugin_bank]):
            raise RuntimeError("Client bank copies do not match")
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(encode(report), encoding="utf-8")
    print(json.dumps({"status": "complete", "dry_run": args.dry_run, "report": str(args.report)}))


if __name__ == "__main__":
    main()
