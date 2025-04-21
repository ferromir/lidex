import { goSleep } from "./go-sleep";

jest.useFakeTimers();

describe("goSleep", () => {
  it("should resolve after the specified time", async () => {
    const promise = goSleep(5000);

    jest.advanceTimersByTime(5000);
    await expect(promise).resolves.toBeUndefined();
  });
});
