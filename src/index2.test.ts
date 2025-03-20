import { Collection, ObjectId } from "mongodb";
import { Client, forInternalTesting, Workflow } from "./index2";
import { mock } from "jest-mock-extended";

const { makeClaim, makeMakeStep } = forInternalTesting;

beforeEach(() => {
  jest.resetAllMocks();
});

describe("claim", () => {
  it("should return a matching workflow", async () => {
    const now = () => new Date("2011-10-05T14:48:00.000Z");
    const timeoutIntervalMs = 1_000;
    const workflows = mock<Collection<Workflow>>();
    const claim = makeClaim(workflows, now, timeoutIntervalMs);

    workflows.findOneAndUpdate.mockResolvedValue({
      _id: new ObjectId(),
      id: "workflow-1",
      handler: "handler-1",
      status: "idle",
      input: "input-1",
      createdAt: now(),
    });

    const id = await claim();
    expect(id).toEqual("workflow-1");
  });
});

describe("step", () => {
  it("should fail if workflow is not found", async () => {
    const now = () => new Date("2011-10-05T14:48:00.000Z");
    const timeoutIntervalMs = 1_000;
    const workflows = mock<Collection<Workflow>>();
    const makeStep = makeMakeStep(workflows, timeoutIntervalMs, now);
    const step = makeStep("workflow-1");
    const fn = () => Promise.resolve();

    await expect(step("action-1", fn)).rejects.toThrow(
      "workflow not found: workflow-1"
    );
  });
});
