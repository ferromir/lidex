import { Collection } from "mongodb";
import { Workflow, forInternalTesting } from ".";
import { mock } from "jest-mock-extended";

const { makeRun } = forInternalTesting;

describe("run", () => {
  it("should fail if workflow is not found", async () => {
    const now = () => new Date("2011-10-05T14:48:00.000Z");
    const timeoutIntervalMs = 1_000;
    const workflows = mock<Collection<Workflow>>();
    const handlers = new Map();
    const makeStep = jest.fn();
    const makeSleep = jest.fn();
    const start = jest.fn();
    const maxFailures = 3;

    const run = makeRun(
      workflows,
      handlers,
      makeStep,
      makeSleep,
      now,
      start,
      maxFailures,
      timeoutIntervalMs
    );

    await expect(run("workflow-1")).rejects.toThrow(
      "workflow not found: workflow-1"
    );
  });

  it("should fail if handler is not found", async () => {
    const now = () => new Date("2011-10-05T14:48:00.000Z");
    const timeoutIntervalMs = 1_000;
    const workflows = mock<Collection<Workflow>>();
    const handlers = new Map();
    const makeStep = jest.fn();
    const makeSleep = jest.fn();
    const start = jest.fn();
    const maxFailures = 3;

    const run = makeRun(
      workflows,
      handlers,
      makeStep,
      makeSleep,
      now,
      start,
      maxFailures,
      timeoutIntervalMs
    );

    workflows.findOne.mockResolvedValue({
      handler: "handler-1",
      input: "input-1",
    });

    await expect(run("workflow-1")).rejects.toThrow(
      "handler not found: handler-1"
    );
  });

  it("should run the handler", async () => {
    const now = () => new Date("2011-10-05T14:48:00.000Z");
    const timeoutIntervalMs = 1_000;
    const workflows = mock<Collection<Workflow>>();
    const fn = jest.fn();
    const handlers = new Map();
    handlers.set("handler-1", fn);
    const makeStep = jest.fn();
    const makeSleep = jest.fn();
    const start = jest.fn();
    const maxFailures = 3;

    const run = makeRun(
      workflows,
      handlers,
      makeStep,
      makeSleep,
      now,
      start,
      maxFailures,
      timeoutIntervalMs
    );

    workflows.findOne.mockResolvedValue({
      handler: "handler-1",
      input: "input-1",
    });

    expect(run("workflow-1")).resolves;
  });

  it("should handle the error if the handler fails", async () => {
    const now = () => new Date("2011-10-05T14:48:00.000Z");
    const timeoutIntervalMs = 1_000;
    const workflows = mock<Collection<Workflow>>();

    const fn = jest.fn().mockImplementation(() => {
      throw new Error("kapot");
    });

    const handlers = new Map();
    handlers.set("handler-1", fn);
    const makeStep = jest.fn();
    const makeSleep = jest.fn();
    const start = jest.fn();
    const maxFailures = 3;

    const run = makeRun(
      workflows,
      handlers,
      makeStep,
      makeSleep,
      now,
      start,
      maxFailures,
      timeoutIntervalMs
    );

    workflows.findOne.mockResolvedValue({
      handler: "handler-1",
      input: "input-1",
    });

    expect(run("workflow-1")).resolves;
  });

  it("should handle the error if the handler fails and error is not of type Error", async () => {
    const now = () => new Date("2011-10-05T14:48:00.000Z");
    const timeoutIntervalMs = 1_000;
    const workflows = mock<Collection<Workflow>>();

    const fn = jest.fn().mockImplementation(() => {
      throw "kapot";
    });

    const handlers = new Map();
    handlers.set("handler-1", fn);
    const makeStep = jest.fn();
    const makeSleep = jest.fn();
    const start = jest.fn();
    const maxFailures = 3;

    const run = makeRun(
      workflows,
      handlers,
      makeStep,
      makeSleep,
      now,
      start,
      maxFailures,
      timeoutIntervalMs
    );

    workflows.findOne.mockResolvedValue({
      handler: "handler-1",
      input: "input-1",
    });

    expect(run("workflow-1")).resolves;
  });

  it("should abort the workflow if the failures reach the max amount of failures", async () => {
    const now = () => new Date("2011-10-05T14:48:00.000Z");
    const timeoutIntervalMs = 1_000;
    const workflows = mock<Collection<Workflow>>();

    const fn = jest.fn().mockImplementation(() => {
      throw new Error("kapot");
    });

    const handlers = new Map();
    handlers.set("handler-1", fn);
    const makeStep = jest.fn();
    const makeSleep = jest.fn();
    const start = jest.fn();
    const maxFailures = 1;

    const run = makeRun(
      workflows,
      handlers,
      makeStep,
      makeSleep,
      now,
      start,
      maxFailures,
      timeoutIntervalMs
    );

    workflows.findOne.mockResolvedValue({
      handler: "handler-1",
      input: "input-1",
    });

    expect(run("workflow-1")).resolves;
  });
});
