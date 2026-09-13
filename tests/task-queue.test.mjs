import test from "node:test";
import assert from "node:assert/strict";
import { TaskQueue } from "../server/task-queue.mjs";
test("busy turns queue in order instead of rejecting new selections", async () => {
  const queue = new TaskQueue(2);
  const first = await queue.acquire(),
    second = await queue.acquire();
  const order = [];
  const third = queue.acquire().then((release) => {
    order.push(3);
    return release;
  });
  const fourth = queue.acquire().then((release) => {
    order.push(4);
    return release;
  });
  await Promise.resolve();
  assert.deepEqual(order, []);
  assert.equal(queue.active, 2);
  first();
  const releaseThird = await third;
  assert.deepEqual(order, [3]);
  second();
  const releaseFourth = await fourth;
  assert.deepEqual(order, [3, 4]);
  releaseThird();
  releaseThird();
  releaseFourth();
  assert.equal(queue.active, 0);
});
test("a cancelled waiting selection is removed and never consumes a slot", async () => {
  const queue = new TaskQueue(1);
  const release = await queue.acquire();
  const abort = new AbortController();
  const cancelled = queue.acquire(abort.signal);
  abort.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  assert.equal(queue.waiting.length, 0);
  const next = queue.acquire();
  release();
  (await next)();
  assert.equal(queue.active, 0);
  await assert.rejects(queue.acquire(abort.signal), { name: "AbortError" });
});
