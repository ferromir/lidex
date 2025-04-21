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

describe("internal.ts", () => {
  const persistence = mock<Persistence>();

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("makeStart should insert workflow", async () => {
    const start = makeStart(persistence);
    await start("id", "handler", { foo: "bar" });
    expect(persistence.insert).toHaveBeenCalledWith("id", "handler", {
      foo: "bar",
    });
  });

  test("makeWait resolves when status is found", async () => {
    const wait = makeWait(persistence);
    persistence.findStatus.mockResolvedValueOnce("finished" as Status);
    const result = await wait("id", ["finished"], 3, 1000);
    expect(result).toBe("finished");
  });

  test("makeWait retries and eventually returns undefined", async () => {
    const wait = makeWait(persistence);
    persistence.findStatus.mockResolvedValue(undefined);
    const result = await wait("id", ["finished"], 2, 1000);
    expect(goSleep).toHaveBeenCalledTimes(2);
    expect(result).toBeUndefined();
  });

  test("makeClaim calls persistence.claim with correct timeout", async () => {
    const claim = makeClaim(persistence, 5000);
    await claim();
    expect(persistence.claim).toHaveBeenCalledWith(
      now,
      new Date(now.getTime() + 5000),
    );
  });

  test("makeMakeStep uses cache and returns existing output", async () => {
    const step = makeMakeStep(persistence, 10000)("workflow1");
    persistence.findOutput.mockResolvedValueOnce("cached result");
    const result = await step(
      "step1",
      jest.fn().mockResolvedValue("new result"),
    );
    expect(result).toBe("cached result");
    expect(persistence.updateOutput).not.toHaveBeenCalled();
  });

  test("makeMakeStep executes fn and stores new output if none exists", async () => {
    const step = makeMakeStep(persistence, 10000)("workflow1");
    persistence.findOutput.mockResolvedValueOnce(undefined);
    const result = await step(
      "step1",
      jest.fn().mockResolvedValue("computed result"),
    );
    expect(result).toBe("computed result");
    expect(persistence.updateOutput).toHaveBeenCalled();
  });

  test("makeMakeSleep sleeps remaining time if wakeUpAt is in future", async () => {
    const wakeUpAt = new Date(now.getTime() + 3000);
    persistence.findWakeUpAt.mockResolvedValueOnce(wakeUpAt);
    const sleep = makeMakeSleep(persistence, 5000)("workflow1");
    await sleep("nap1", 3000);
    expect(goSleep).toHaveBeenCalledWith(3000);
  });

  test("makeMakeSleep stores wakeUpAt and sleeps if none exists", async () => {
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
      input: { x: 1 },
      failures: 0,
    });

    const run = makeRun(
      persistence,
      handlers,
      () => jest.fn().mockImplementation(async (_id, fn) => await fn()),
      () => jest.fn().mockImplementation(async () => {}),
      async () => true,
      3,
      1000,
    );

    await run("workflowX");
    expect(handler).toHaveBeenCalled();
    expect(persistence.setAsFinished).toHaveBeenCalled();
  });

  test("makeRun handles error and retries below maxFailures", async () => {
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
      () => jest.fn().mockImplementation(async (_id, fn) => await fn()),
      () => jest.fn().mockImplementation(async () => {}),
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
      () => jest.fn().mockImplementation(async (_id, fn) => await fn()),
      () => jest.fn().mockImplementation(async () => {}),
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

  test("makeRun throws if workflow is not found", async () => {
    persistence.findRunData.mockResolvedValue(undefined);
    const run = makeRun(
      persistence,
      new Map(),
      jest.fn(),
      jest.fn(),
      jest.fn(),
      3,
      1000,
    );
    await expect(run("missing-workflow")).rejects.toThrow(
      "workflow not found: missing-workflow",
    );
  });

  test("makeRun throws if handler is not found", async () => {
    persistence.findRunData.mockResolvedValue({
      handler: "missing",
      input: {},
      failures: 0,
    });
    const run = makeRun(
      persistence,
      new Map(),
      jest.fn(),
      jest.fn(),
      jest.fn(),
      3,
      1000,
    );
    await expect(run("workflow-with-missing-handler")).rejects.toThrow(
      "handler not found: missing",
    );
  });

  test("makePoll runs claimed workflows and sleeps if none", async () => {
    const claimFn = jest
      .fn()
      .mockResolvedValueOnce("wf1")
      .mockResolvedValueOnce(undefined);
    const runFn = jest.fn();
    const poll = makePoll(claimFn, runFn, 1000);

    const shouldStop = jest
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    await poll(() => shouldStop());

    expect(claimFn).toHaveBeenCalled();
    expect(runFn).toHaveBeenCalledWith("wf1");
    expect(goSleep).toHaveBeenCalledWith(1000);
  });
});
