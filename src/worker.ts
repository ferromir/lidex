import { Context, Handler, Persistence, Worker, WorkerOptions } from "./model";
import { goSleep } from "./go-sleep";
import { makeStart } from "./common";

const DEFAULT_MAX_FAILURES = 3;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_MS = 1_000;
const DEFAULT_RETRY_MS = 60_000;

export function makeClaim(persistence: Persistence, timeoutIntervalMs: number) {
  return async function (): Promise<string | undefined> {
    const now = new Date();
    const timeoutAt = new Date(now.getTime() + timeoutIntervalMs);
    return await persistence.claim(now, timeoutAt);
  };
}

export function makeMakeStep(
  persistence: Persistence,
  timeoutIntervalMs: number,
) {
  return function (workflowId: string) {
    return async function <T>(
      stepId: string,
      fn: () => Promise<T>,
    ): Promise<T> {
      let output = await persistence.findOutput(workflowId, stepId);

      if (!(output === undefined)) {
        return output as T;
      }

      output = await fn();
      const now = new Date();
      const timeoutAt = new Date(now.getTime() + timeoutIntervalMs);
      await persistence.updateOutput(workflowId, stepId, output, timeoutAt);
      return output as T;
    };
  };
}

export function makeMakeSleep(
  persistence: Persistence,
  timeoutIntervalMs: number,
) {
  return function (workflowId: string) {
    return async function (napId: string, ms: number): Promise<void> {
      let wakeUpAt = await persistence.findWakeUpAt(workflowId, napId);
      const now = new Date();

      if (wakeUpAt) {
        const remainingMs = wakeUpAt.getTime() - now.getTime();

        if (remainingMs > 0) {
          await goSleep(remainingMs);
        }

        return;
      }

      wakeUpAt = new Date(now.getTime() + ms);
      const timeoutAt = new Date(wakeUpAt.getTime() + timeoutIntervalMs);
      await persistence.updateWakeUpAt(workflowId, napId, wakeUpAt, timeoutAt);
      await goSleep(ms);
    };
  };
}

export function makeRun(
  persistence: Persistence,
  handlers: Map<string, Handler>,
  makeStep: (
    workflowId: string,
  ) => <T>(stepId: string, fn: () => Promise<T>) => Promise<T>,
  makeSleep: (
    workflowId: string,
  ) => (napId: string, ms: number) => Promise<void>,
  start: <T>(id: string, handler: string, input: T) => Promise<boolean>,
  maxFailures: number,
  retryIntervalMs: number,
) {
  return async function (workflowId: string): Promise<void> {
    const runData = await persistence.findRunData(workflowId);

    if (!runData) {
      throw new Error(`workflow not found: ${workflowId}`);
    }

    const fn = handlers.get(runData.handler);

    if (!fn) {
      throw new Error(`handler not found: ${runData.handler}`);
    }

    const ctx: Context = {
      step: makeStep(workflowId),
      sleep: makeSleep(workflowId),
      start,
    };

    try {
      await fn(ctx, runData.input);
    } catch (error) {
      const lastError = JSON.stringify(error);
      const failures = (runData.failures || 0) + 1;
      const status = failures < maxFailures ? "failed" : "aborted";
      const now = new Date();
      const timeoutAt = new Date(now.getTime() + retryIntervalMs);

      await persistence.updateStatus(
        workflowId,
        status,
        timeoutAt,
        failures,
        lastError,
      );

      return;
    }

    await persistence.setAsFinished(workflowId);
  };
}

export function makePoll(
  claim: () => Promise<string | undefined>,
  run: (workflowId: string) => Promise<void>,
  pollIntervalMs: number,
) {
  return async function (shouldStop: () => boolean): Promise<void> {
    while (!shouldStop()) {
      const workflowId = await claim();

      if (workflowId) {
        run(workflowId); // Intentionally not awaiting
      } else {
        await goSleep(pollIntervalMs);
      }
    }
  };
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
