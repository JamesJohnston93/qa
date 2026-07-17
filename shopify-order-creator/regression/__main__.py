"""
Entry point:

    python -m regression [--cases single,multi] [--store US|PS] [--repeat N]
                         [--report-dir DIR] [--quiet] [--list]

Exit codes: 0 = all cases passed and repeats consistent; 1 = any failure or
repeat variance; 2 = configuration/environment error.

Requires: US_ACCESS_TOKEN / PS_ACCESS_TOKEN, AWS creds for profile 'staging'
(aws sso login --profile staging).
"""

import argparse
import sys


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m regression", description=__doc__)
    parser.add_argument("--cases", help="comma-separated case names (default: all)")
    parser.add_argument("--store", default="US", choices=["US", "PS"])
    parser.add_argument("--repeat", type=int, default=1,
                        help="run the identical set N times and diff results (variance = flagged inconsistency)")
    parser.add_argument("--report-dir", default=None)
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--list", action="store_true", help="list available cases and exit")
    args = parser.parse_args()

    from regression.config import RegressionConfig
    config = RegressionConfig(store=args.store, repeat=args.repeat, verbose=not args.quiet)
    if args.report_dir:
        config.report_dir = args.report_dir

    try:
        config.validate()
        if args.list:
            from regression.cases import build_cases
            for name, case in build_cases(config).items():
                print(f"  {name:24} {case.description}")
            return 0

        from regression import report, runner
        case_names = args.cases.split(",") if args.cases else None

        runs = []
        for i in range(config.repeat):
            if config.verbose and config.repeat > 1:
                print(f"\n######## repeat {i + 1}/{config.repeat} ########")
            runs.append(runner.run(config, case_names))

        paths = report.write_reports(config, runs)
        print(f"\nReport: {paths['markdown']}")
        print(f"JSON:   {paths['json']}")
        print("PASS" if paths["passed"] else "FAIL")
        return 0 if paths["passed"] else 1

    except KeyError as e:
        print(f"Missing environment variable: {e}. See regression/__main__.py docstring.")
        return 2
    except Exception as e:
        print(f"Configuration/environment error: {type(e).__name__}: {e}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
