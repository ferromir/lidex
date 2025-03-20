import { Collection } from "mongodb";
import { Workflow, forInternalTesting } from ".";
import { mock } from "jest-mock-extended";

const { makeWait } = forInternalTesting;

describe("wait", () => {
  it("returns the matching workflow's status", async () => {
    const workflows = mock<Collection<Workflow>>();
    const goSleep = jest.fn();
    const wait = makeWait(workflows, goSleep);
    workflows.findOne.mockResolvedValue({ status: "finished" });
    const status = await wait("workflow-1", ["finished"], 1, 0);
    expect(status).toEqual("finished");
  });

  it("returns empty if there is no match", async () => {
    const workflows = mock<Collection<Workflow>>();
    const goSleep = jest.fn();
    const wait = makeWait(workflows, goSleep);
    const status = await wait("workflow-1", ["finished"], 1, 0);
    expect(status).toBeUndefined();
  });
});
