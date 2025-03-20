import { Collection, ObjectId } from "mongodb";
import { Workflow, forInternalTesting } from "./index2";
import { mock } from "jest-mock-extended";

const { makeClaim } = forInternalTesting;

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

  it("should return empty if there is no match", async () => {
    const now = () => new Date("2011-10-05T14:48:00.000Z");
    const timeoutIntervalMs = 1_000;
    const workflows = mock<Collection<Workflow>>();
    const claim = makeClaim(workflows, now, timeoutIntervalMs);
    workflows.findOneAndUpdate.mockResolvedValue(null);
    const id = await claim();
    expect(id).toBeUndefined();
  });
});
