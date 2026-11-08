import { test } from "node:test";
import assert from "node:assert/strict";
import { addShare } from "../lib/shared/allocation.ts";

const direct = (id: string) => id === "usdc-sol";

test("adding a token fills only the uncovered gap and keeps existing shares", () => {
  assert.deepEqual(addShare({ "usdc-sol": 1000 }, 2000, "eth-base", 2000, direct), { "usdc-sol": 1000, "eth-base": 1000 });
});

test("a token that cannot cover the whole gap adds what it can", () => {
  assert.deepEqual(addShare({ "usdc-sol": 1000 }, 2000, "eth-base", 400, direct), { "usdc-sol": 1000, "eth-base": 400 });
});

test("when fully covered, the smallest routed share is displaced before direct USDC", () => {
  const next = addShare({ "usdc-sol": 1000, "sol-sol": 300, "pol-pol": 700 }, 2000, "eth-base", 500, direct);
  assert.deepEqual(next, { "usdc-sol": 1000, "pol-pol": 500, "eth-base": 500 });
});

test("direct USDC is displaced only when routed shares are not enough", () => {
  assert.deepEqual(addShare({ "usdc-sol": 1800, "sol-sol": 200 }, 2000, "eth-base", 500, direct), { "usdc-sol": 1500, "eth-base": 500 });
});

test("re-adding an existing token replaces its share instead of double counting", () => {
  assert.deepEqual(addShare({ "usdc-sol": 1000, "eth-base": 1000 }, 2000, "eth-base", 1000, direct), { "usdc-sol": 1000, "eth-base": 1000 });
});

test("shares never exceed the remaining amount", () => {
  const next = addShare({}, 2000, "eth-base", 999_999, direct);
  assert.equal(Object.values(next).reduce((sum, value) => sum + value, 0), 2000);
});
