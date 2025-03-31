import { Config, forInternalTesting, makeClient, Persistence } from "./index";
import { mock } from "jest-mock-extended";

const {
  makeClaim,
  makeMakeStep,
  makeMakeSleep,
  makeRun,
  makeStart,
  makeWait,
  makePoll,
} = forInternalTesting;

const persistence = mock<Persistence>();
const now = new Date("2011-10-05T14:48:00.000Z");
const timeoutIntervalMs = 1000;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(now);

  jest.spyOn(global, "setTimeout").mockImplementation((callback) => {
    callback();
    return null as unknown as NodeJS.Timeout;
  });

  persistence.claim.mockReset();
  persistence.findOutput.mockReset();
  persistence.updateOutput.mockReset();
  persistence.findWakeUpAt.mockReset();
  persistence.updateWakeUpAt.mockReset();
  persistence.findRunData.mockReset();
  persistence.insert.mockReset();
  persistence.findStatus.mockReset();
});

describe("claim", () => {
  it("returns the workflow id", async () => {
    persistence.claim.mockResolvedValue("workflow-1");
    const claim = makeClaim(persistence, timeoutIntervalMs);
    const workflowId = await claim();
    expect(workflowId).toEqual("workflow-1");
    const _now = persistence.claim.mock.calls[0][0];
    expect(_now).toEqual(now);
    const _timeoutAt = persistence.claim.mock.calls[0][1];
    const timeout = new Date(now.getTime() + timeoutIntervalMs);
    expect(_timeoutAt).toEqual(timeout);
  });
});

