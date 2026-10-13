const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "../js/miningcore.js"), "utf8");

// Exercise the existing page loaders with mocked API responses and DOM writes.
function page(response) {
  const writes = new Map();
  const $ = selector => ({
    text: value => writes.set(selector, String(value)),
    html: value => writes.set(selector, value),
  });
  $.each = (items, callback) => items.forEach((item, index) => callback(index, item));
  $.ajax = () => ({
    done(callback) {
      callback(response);
      return this;
    },
    fail() { return this; },
  });
  const context = vm.createContext({
    $, console: { log() {} },
    window: { location: { protocol: "https:", hostname: "example.test", href: "" } },
    navigator: { userAgent: "test" },
  });
  vm.runInContext(source, context);
  context.currentPool = "pool";
  return { context, writes };
}

const examples = [
  [0, "0%"],
  [-0, "0%"],
  [0.001, "0.1%"],
  [0.000001, "0.0001%"],
  [0.0000001, "<0.0001%"],
  [Number.MIN_VALUE, "<0.0001%"],
  [0.004999, "0.4999%"],
  [1, "100%"],
  [1.5, "150%"],
  [12.345678, "1234.5678%"],
  [undefined, "n/a"],
  [null, "n/a"],
  [NaN, "n/a"],
  [Infinity, "n/a"],
  [-Infinity, "n/a"],
  [-0.1, "n/a"],
  ["0.001", "n/a"],
  ["", "n/a"],
  [false, "n/a"],
  [Number.MAX_VALUE, "n/a"],
];

for (const [ratio, expected] of examples) {
  test(`pool stats: ${String(ratio)} displays ${expected}`, () => {
    const { context, writes } = page({ pools: [{
      id: "pool", poolEffort: ratio,
      networkStats: { blockHeight: 1, connectedPeers: 1, networkHashrate: 1, networkDifficulty: 1 },
      poolStats: { poolHashrate: 1, connectedMiners: 1 },
      paymentProcessing: { minimumPayment: 1, payoutScheme: "SOLO" },
      poolFeePercent: 1, coin: { type: "BTC" },
    }] });
    context.loadStatsData();
    assert.equal(writes.get("#poolEffort"), expected);
  });
}

function block(effort) {
  return {
    effort, created: "2026-10-13T00:00:00Z", blockHeight: 1,
    infoLink: "https://example.test/block/1", status: "confirmed",
    reward: 1, confirmationProgress: 1,
  };
}

test("block table uses the same formatting and escapes the tiny-value indicator", () => {
  const { context, writes } = page(examples.map(([ratio]) => block(ratio)));
  context.loadBlocksPage();
  const cells = [...writes.get("#blockList").matchAll(/<tr>(.*?)<\/tr>/g)]
    .map(row => [...row[1].matchAll(/<td(?: class='[^']*')?>(.*?)<\/td>/g)][2][1]);
  assert.deepEqual(cells, examples.map(([, expected]) => expected.replace("<", "&lt;")));
});

test("block colors use unrounded percentages and missing effort has no color", () => {
  const cases = [
    [0.2999999, "effort1"], [0.3, "effort2"],
    [0.7999999, "effort2"], [0.8, "effort3"],
    [1.0999999, "effort3"], [1.1, "effort4"], [1.5, "effort4"],
    [null, null], [undefined, null], [NaN, null], ["0.1", null],
  ];
  const { context, writes } = page(cases.map(([ratio]) => block(ratio)));
  context.loadBlocksPage();
  const colors = [...writes.get("#blockList").matchAll(/<tr>(.*?)<\/tr>/g)]
    .map(row => [...row[1].matchAll(/<td(?: class='([^']*)')?>(.*?)<\/td>/g)][2][1] || null);
  assert.deepEqual(colors, cases.map(([, color]) => color));
});

test("empty block list retains its existing message", () => {
  const { context, writes } = page([]);
  context.loadBlocksPage();
  assert.match(writes.get("#blockList"), /No blocks found yet/);
});
