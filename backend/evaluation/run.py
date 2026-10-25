"""Measure OCR and field extraction on the synthetic fixtures.

Run from backend/ with Ollama running: .venv/bin/python -m evaluation.run [--json out.json]
"""
import argparse
import json
import re
import sys
import tempfile
import time
from pathlib import Path
from typing import List, Optional

from evaluation.fixtures import FIXTURES, Expected, Fixture, ground_truth_text
from services.fields import extract_fields
from services.pipeline import read_text


def normalize(value: str) -> str:
    return " ".join(re.sub(r"[^0-9a-z.]+", " ", value.casefold()).replace(" .", " ").split()).strip(".")


def character_error_rate(predicted: str, truth: str) -> float:
    left = " ".join(re.sub(r"\[Page \d+\]", " ", predicted).casefold().split())
    right = " ".join(truth.casefold().split())
    previous = list(range(len(right) + 1))
    for i, char in enumerate(left, start=1):
        current = [i]
        for j, other in enumerate(right, start=1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (char != other)))
        previous = current
    return previous[-1] / max(1, len(right))


def _candidates(field) -> List[str]:
    values = [field.extracted_value, getattr(field, "normalized_value", None)]
    return [normalize(value) for value in values if value]


def _matches(field, expected: Expected) -> bool:
    wanted = {normalize(value) for value in expected.values}
    return any(candidate in wanted for candidate in _candidates(field))


def _subject_pairs(fields) -> set:
    pairs = set()
    for field in fields:
        if field.field_name != "subjects":
            continue
        for item in json.loads(field.extracted_value):
            pairs.add((normalize(item["subject"]), normalize(item.get("marks") or "")))
    return pairs


def score(fixture: Fixture, fields) -> dict:
    found, page_hits, page_total, role_hits, role_total = 0, 0, 0, 0, 0
    checked_names = {item.field_name for item in fixture.expected if item.field_name}
    for expected in fixture.expected:
        pool = [f for f in fields if f.field_name == expected.field_name] if expected.field_name else fields
        match: Optional[object] = next((f for f in pool if _matches(f, expected)), None)
        if match is None:
            continue
        found += 1
        if expected.page is not None:
            page_total += 1
            page_hits += getattr(match, "page_number", None) == expected.page
        if expected.date_roles:
            role_total += 1
            role_hits += getattr(match, "date_role", None) in expected.date_roles
    predicted_checked = [f for f in fields if f.field_name in checked_names]
    wrong = sum(
        1
        for f in predicted_checked
        if not any(_matches(f, e) for e in fixture.expected if e.field_name == f.field_name)
    )
    truth_pairs = {(normalize(s), normalize(m)) for s, m in fixture.subjects.items()}
    got_pairs = _subject_pairs(fields)
    return {
        "expected": len(fixture.expected),
        "found": found,
        "checked_predictions": len(predicted_checked),
        "wrong_predictions": wrong,
        "subjects_expected": len(truth_pairs),
        "subjects_found": len(truth_pairs & got_pairs),
        "subjects_extra": len(got_pairs - truth_pairs),
        "page_hits": page_hits,
        "page_total": page_total,
        "role_hits": role_hits,
        "role_total": role_total,
        "fields_returned": len(fields),
    }


def run_fixture(fixture: Fixture, folder: Path) -> dict:
    path = fixture.render(fixture, folder)
    started = time.monotonic()
    result = read_text(str(path), fixture.media_type)
    read_seconds = time.monotonic() - started
    text = str(result["text"])
    started = time.monotonic()
    outcome = extract_fields(fixture.document_type, text, fixture.document_label)
    extract_seconds = time.monotonic() - started
    row = {
        "name": fixture.name,
        "ocr_cer": round(character_error_rate(text, ground_truth_text(fixture)), 3)
        if fixture.media_type.startswith("image/")
        else None,
        "status": outcome.status,
        "error": outcome.error,
        "read_seconds": round(read_seconds, 1),
        "extract_seconds": round(extract_seconds, 1),
    }
    row.update(score(fixture, outcome.fields))
    return row


def _ratio(hits: int, total: int) -> str:
    return "  -  " if total == 0 else "{:5.2f}".format(hits / total)


def report(rows: List[dict]) -> dict:
    header = "{:28} {:>6} {:>7} {:>7} {:>7} {:>6} {:>6} {:>7}".format(
        "fixture", "CER", "recall", "precis", "subj", "page", "role", "seconds"
    )
    print(header)
    print("-" * len(header))
    for row in rows:
        checked = row["checked_predictions"]
        print(
            "{:28} {:>6} {:>7} {:>7} {:>7} {:>6} {:>6} {:>7}".format(
                row["name"][:28],
                "  -  " if row["ocr_cer"] is None else "{:.3f}".format(row["ocr_cer"]),
                _ratio(row["found"], row["expected"]),
                _ratio(checked - row["wrong_predictions"], checked),
                _ratio(row["subjects_found"], row["subjects_expected"]),
                _ratio(row["page_hits"], row["page_total"]),
                _ratio(row["role_hits"], row["role_total"]),
                round(row["read_seconds"] + row["extract_seconds"], 1),
            )
            + ("  " + row["status"] + ": " + (row["error"] or "") if row["status"] != "completed" else "")
        )
    total = {key: sum(row[key] for row in rows) for key in rows[0] if isinstance(rows[0][key], int)}
    cers = [row["ocr_cer"] for row in rows if row["ocr_cer"] is not None]
    precision = (total["checked_predictions"] - total["wrong_predictions"]) / max(1, total["checked_predictions"])
    recall = total["found"] / max(1, total["expected"])
    summary = {
        "field_recall": round(recall, 3),
        "field_precision": round(precision, 3),
        "field_f1": round(2 * precision * recall / max(1e-9, precision + recall), 3),
        "subject_recall": round(total["subjects_found"] / max(1, total["subjects_expected"]), 3),
        "page_accuracy": round(total["page_hits"] / total["page_total"], 3) if total["page_total"] else None,
        "date_role_accuracy": round(total["role_hits"] / total["role_total"], 3) if total["role_total"] else None,
        "mean_ocr_cer": round(sum(cers) / len(cers), 3) if cers else None,
    }
    print("-" * len(header))
    for key, value in summary.items():
        print("{:20} {}".format(key, "-" if value is None else value))
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", type=Path, help="write per-fixture rows and the summary here")
    parser.add_argument("--only", help="run fixtures whose name contains this text")
    args = parser.parse_args()
    fixtures = [f for f in FIXTURES if not args.only or args.only in f.name]
    with tempfile.TemporaryDirectory() as folder:
        rows = [run_fixture(fixture, Path(folder)) for fixture in fixtures]
    summary = report(rows)
    if args.json:
        args.json.write_text(json.dumps({"summary": summary, "rows": rows}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
