import { mock } from "jest-mock-extended";
import { goSleep, makeStart } from "./common";
import { Persistence } from "./model";

jest.useFakeTimers();

describe("goSleep", () => {
  it("should resolve after specified milliseconds", async () => {
    const sleepPromise = goSleep(500);

    jest.advanceTimersByTime(500);

    await expect(sleepPromise).resolves.toBeUndefined();
  });
});

describe("makeStart", () => {
  it("should call persistence.insert with correct arguments and return true", async () => {
    const mockPersistence = mock<Persistence>();
    mockPersistence.insert.mockResolvedValue(true);

    const start = makeStart(mockPersistence);
    const result = await start("workflow-1", "handler-1", { foo: "bar" });

    expect(mockPersistence.insert).toHaveBeenCalledWith(
      "workflow-1",
      "handler-1",
      { foo: "bar" },
    );
    expect(result).toBe(true);
  });

  it("should return false if insert resolves to false", async () => {
    const mockPersistence = mock<Persistence>();
    mockPersistence.insert.mockResolvedValue(false);

    const start = makeStart(mockPersistence);
    const result = await start("workflow-2", "handler-2", { bar: "baz" });

    expect(mockPersistence.insert).toHaveBeenCalledWith(
      "workflow-2",
      "handler-2",
      { bar: "baz" },
    );
    expect(result).toBe(false);
  });
});
