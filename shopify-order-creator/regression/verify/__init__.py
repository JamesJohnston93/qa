"""
Assertion helpers. Every failure raises VerificationError carrying expected
vs actual from each system — reports include enough evidence to raise a
defect without re-running.
"""


class VerificationError(AssertionError):
    def __init__(self, check: str, expected, actual, detail: str = ""):
        self.check = check
        self.expected = expected
        self.actual = actual
        self.detail = detail
        super().__init__(
            f"{check}: expected {expected!r}, got {actual!r}"
            + (f" — {detail}" if detail else "")
        )

    def to_dict(self) -> dict:
        return {
            "check": self.check,
            "expected": self.expected,
            "actual": self.actual,
            "detail": self.detail,
        }
