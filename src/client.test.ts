import { mock } from "jest-mock-extended";
import { goSleep } from "./go-sleep";
import type { Persistence, Status } from "./model";
import { makeClient, makeWait } from "./client";

jest.mock("./go-sleep", () => ({
  goSleep: jest.fn(),
}));

const now = new Date();
jest.useFakeTimers().setSystemTime(now);

const persistence = mock<Persistence>();

afterEach(() => {
  jest.clearAllMocks();
});

test("makeWait returns status when matched", async () => {
  const wait = makeWait(persistence);
  persistence.findStatus.mockResolvedValueOnce("finished" as Status);
  const result = await wait("id", ["finished"], 3, 1000);
  expect(result).toBe("finished");
});

test("makeWait returns undefined after polling", async () => {
  const wait = makeWait(persistence);
  persistence.findStatus.mockResolvedValue(undefined);
  const result = await wait("id", ["finished"], 2, 1000);
  expect(goSleep).toHaveBeenCalledTimes(2);
  expect(result).toBeUndefined();
});

test("makeClient returns an object with start and wait functions", async () => {
  persistence.insert.mockResolvedValue(true);
  persistence.findStatus.mockResolvedValue("finished");

  const client = await makeClient(persistence);
  expect(client.start).toBeInstanceOf(Function);
  expect(client.wait).toBeInstanceOf(Function);

  const result = await client.start("id", "handler", { test: true });
  expect(result).toBe(true);
});
