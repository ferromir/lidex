import { mock } from "jest-mock-extended";
import {
  makeStart,
  makeWait,
  makeClaim,
  makeMakeStep,
  makeMakeSleep,
  makeRun,
  makePoll,
} from "./internal";
import { goSleep } from "./go-sleep";
import type { Persistence, Handler, Status } from "./model";

jest.mock("./go-sleep", () => ({
  goSleep: jest.fn(),
}));

const now = new Date();
jest.useFakeTimers().setSystemTime(now);

const persistence = mock<Persistence>();

afterEach(() => {
  jest.clearAllMocks();
});

test("makeStart inserts workflow", async () => {
  const start = makeStart(persistence);
  await start("id", "handler", { foo: "bar" });
  expect(persistence.insert).toHaveBeenCalledWith("id", "handler", {
    foo: "bar",
  });
});

test("makeWait returns status when matched", async () => {
  const wait = makeWait(persistence);
  persistence.findStatus.mockResolvedValueOnce("finished" as Status);
  const result = await wait("id", ["finished"], 3, 1000);
  expect(result).toBe("finished");
});

test("makeWait returns undefined after polling", async () => {
  const wait = makeWait(persistence);
  persistence.findStatus.mockResolvedValue(undefined);
  const result = await wait("id", ["finished"], 2, 1000);
  expect(goSleep).toHaveBeenCalledTimes(2);
  expect(result).toBeUndefined();
});

test("makeClaim calls persistence.claim with timeout", async () => {
  const claim = makeClaim(persistence, 5000);
  await claim();
  expect(persistence.claim).toHaveBeenCalledWith(
    now,
    new Date(now.getTime() + 5000),
  );
});

test("makeMakeStep returns cached result if available", async () => {
  const step = makeMakeStep(persistence, 10000)("workflow1");
  persistence.findOutput.mockResolvedValueOnce("cached");
  const result = await step("step1", () => Promise.resolve("new"));
  expect(result).toBe("cached");
  expect(persistence.updateOutput).not.toHaveBeenCalled();
});

test("makeMakeStep executes and stores new output", async () => {
  const step = makeMakeStep(persistence, 10000)("workflow1");
  persistence.findOutput.mockResolvedValueOnce(undefined);
  const result = await step("step1", () => Promise.resolve("computed"));
  expect(result).toBe("computed");
  expect(persistence.updateOutput).toHaveBeenCalled();
});

test("makeMakeSleep sleeps remaining time if wakeUpAt is in future", async () => {
  const wakeUpAt = new Date(now.getTime() + 3000);
  persistence.findWakeUpAt.mockResolvedValueOnce(wakeUpAt);
  const sleep = makeMakeSleep(persistence, 5000)("workflow1");
  await sleep("nap1", 3000);
  expect(goSleep).toHaveBeenCalledWith(3000);
});

test("makeMakeSleep stores wakeUpAt and sleeps if not set", async () => {
  persistence.findWakeUpAt.mockResolvedValueOnce(undefined);
  const sleep = makeMakeSleep(persistence, 5000)("workflow1");
  await sleep("nap1", 3000);
  expect(persistence.updateWakeUpAt).toHaveBeenCalled();
  expect(goSleep).toHaveBeenCalledWith(3000);
});

test("makeRun completes successful workflow", async () => {
  const handler = jest.fn().mockResolvedValue(undefined);
  const handlers = new Map<string, Handler>([["h", handler]]);
  persistence.findRunData.mockResolvedValue({
    handler: "h",
    input: {},
    failures: 0,
  });
  persistence.setAsFinished.mockResolvedValue();

  const run = makeRun(
    persistence,
    handlers,
    () => async (_id, fn) => await fn(),
    () => async () => {},
    async () => true,
    3,
    1000,
  );

  await run("workflowX");
  expect(handler).toHaveBeenCalled();
  expect(persistence.setAsFinished).toHaveBeenCalled();
});

test("makeRun retries on error under maxFailures", async () => {
  const handler = jest.fn().mockRejectedValue(new Error("fail"));
  persistence.findRunData.mockResolvedValue({
    handler: "h",
    input: {},
    failures: 0,
  });
  const handlers = new Map([["h", handler]]);

  const run = makeRun(
    persistence,
    handlers,
    () => async (_id, fn) => await fn(),
    () => async () => {},
    async () => true,
    3,
    1000,
  );

  await run("workflow1");
  expect(persistence.updateStatus).toHaveBeenCalledWith(
    "workflow1",
    "failed",
    new Date(now.getTime() + 1000),
    1,
    JSON.stringify(new Error("fail")),
  );
});

test("makeRun aborts after maxFailures", async () => {
  const handler = jest.fn().mockRejectedValue(new Error("fail"));
  persistence.findRunData.mockResolvedValue({
    handler: "h",
    input: {},
    failures: 2,
  });
  const handlers = new Map([["h", handler]]);

  const run = makeRun(
    persistence,
    handlers,
    () => async (_id, fn) => await fn(),
    () => async () => {},
    async () => true,
    3,
    1000,
  );

  await run("workflow1");
  expect(persistence.updateStatus).toHaveBeenCalledWith(
    "workflow1",
    "aborted",
    new Date(now.getTime() + 1000),
    3,
    JSON.stringify(new Error("fail")),
  );
});

test("makeRun throws if workflow not found", async () => {
  persistence.findRunData.mockResolvedValue(undefined);
  const run = makeRun(
    persistence,
    new Map(),
    () => async (_id, fn) => await fn(),
    () => async () => {},
    async () => true,
    3,
    1000,
  );

  await expect(run("missing")).rejects.toThrow("workflow not found: missing");
});

test("makeRun throws if handler not found", async () => {
  persistence.findRunData.mockResolvedValue({
    handler: "missing",
    input: {},
    failures: 0,
  });
  const run = makeRun(
    persistence,
    new Map(),
    () => async (_id, fn) => await fn(),
    () => async () => {},
    async () => true,
    3,
    1000,
  );

  await expect(run("workflowX")).rejects.toThrow("handler not found: missing");
});

test("makePoll runs claimed workflows and sleeps if none", async () => {
  const claimFn = jest
    .fn()
    .mockResolvedValueOnce("wf1")
    .mockResolvedValueOnce(undefined);
  const runFn = jest.fn();
  const shouldStop = jest
    .fn()
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(true);

  const poll = makePoll(claimFn, runFn, 1000);
  await poll(shouldStop);

  expect(claimFn).toHaveBeenCalledTimes(2);
  expect(runFn).toHaveBeenCalledWith("wf1");
  expect(goSleep).toHaveBeenCalledWith(1000);
});
