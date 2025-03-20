import { Collection } from "mongodb";
import { Workflow, forInternalTesting } from ".";
import { mock } from "jest-mock-extended";

const { makeMakeSleep } = forInternalTesting;

describe("sleep", () => {
  it("should fail if workflow is not found", async () => {
    const now = () => new Date("2011-10-05T14:48:00.000Z");
    const timeoutIntervalMs = 1_000;
    const workflows = mock<Collection<Workflow>>();
    const goSleep = (ms: number) => Promise.resolve();
    const makeSleep = makeMakeSleep(workflows, timeoutIntervalMs, goSleep, now);
    const sleep = makeSleep("workflow-1");

    await expect(sleep("nap-1", 10)).rejects.toThrow(
      "workflow not found: workflow-1"
    );
  });

  it("should sleep the remaining time if the nap is found", async () => {
    const now = () => new Date("2011-10-05T14:48:00.000Z");
    const timeoutIntervalMs = 1_000;
    const workflows = mock<Collection<Workflow>>();
    const goSleep = (ms: number) => Promise.resolve();
    const makeSleep = makeMakeSleep(workflows, timeoutIntervalMs, goSleep, now);
    const sleep = makeSleep("workflow-1");

    workflows.findOne.mockResolvedValue({
      naps: {
        "nap-1": new Date("2011-10-05T14:48:00.001Z"),
      },
    });

    expect(sleep("nap-1", 0)).resolves;
  });

  it("should skip sleep if the nap is found but there is no remaining", async () => {
    const now = () => new Date("2011-10-05T14:48:00.000Z");
    const timeoutIntervalMs = 1_000;
    const workflows = mock<Collection<Workflow>>();
    const goSleep = (ms: number) => Promise.resolve();
    const makeSleep = makeMakeSleep(workflows, timeoutIntervalMs, goSleep, now);
    const sleep = makeSleep("workflow-1");

    workflows.findOne.mockResolvedValue({
      naps: {
        "nap-1": new Date("2011-10-05T14:48:00.000Z"),
      },
    });

    expect(sleep("nap-1", 0)).resolves;
  });

  it("should sleep if the nap is not found", async () => {
    const now = () => new Date("2011-10-05T14:48:00.000Z");
    const timeoutIntervalMs = 1_000;
    const workflows = mock<Collection<Workflow>>();
    const goSleep = (ms: number) => Promise.resolve();
    const makeSleep = makeMakeSleep(workflows, timeoutIntervalMs, goSleep, now);
    const sleep = makeSleep("workflow-1");
    workflows.findOne.mockResolvedValue({});
    expect(sleep("nap-1", 0)).resolves;
  });
});
