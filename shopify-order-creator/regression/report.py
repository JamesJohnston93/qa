"""
Run reports: JSON artifact (diffable between runs) + markdown summary.

The JSON is the consistency signal: --repeat N runs the identical set N times
and diffs the *stable signatures* of each run (pass/fail + failing check per
case, excluding volatile fields like order ids and timings). Any variance
between identical runs is flagged — that's the race-condition detector.
"""

import json
import os
from datetime import datetime, timezone


def stable_signature(run_result: dict) -> dict:
    """Deterministic view of a run: what should be identical across repeats."""
    return {
        r["case"]: {
            "passed": r["passed"],
            "failed_check": (r["error"] or {}).get("check"),
        }
        for r in run_result["cases"]
    }


def diff_repeats(runs: list[dict]) -> dict:
    """
    Compares stable signatures across repeated identical runs.
    Returns {"consistent": bool, "variance": {case: [per-run signature]}}.
    """
    signatures = [stable_signature(r) for r in runs]
    variance = {}
    for case in signatures[0]:
        seen = [s.get(case) for s in signatures]
        if any(v != seen[0] for v in seen):
            variance[case] = seen
    return {"consistent": not variance, "variance": variance}


def write_reports(config, runs: list[dict], out_dir: str | None = None) -> dict:
    """Writes <stamp>.json and <stamp>.md. Returns paths + verdict."""
    out = out_dir or config.report_dir
    os.makedirs(out, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    base = os.path.join(out, f"regression_{config.store}_{stamp}")

    repeat_diff = diff_repeats(runs) if len(runs) > 1 else {"consistent": True, "variance": {}}
    all_passed = all(r["passed"] for r in runs)
    verdict = all_passed and repeat_diff["consistent"]

    payload = {
        "store": config.store,
        "timestamp": stamp,
        "repeat": len(runs),
        "passed": verdict,
        "repeat_consistent": repeat_diff["consistent"],
        "variance": repeat_diff["variance"],
        "runs": runs,
    }
    json_path = base + ".json"
    with open(json_path, "w") as f:
        json.dump(payload, f, indent=2, default=str)

    md_path = base + ".md"
    with open(md_path, "w") as f:
        f.write(_markdown(payload))

    return {"json": json_path, "markdown": md_path, "passed": verdict}


def _markdown(payload: dict) -> str:
    lines = [
        f"# Regression run — {payload['store']} — {payload['timestamp']}",
        "",
        f"**Verdict: {'PASS' if payload['passed'] else 'FAIL'}**"
        + (f" · {payload['repeat']} repeats, "
           f"{'consistent' if payload['repeat_consistent'] else 'VARIANCE DETECTED'}"
           if payload["repeat"] > 1 else ""),
        "",
    ]

    if payload["variance"]:
        lines += ["## ⚠ Repeat variance (race-condition signal)", ""]
        for case, seen in payload["variance"].items():
            lines.append(f"- **{case}**: " + " | ".join(str(s) for s in seen))
        lines.append("")

    for i, run in enumerate(payload["runs"], 1):
        if payload["repeat"] > 1:
            lines += [f"## Run {i}", ""]
        lines += [
            "| Case | Order | Result | Stage timings (s) | Failure |",
            "| --- | --- | --- | --- | --- |",
        ]
        for r in run["cases"]:
            timings = ", ".join(f"{s['name']}={s['elapsed']}" for s in r["stages"])
            if r["passed"]:
                failure = ""
            elif r["error"]:
                e = r["error"]
                failure = (f"`{e['check']}` expected {e['expected']!r} "
                           f"got {e['actual']!r} {e.get('detail', '')}")
            else:
                failure = "unknown"
            status = "✅ pass" if r["passed"] else "❌ fail"
            lines.append(
                f"| {r['case']} | {r['order_name'] or '—'} | {status} | {timings} | {failure} |"
            )
        lines.append("")

    lines += [
        "---",
        "_Stage timings feed PollWindows tuning (regression/config.py). "
        "A stage passing near its timeout is a drift signal._",
    ]
    return "\n".join(lines)
