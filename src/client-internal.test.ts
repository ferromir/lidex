import { mock } from "jest-mock-extended";
import { makeWait } from "./client-internal"; // replace with actual path
import { Persistence } from "./model";
import * as common from "./common";

jest.mock("./common", () => ({
  ...jest.requireActual("./common"),
  goSleep: jest.fn(),
}));

describe("makeWait", () => {
  const persistence = mock<Persistence>();
  const goSleepMock = common.goSleep as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    goSleepMock.mockResolvedValue(undefined); // avoid actual delay
  });

  it("should return status immediately if it matches on first try", async () => {
    persistence.findStatus.mockResolvedValue("finished");

    const wait = makeWait(persistence);
    const result = await wait("workflow-1", ["finished"], 3, 1000);

    expect(result).toBe("finished");
    expect(persistence.findStatus).toHaveBeenCalledTimes(1);
    expect(goSleepMock).not.toHaveBeenCalled();
  });

  it("should poll multiple times until status matches", async () => {
    persistence.findStatus
      .mockResolvedValueOnce("idle")
      .mockResolvedValueOnce("idle")
      .mockResolvedValueOnce("finished");

    const wait = makeWait(persistence);
    const result = await wait("workflow-2", ["finished"], 5, 1000);

    expect(result).toBe("finished");
    expect(persistence.findStatus).toHaveBeenCalledTimes(3);
    expect(goSleepMock).toHaveBeenCalledTimes(2);
  });

  it("should return undefined if status never matches", async () => {
    persistence.findStatus.mockResolvedValue("idle");

    const wait = makeWait(persistence);
    const result = await wait("workflow-3", ["finished"], 3, 1000);

    expect(result).toBeUndefined();
    expect(persistence.findStatus).toHaveBeenCalledTimes(3);
    expect(goSleepMock).toHaveBeenCalledTimes(3);
  });

  it("should handle undefined status responses gracefully", async () => {
    persistence.findStatus.mockResolvedValue(undefined);

    const wait = makeWait(persistence);
    const result = await wait("workflow-4", ["finished"], 2, 500);

    expect(result).toBeUndefined();
    expect(persistence.findStatus).toHaveBeenCalledTimes(2);
    expect(goSleepMock).toHaveBeenCalledTimes(2);
  });
});
