const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { reportsToPrune, pruneReports, REPORT_RETENTION } = require('../dist/report.js');

/** Report filename pair for one run, as writeReports() names them. */
function pair(store, stamp) {
  return [`regression_${store}_${stamp}.md`, `regression_${store}_${stamp}.json`];
}

/** n runs' worth of filenames, oldest first, stamps ascending within one day. */
function runs(store, n, startMinute = 0) {
  const names = [];
  for (let i = 0; i < n; i += 1) {
    const minute = String(startMinute + i).padStart(2, '0');
    names.push(...pair(store, `20260806T00${minute}00Z`));
  }
  return names;
}

test('reportsToPrune keeps everything when at or under the retention limit', () => {
  assert.deepEqual(reportsToPrune(runs('US', REPORT_RETENTION), REPORT_RETENTION), []);
  assert.deepEqual(reportsToPrune(runs('US', 3), REPORT_RETENTION), []);
  assert.deepEqual(reportsToPrune([], REPORT_RETENTION), []);
});

test('reportsToPrune drops the oldest runs and keeps both files of each surviving run', () => {
  const doomed = reportsToPrune(runs('US', 12), REPORT_RETENTION);
  // 12 runs, keep 10 -> the 2 oldest runs go, md + json each.
  assert.equal(doomed.length, 4);
  assert.deepEqual(
    doomed,
    [
      'regression_US_20260806T000000Z.json',
      'regression_US_20260806T000000Z.md',
      'regression_US_20260806T000100Z.json',
      'regression_US_20260806T000100Z.md',
    ],
  );
});

test('reportsToPrune counts a run once even if only one of its two files is present', () => {
  const names = [...runs('US', 10), 'regression_US_20260806T005900Z.md'];
  // 11 runs total, so only the single oldest run is pruned - and the lone
  // orphaned .md of the newest run must survive as one of the kept 10.
  const doomed = reportsToPrune(names, REPORT_RETENTION);
  assert.deepEqual(doomed, [
    'regression_US_20260806T000000Z.json',
    'regression_US_20260806T000000Z.md',
  ]);
});

test('reportsToPrune treats US and PS runs as one shared pool, ordered by stamp', () => {
  // Interleaved stores: retention is per-directory, not per-store, so the
  // oldest stamps go regardless of which store produced them.
  const names = [
    ...pair('US', '20260806T000000Z'),
    ...pair('PS', '20260806T000100Z'),
    ...pair('US', '20260806T000200Z'),
  ];
  const doomed = reportsToPrune(names, 2);
  assert.deepEqual(doomed, [
    'regression_US_20260806T000000Z.json',
    'regression_US_20260806T000000Z.md',
  ]);
});

test('reportsToPrune ignores files that are not generated reports', () => {
  const names = [
    ...runs('US', 12),
    'regression-report.md', // the old dry-run sample
    'regression-report.json',
    'notes.md',
    'regression_US_bad-stamp.md',
    'README.md',
  ];
  const doomed = reportsToPrune(names, REPORT_RETENTION);
  for (const name of doomed) {
    assert.match(name, /^regression_[A-Z]+_\d{8}T\d{6}Z\.(md|json)$/);
  }
  assert.equal(doomed.length, 4);
});

test('pruneReports deletes the right files on disk and leaves the rest alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-'));
  const names = [...runs('US', 12), 'regression-report.md', 'notes.md'];
  for (const name of names) {
    fs.writeFileSync(path.join(dir, name), 'x');
  }

  const deleted = pruneReports(dir, REPORT_RETENTION);
  assert.equal(deleted.length, 4);

  const left = fs.readdirSync(dir).sort();
  assert.ok(left.includes('regression-report.md'), 'dry-run sample must survive');
  assert.ok(left.includes('notes.md'), 'unrelated files must survive');
  assert.ok(!left.includes('regression_US_20260806T000000Z.md'), 'oldest run must be gone');
  assert.ok(left.includes('regression_US_20260806T001100Z.md'), 'newest run must survive');
  // 24 report files - 4 pruned + 2 unrelated = 22
  assert.equal(left.length, 22);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('pruneReports is a no-op on a missing directory rather than throwing', () => {
  const missing = path.join(os.tmpdir(), 'reports-does-not-exist-12345');
  assert.deepEqual(pruneReports(missing, REPORT_RETENTION), []);
});
