import { mock } from "jest-mock-extended";
import {
  makeRun,
  makePoll,
  makeClaim,
  makeMakeStep,
  makeMakeSleep,
} from "./worker-internal";
import { Persistence, Handler } from "./model";
import * as common from "./common";

jest.mock("./common", () => ({
  goSleep: jest.fn(),
}));

describe("makeRun", () => {
  const persistence = mock<Persistence>();
  const handlers = new Map<string, Handler>();
  const makeStep = jest.fn();
  const makeSleep = jest.fn();
  const start = jest.fn();
  const input = { foo: "bar" };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("runs successfully and finishes the workflow", async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    handlers.set("handlerA", handler);
    persistence.findRunData.mockResolvedValue({
      handler: "handlerA",
      input,
      failures: 0,
    });

    const run = makeRun(
      persistence,
      handlers,
      makeStep,
      makeSleep,
      start,
      3,
      5000,
    );
    await run("workflow-1");

    expect(handler).toHaveBeenCalled();
    expect(persistence.setAsFinished).toHaveBeenCalledWith("workflow-1");
  });

  it("updates status on handler failure (recoverable)", async () => {
    const error = new Error("test failure");
    const handler = jest.fn().mockRejectedValue(error);
    handlers.set("handlerA", handler);
    persistence.findRunData.mockResolvedValue({
      handler: "handlerA",
      input,
      failures: 0,
    });

    const run = makeRun(
      persistence,
      handlers,
      makeStep,
      makeSleep,
      start,
      3,
      5000,
    );
    await run("workflow-2");

    expect(persistence.updateStatus).toHaveBeenCalledWith(
      "workflow-2",
      "failed",
      expect.any(Date),
      1,
      JSON.stringify(error),
    );
  });

  it("updates status on handler failure (max failures reached)", async () => {
    const error = new Error("maxed out");
    const handler = jest.fn().mockRejectedValue(error);
    handlers.set("handlerA", handler);
    persistence.findRunData.mockResolvedValue({
      handler: "handlerA",
      input,
      failures: 2,
    });

    const run = makeRun(
      persistence,
      handlers,
      makeStep,
      makeSleep,
      start,
      3,
      10000,
    );
    await run("workflow-3");

    expect(persistence.updateStatus).toHaveBeenCalledWith(
      "workflow-3",
      "aborted",
      expect.any(Date),
      3,
      JSON.stringify(error),
    );
  });

  it("throws if workflow is not found", async () => {
    persistence.findRunData.mockResolvedValue(undefined);
    const run = makeRun(
      persistence,
      handlers,
      makeStep,
      makeSleep,
      start,
      3,
      5000,
    );
    await expect(run("missing-id")).rejects.toThrow(
      "workflow not found: missing-id",
    );
  });

  it("throws if handler is not found", async () => {
    persistence.findRunData.mockResolvedValue({
      handler: "missingHandler",
      input,
      failures: 0,
    });
    const run = makeRun(
      persistence,
      handlers,
      makeStep,
      makeSleep,
      start,
      3,
      5000,
    );
    await expect(run("bad-handler")).rejects.toThrow(
      "handler not found: missingHandler",
    );
  });
});

describe("makePoll", () => {
  it("runs workflows if claim returns ID and sleeps otherwise", async () => {
    const claim = jest
      .fn()
      .mockResolvedValueOnce("workflow-1")
      .mockResolvedValueOnce(undefined);
    const run = jest.fn();
    const poll = makePoll(claim, run, 1000);

    let count = 0;
    const shouldStop = () => ++count > 2;

    await poll(shouldStop);

    expect(run).toHaveBeenCalledWith("workflow-1");
    expect(common.goSleep).toHaveBeenCalledWith(1000);
  });
});

describe("makeClaim", () => {
  it("calls persistence.claim with correct timestamps", async () => {
    const persistence = mock<Persistence>();
    const claimFn = makeClaim(persistence, 60000);
    const now = new Date();
    jest.useFakeTimers().setSystemTime(now);

    await claimFn();

    expect(persistence.claim).toHaveBeenCalledWith(
      now,
      new Date(now.getTime() + 60000),
    );

    jest.useRealTimers();
  });
});

describe("makeMakeStep", () => {
  it("returns existing output or calls and stores result", async () => {
    const persistence = mock<Persistence>();
    const stepFn = makeMakeStep(persistence, 30000)("workflow-1");

    persistence.findOutput.mockResolvedValueOnce(undefined);
    const result = await stepFn("step-1", async () => "computed");

    expect(result).toBe("computed");
    expect(persistence.updateOutput).toHaveBeenCalled();
  });

  it("returns cached output if exists", async () => {
    const persistence = mock<Persistence>();
    persistence.findOutput.mockResolvedValue("cached");
    const stepFn = makeMakeStep(persistence, 10000)("workflow-2");

    const result = await stepFn("step-2", async () => "should-not-run");

    expect(result).toBe("cached");
  });
});

describe("makeMakeSleep", () => {
  it("sleeps remaining time if wakeUpAt exists in future", async () => {
    const persistence = mock<Persistence>();
    const now = new Date();
    jest.useFakeTimers().setSystemTime(now);

    persistence.findWakeUpAt.mockResolvedValue(new Date(now.getTime() + 5000));
    const sleepFn = makeMakeSleep(persistence, 10000)("workflow-1");

    await sleepFn("nap-1", 3000);

    expect(common.goSleep).toHaveBeenCalledWith(5000);
    jest.useRealTimers();
  });

  it("schedules new wakeUpAt if not set and sleeps", async () => {
    const persistence = mock<Persistence>();
    const now = new Date();
    jest.useFakeTimers().setSystemTime(now);

    persistence.findWakeUpAt.mockResolvedValue(undefined);
    const sleepFn = makeMakeSleep(persistence, 10000)("workflow-2");

    await sleepFn("nap-2", 2000);

    expect(persistence.updateWakeUpAt).toHaveBeenCalled();
    expect(common.goSleep).toHaveBeenCalledWith(2000);
    jest.useRealTimers();
  });
});
