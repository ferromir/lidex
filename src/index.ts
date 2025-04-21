import {
  makeClaim,
  makeMakeSleep,
  makeMakeStep,
  makeStart,
  makeWait,
  makeRun,
  makePoll,
} from "./internal";
import { Client, Handler, Persistence, Worker, WorkerOptions } from "./model";

const DEFAULT_MAX_FAILURES = 3;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_MS = 1_000;
const DEFAULT_RETRY_MS = 60_000;

export async function makeClient(persistence: Persistence): Promise<Client> {
  const start = makeStart(persistence);
  const wait = makeWait(persistence);
  return { start, wait };
}

export async function makeWorker(
  persistence: Persistence,
  handlers: Map<string, Handler>,
  options?: WorkerOptions,
): Promise<Worker> {
  const maxFailures = options?.maxFailures || DEFAULT_MAX_FAILURES;
  const timeoutIntervalMs = options?.timeoutIntervalMs || DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options?.pollIntervalMs || DEFAULT_POLL_MS;
  const retryIntervalMs = options?.retryIntervalMs || DEFAULT_RETRY_MS;
  const start = makeStart(persistence);
  const claim = makeClaim(persistence, timeoutIntervalMs);
  const makeStep = makeMakeStep(persistence, timeoutIntervalMs);
  const makeSleep = makeMakeSleep(persistence, timeoutIntervalMs);

  const run = makeRun(
    persistence,
    handlers,
    makeStep,
    makeSleep,
    start,
    maxFailures,
    retryIntervalMs,
  );

  const poll = makePoll(claim, run, pollIntervalMs);
  return { poll };
}
