// index.test.ts
import { makeClient, makeWorker } from "./index";
import { mock } from "jest-mock-extended";
import type { Persistence, Handler, WorkerOptions } from "./model";

const persistence = mock<Persistence>();
const handler = jest.fn();
const handlers = new Map<string, Handler>([["test", handler]]);

test("makeClient returns an object with start and wait functions", async () => {
  persistence.insert.mockResolvedValue(true);
  persistence.findStatus.mockResolvedValue("finished");

  const client = await makeClient(persistence);
  expect(client.start).toBeInstanceOf(Function);
  expect(client.wait).toBeInstanceOf(Function);

  const result = await client.start("id", "handler", { test: true });
  expect(result).toBe(true);
});

test("makeWorker returns a worker with a poll function", async () => {
  persistence.findRunData.mockResolvedValue({
    handler: "test",
    input: {},
    failures: 0,
  });
  persistence.setAsFinished.mockResolvedValue();

  const worker = await makeWorker(persistence, handlers);
  expect(worker.poll).toBeInstanceOf(Function);
});

test("makeWorker accepts custom options", async () => {
  const options: WorkerOptions = {
    maxFailures: 5,
    timeoutIntervalMs: 10_000,
    pollIntervalMs: 2000,
    retryIntervalMs: 15000,
  };

  persistence.findRunData.mockResolvedValue({
    handler: "test",
    input: {},
    failures: 0,
  });
  persistence.setAsFinished.mockResolvedValue();

  const worker = await makeWorker(persistence, handlers, options);
  expect(worker.poll).toBeInstanceOf(Function);
});
