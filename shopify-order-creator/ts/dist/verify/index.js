"use strict";
/**
 * Assertion helpers. Every failure throws VerificationError carrying
 * expected vs actual from each system — reports include enough evidence to
 * raise a defect without re-running. Ports regression/verify/__init__.py.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VerificationError = void 0;
class VerificationError extends Error {
    check;
    expected;
    actual;
    detail;
    constructor(check, expected, actual, detail = "") {
        super(`${check}: expected ${describe(expected)}, got ${describe(actual)}` + (detail ? ` — ${detail}` : ""));
        this.name = "VerificationError";
        this.check = check;
        this.expected = expected;
        this.actual = actual;
        this.detail = detail;
    }
    toDict() {
        return { check: this.check, expected: this.expected, actual: this.actual, detail: this.detail };
    }
}
exports.VerificationError = VerificationError;
function describe(value) {
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
