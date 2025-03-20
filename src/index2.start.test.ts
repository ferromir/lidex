import { Collection } from "mongodb";
import { Workflow, forInternalTesting } from "./index2";
import { mock } from "jest-mock-extended";

const { makeStart } = forInternalTesting;

describe("start", () => {
  it("should create a workflow", async () => {
    const workflows = mock<Collection<Workflow>>();
    const now = jest.fn();
    const start = makeStart(workflows, now);
    const created = await start("workflow-1", "handler-1", "input-1");
    expect(created).toBeTruthy();
  });

  it("should ignore if it is already created", async () => {
    const workflows = mock<Collection<Workflow>>();
    const now = jest.fn();
    const start = makeStart(workflows, now);

    workflows.insertOne.mockImplementation(() => {
      throw { name: "MongoServerError", code: 11000 };
    });

    const created = await start("workflow-1", "handler-1", "input-1");
    expect(created).toBeFalsy();
  });

  it("should fail if insert fails", async () => {
    const workflows = mock<Collection<Workflow>>();
    const now = jest.fn();
    const start = makeStart(workflows, now);

    workflows.insertOne.mockImplementation(() => {
      throw new Error("kapot");
    });

    await expect(start("workflow-1", "handler-1", "input-1")).rejects.toThrow(
      "kapot"
    );
  });
});
