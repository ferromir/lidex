import { forInternalTesting, Persistence } from "./index";
import { mock } from "jest-mock-extended";

const { makeClaim } = forInternalTesting;

describe("claim", () => {
  it("returns the workflow id if found", async () => {
    const persistence = mock<Persistence>();
    persistence.claim.mockResolvedValue("workflow-1");
    const timeoutIntervalMs = 10;
    const claim = makeClaim(persistence, timeoutIntervalMs);
    const workflowId = await claim();
    expect(workflowId).toEqual("workflow-1");
  });

  it("returns undefined if not found", async () => {
    const persistence = mock<Persistence>();
    const timeoutIntervalMs = 10;
    const claim = makeClaim(persistence, timeoutIntervalMs);
    const workflowId = await claim();
    expect(workflowId).toBeUndefined();
  });
});
