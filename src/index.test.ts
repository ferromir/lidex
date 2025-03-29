import { forInternalTesting, Persistence } from "./index";
import { mock } from "jest-mock-extended";

describe("claim", () => {
  const { makeClaim } = forInternalTesting;
  const persistence = mock<Persistence>();
  const timeoutIntervalMs = 10;
  const claim = makeClaim(persistence, timeoutIntervalMs);

  beforeEach(() => {
    persistence.claim.mockReset();
  });

  it("returns the workflow id if found", async () => {
    persistence.claim.mockResolvedValue("workflow-1");
    const workflowId = await claim();
    expect(workflowId).toEqual("workflow-1");
  });

  it("returns undefined if not found", async () => {
    const workflowId = await claim();
    expect(workflowId).toBeUndefined();
  });
});
