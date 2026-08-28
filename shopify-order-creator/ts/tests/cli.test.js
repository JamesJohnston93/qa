const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../dist/cli.js');
const { buildCases } = require('../dist/cases/baselineCases.js');
const { buildNewStoreCases } = require('../dist/cases/newstoreCases.js');

// TAA-39/TAA-31 (slice F/G): pins the default case set cli.ts's
// --help/--list-cases describe as "all 12" — a case added/removed/renamed
// without updating those two hardcoded surfaces (the exact defect fixed
// 2026-08-06 for `unique`/`partial_undeliverable`) fails loudly here instead
// of only being caught by a reviewer running --help.
test('the default case set (pipeline + fulfilment + reject + NewStore) is exactly 12 cases, matching printHelp\'s "all 12" claim', () => {
  const names = [...Object.keys(buildCases('US')), ...Object.keys(buildNewStoreCases('US'))];
  assert.deepEqual(names, [
    'single', 'multi', 'unique', 'split', 'undeliverable', 'partial_undeliverable',
    'fulfil_single', 'fulfil_split', 'reject_reallocate', 'reject_undeliverable', 'ns_sfs', 'ns_otc',
  ]);
  assert.equal(names.length, 12);
});

// TAA-14 decision, implemented 2026-08-06: parallel case execution is the
// default, and --sequential is the opt-out. Both stores have disjoint 14-SKU
// pools, and parallel runs are proven byte-identical to sequential ones, so
// the fast path is the safe one. These tests pin that contract down - flipping
// it back by accident would silently change what every bare invocation does.

test('parallel is on by default, so a bare invocation runs the fast path', () => {
  assert.equal(parseArgs([]).parallel, true);
  assert.equal(parseArgs(['--store', 'PS']).parallel, true);
});

test('--sequential opts out of parallel execution', () => {
  assert.equal(parseArgs(['--sequential']).parallel, false);
  assert.equal(parseArgs(['--store', 'PS', '--sequential', '--repeat', '3']).parallel, false);
});

test('--parallel is still accepted so existing scripts and docs keep working', () => {
  assert.equal(parseArgs(['--parallel']).parallel, true);
  assert.equal(parseArgs(['--parallel', '--repeat', '3']).parallel, true);
});

test('the later of --parallel / --sequential wins, so an override can be appended', () => {
  // Matters because wrappers tend to append flags to a fixed base command.
  assert.equal(parseArgs(['--parallel', '--sequential']).parallel, false);
  assert.equal(parseArgs(['--sequential', '--parallel']).parallel, true);
});

test('--concurrency is independent of how parallelism was selected', () => {
  assert.equal(parseArgs(['--concurrency', '2']).parallelConcurrency, 2);
  assert.equal(parseArgs(['--concurrency', '2']).parallel, true);
  // Still parsed when sequential, so switching modes doesn't lose the value.
  assert.equal(parseArgs(['--sequential', '--concurrency', '6']).parallelConcurrency, 6);
});

test('other flags still parse alongside the new one', () => {
  const config = parseArgs([
    '--store', 'PS',
    '--cases', 'single,ns_sfs',
    '--repeat', '3',
    '--sequential',
    '--report-dir', './out',
    '--quiet',
  ]);
  assert.equal(config.store, 'PS');
  assert.deepEqual(config.caseNames, ['single', 'ns_sfs']);
  assert.equal(config.repeat, 3);
  assert.equal(config.parallel, false);
  assert.equal(config.reportDir, './out');
  assert.equal(config.verbose, false);
});
