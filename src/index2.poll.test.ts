import { forInternalTesting } from "./index2";

const { makePoll } = forInternalTesting;

describe("poll", () => {
  it("sleeps if no workflow is claimed", async () => {
    const claim = jest.fn();
    const run = jest.fn();

    const goSleep = jest.fn().mockImplementation(() => {
      throw new Error("sleeping");
    });

    const pollIntervalMs = 1000;
    const poll = makePoll(claim, run, goSleep, pollIntervalMs);

    await expect(poll()).rejects.toThrow("sleeping");
  });

  it("runs the claimed workflow", async () => {
    const claim = jest.fn().mockResolvedValueOnce("workflow-1");
    const run = jest.fn();

    const goSleep = jest.fn().mockImplementation(() => {
      throw new Error("sleeping");
    });

    const pollIntervalMs = 1000;
    const poll = makePoll(claim, run, goSleep, pollIntervalMs);

    await expect(poll()).rejects.toThrow("sleeping");
  });
});
