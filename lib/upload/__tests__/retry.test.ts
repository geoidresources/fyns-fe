import assert from "node:assert/strict";
import { test } from "node:test";

import { withRetry } from "../retry.ts";

// No real timers — every test injects an instant `sleep`.
const noSleep = async () => {};

function apiError(status: number): Error & { status: number } {
  return Object.assign(new Error(`http ${status}`), { status });
}

test("resolves without retrying when the call succeeds", async () => {
  let calls = 0;
  const out = await withRetry(
    async () => {
      calls++;
      return "ok";
    },
    { sleep: noSleep }
  );
  assert.equal(out, "ok");
  assert.equal(calls, 1);
});

test("retries a 5xx and returns the eventual success", async () => {
  let calls = 0;
  const out = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw apiError(503);
      return "recovered";
    },
    { sleep: noSleep }
  );
  assert.equal(out, "recovered");
  assert.equal(calls, 3);
});

test("retries a bare network error (no status)", async () => {
  let calls = 0;
  const out = await withRetry(
    async () => {
      calls++;
      if (calls < 2) throw new TypeError("Failed to fetch");
      return "recovered";
    },
    { sleep: noSleep }
  );
  assert.equal(out, "recovered");
  assert.equal(calls, 2);
});

test("retries a 408 request timeout", async () => {
  let calls = 0;
  await withRetry(
    async () => {
      calls++;
      if (calls < 2) throw apiError(408);
      return null;
    },
    { sleep: noSleep }
  );
  assert.equal(calls, 2);
});

test("does NOT retry a deterministic 4xx", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw apiError(404);
      },
      { sleep: noSleep }
    ),
    /http 404/
  );
  assert.equal(calls, 1, "a 404 must surface immediately");
});

test("gives up after the attempt budget and rethrows the last error", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw apiError(500);
      },
      { attempts: 4, sleep: noSleep }
    ),
    /http 500/
  );
  assert.equal(calls, 4);
});

test("backs off linearly between attempts", async () => {
  const delays: number[] = [];
  await assert.rejects(
    withRetry(
      async () => {
        throw apiError(500);
      },
      {
        attempts: 3,
        backoffMs: 100,
        sleep: async (ms) => {
          delays.push(ms);
        },
      }
    )
  );
  // Two sleeps for three attempts, growing linearly; none after the last.
  assert.deepEqual(delays, [100, 200]);
});
