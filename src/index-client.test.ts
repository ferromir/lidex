import { mock } from "jest-mock-extended";
import { makeClient, Persistence } from "./index";

const persistence = mock<Persistence>();

beforeEach(async () => {
  jest.spyOn(global, "setTimeout").mockImplementation((callback) => {
    callback();
    return null as unknown as NodeJS.Timeout;
  });
});

describe("start", () => {
  it("inserts a workflow", async () => {
    persistence.insert.mockReset();
    persistence.insert.mockResolvedValue(true);
    const client = await makeClient({ persistence });
    await client.start("workflow-1", "handler-1", "input-1");
    expect(persistence.insert).toHaveBeenCalled();
  });
});

describe("wait", () => {
  it("returns matching status", async () => {
    persistence.findStatus.mockReset();
    persistence.findStatus.mockResolvedValue("finished");
    const client = await makeClient({ persistence });
    const result = await client.wait("workflow-1", ["finished"], 1, 10);
    expect(result).toEqual("finished");
  });

  it("can retry after making a pause", async () => {
    persistence.findStatus.mockReset();
    persistence.findStatus.mockResolvedValueOnce("running");
    persistence.findStatus.mockResolvedValueOnce("finished");
    const client = await makeClient({ persistence });
    const result = await client.wait("workflow-1", ["finished"], 2, 10);
    expect(result).toEqual("finished");
  });

  it("returns undefined if no result is found", async () => {
    persistence.findStatus.mockReset();
    persistence.findStatus.mockResolvedValueOnce("running");
    persistence.findStatus.mockResolvedValueOnce("running");
    const client = await makeClient({ persistence });
    const result = await client.wait("workflow-1", ["finished"], 2, 10);
    expect(result).toBeUndefined();
  });
});
