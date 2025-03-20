import { Collection } from "mongodb";
import { Workflow, forInternalTesting } from "./index2";
import { mock } from "jest-mock-extended";

const { makeMakeStep } = forInternalTesting;

describe("step", () => {
  it("should fail if workflow is not found", async () => {
    const now = () => new Date("2011-10-05T14:48:00.000Z");
    const timeoutIntervalMs = 1_000;
    const workflows = mock<Collection<Workflow>>();
    const makeStep = makeMakeStep(workflows, timeoutIntervalMs, now);
    const step = makeStep("workflow-1");
    const fn = () => Promise.resolve();

    await expect(step("step-1", fn)).rejects.toThrow(
      "workflow not found: workflow-1"
    );
  });

  it("should returned the step is found", async () => {
    const now = () => new Date("2011-10-05T14:48:00.000Z");
    const timeoutIntervalMs = 1_000;
    const workflows = mock<Collection<Workflow>>();
    const makeStep = makeMakeStep(workflows, timeoutIntervalMs, now);
    const step = makeStep("workflow-1");
    const fn = () => Promise.resolve();

    workflows.findOne.mockResolvedValue({
      steps: {
        "step-1": "value-1",
      },
    });

    await expect(step("step-1", fn)).resolves.toEqual("value-1");
  });

  it("should run the function if the step is not found", async () => {
    const now = () => new Date("2011-10-05T14:48:00.000Z");
    const timeoutIntervalMs = 1_000;
    const workflows = mock<Collection<Workflow>>();
    const makeStep = makeMakeStep(workflows, timeoutIntervalMs, now);
    const step = makeStep("workflow-1");
    const fn = () => Promise.resolve("value-1");
    workflows.findOne.mockResolvedValue({});
    await expect(step("step-1", fn)).resolves.toEqual("value-1");
  });
});