describe("step", () => {
  it("returns output if step found", async () => {
    persistence.findOutput.mockResolvedValue("output-1");
    const makeStep = makeMakeStep(persistence, timeoutIntervalMs);
    const step = makeStep("workflow-1");
    const fn = jest.fn();
    const output = await step("step-1", fn);
    expect(output).toEqual("output-1");
    expect(fn).not.toHaveBeenCalled();
  });

  it("executes function if output not found", async () => {
    const makeStep = makeMakeStep(persistence, timeoutIntervalMs);
    const step = makeStep("workflow-1");
    const fn = jest.fn().mockResolvedValue("output-1");
    const output = await step("step-1", fn);
    expect(output).toEqual("output-1");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("sleep", () => {
  it("returns right await if completed nap is found", async () => {
    persistence.findWakeUpAt.mockResolvedValue(now);
    const makeSleep = makeMakeSleep(persistence, timeoutIntervalMs);
    const sleep = makeSleep("workflow-1");
    await sleep("nap-1", 1000);
    expect(setTimeout).not.toHaveBeenCalled();
  });

  it("sleeps when the nap is found but not completed", async () => {
    const wakeUpAt = new Date(now.getTime() + 2000);
    persistence.findWakeUpAt.mockResolvedValue(wakeUpAt);
    const makeSleep = makeMakeSleep(persistence, timeoutIntervalMs);
    const sleep = makeSleep("workflow-1");
    await sleep("nap-1", 1000);
    expect(setTimeout).toHaveBeenCalledWith(expect.anything(), 2000);
  });

  it("sleeps when the nap is not found", async () => {
    const makeSleep = makeMakeSleep(persistence, timeoutIntervalMs);
    const sleep = makeSleep("workflow-1");
    await sleep("nap-1", 1000);
    const wakeUpAt = new Date(now.getTime() + 1000);
    const timeoutAt = new Date(wakeUpAt.getTime() + timeoutIntervalMs);

    expect(persistence.updateWakeUpAt).toHaveBeenCalledWith(
      "workflow-1",
      "nap-1",
      wakeUpAt,
      timeoutAt
    );

    expect(setTimeout).toHaveBeenCalledWith(expect.anything(), 1000);
  });
});

describe("run", () => {
  it("fails if workflow is not found", async () => {
    const handlers = new Map();
    const makeStep = jest.fn();
    const makeSleep = jest.fn();
    const start = jest.fn();

    const run = makeRun(
      persistence,
      handlers,
      makeStep,
      makeSleep,
      start,
      3,
      timeoutIntervalMs
    );

    const result = run("workflow-1");
    await expect(result).rejects.toThrow("workflow not found: workflow-1");
    expect(persistence.findRunData).toHaveBeenCalledWith("workflow-1");
  });

  it("fails if handler is not found", async () => {
    persistence.findRunData.mockResolvedValue({
      handler: "handler-1",
      input: "input-1",
      failures: 1,
    });

    const handlers = new Map();
    const makeStep = jest.fn();
    const makeSleep = jest.fn();
    const start = jest.fn();

    const run = makeRun(
      persistence,
      handlers,
      makeStep,
      makeSleep,
      start,
      3,
      timeoutIntervalMs
    );

    const result = run("workflow-1");
    await expect(result).rejects.toThrow("handler not found: handler-1");
    expect(persistence.findRunData).toHaveBeenCalledWith("workflow-1");
  });

  it("runs the handler and sets the workflow as finished", async () => {
    persistence.findRunData.mockResolvedValue({
      handler: "handler-1",
      input: "input-1",
      failures: 1,
    });

    const handler = jest.fn();
    const handlers = new Map([["handler-1", handler]]);
    const makeStep = jest.fn();
    const makeSleep = jest.fn();
    const start = jest.fn();

    const run = makeRun(
      persistence,
      handlers,
      makeStep,
      makeSleep,
      start,
      3,
      timeoutIntervalMs
    );

    const result = run("workflow-1");
    await expect(result).resolves.not.toThrow();
    expect(persistence.findRunData).toHaveBeenCalledWith("workflow-1");
    expect(handler).toHaveBeenCalledWith(expect.anything(), "input-1");
    expect(persistence.setAsFinished).toHaveBeenCalledWith("workflow-1");
  });

  it("sets the workflow as failed if handler fails", async () => {
    persistence.findRunData.mockResolvedValue({
      handler: "handler-1",
      input: "input-1",
      failures: 1,
    });

    const handler = jest.fn().mockRejectedValue(new Error("kapot"));
    const handlers = new Map([["handler-1", handler]]);
    const makeStep = jest.fn();
    const makeSleep = jest.fn();
    const start = jest.fn();

    const run = makeRun(
      persistence,
      handlers,
      makeStep,
      makeSleep,
      start,
      3,
      timeoutIntervalMs
    );

    const result = run("workflow-1");
    await expect(result).resolves.not.toThrow();
    expect(persistence.findRunData).toHaveBeenCalledWith("workflow-1");
    expect(handler).toHaveBeenCalledWith(expect.anything(), "input-1");
    const timeoutAt = new Date(now.getTime() + timeoutIntervalMs);

    expect(persistence.updateStatus).toHaveBeenCalledWith(
      "workflow-1",
      "failed",
      timeoutAt,
      2,
      "kapot"
    );
  });

  it("sets the workflow as aborted if handler keeps failing", async () => {
    persistence.findRunData.mockResolvedValue({
      handler: "handler-1",
      input: "input-1",
    });

    const handler = jest.fn().mockRejectedValue("kapot");
    const handlers = new Map([["handler-1", handler]]);
    const makeStep = jest.fn();
    const makeSleep = jest.fn();
    const start = jest.fn();

    const run = makeRun(
      persistence,
      handlers,
      makeStep,
      makeSleep,
      start,
      1,
      timeoutIntervalMs
    );

    const result = run("workflow-1");
    await expect(result).resolves.not.toThrow();
    expect(persistence.findRunData).toHaveBeenCalledWith("workflow-1");
    expect(handler).toHaveBeenCalledWith(expect.anything(), "input-1");
    const timeoutAt = new Date(now.getTime() + timeoutIntervalMs);

    expect(persistence.updateStatus).toHaveBeenCalledWith(
      "workflow-1",
      "aborted",
      timeoutAt,
      1,
      '"kapot"'
    );
  });
});

describe("start", () => {
  it("inserts the workflow", async () => {
    const start = makeStart(persistence);
    const result = start("workflow-1", "handler-1", "input-1");
    expect(result).resolves.not.toThrow();

    expect(persistence.insert).toHaveBeenCalledWith(
      "workflow-1",
      "handler-1",
      "input-1"
    );
  });
});

describe("wait", () => {
  it("returns the status of the matching workflow", async () => {
    persistence.findStatus.mockResolvedValue("finished");
    const wait = makeWait(persistence);
    const status = await wait("workflow-1", ["finished", "aborted"], 1, 500);
    expect(status).toEqual("finished");
    expect(persistence.findStatus).toHaveBeenCalledWith("workflow-1");
  });

  it("pauses if not found before trying again", async () => {
    const wait = makeWait(persistence);
    const status = await wait("workflow-1", ["finished", "aborted"], 1, 500);
    expect(status).toBeUndefined();
    expect(persistence.findStatus).toHaveBeenCalledWith("workflow-1");
    expect(setTimeout).toHaveBeenCalledWith(expect.anything(), 500);
  });
});

describe("poll", () => {
  it("runs claimed workflows", async () => {
    const claim = jest.fn().mockResolvedValue("workflow-1");
    const run = jest.fn();
    const poll = makePoll(claim, run, 500);

    const shouldStop = jest
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    await expect(poll(shouldStop)).resolves.not.toThrow();
    expect(run).toHaveBeenCalledWith("workflow-1");
  });

  it("pauses if no workflow is claimed", async () => {
    const claim = jest.fn();
    const run = jest.fn();
    const poll = makePoll(claim, run, 500);

    const shouldStop = jest
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    await expect(poll(shouldStop)).resolves.not.toThrow();
    expect(setTimeout).toHaveBeenCalledWith(expect.anything(), 500);
  });
});

describe("makeClient", () => {
  it("creates a client with the given config", async () => {
    const config: Config = {
      persistence,
      handlers: new Map(),
      maxFailures: 3,
      timeoutIntervalMs: 5000,
      pollIntervalMs: 1000,
    };

    const client = await makeClient(config);
    expect(client).toBeDefined();
  });

  it("creates a client with defaults", async () => {
    const config: Config = {
      persistence,
      handlers: new Map(),
    };

    const client = await makeClient(config);
    expect(client).toBeDefined();
  });
});
