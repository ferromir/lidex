const DEFAULT_MAX_FAILURES = 3;
const DEFAULT_TIMEOUT_MS = 300_000; // 5m
const DEFAULT_POLL_MS = 5_000; // 5s

export type Status = "idle" | "running" | "failed" | "finished" | "aborted";

export interface Context {
  /**
   * Executes a step.
   * @param id The id of the step.
   * @param fn The function to be executed.
   */
  step<T>(id: string, fn: () => Promise<T>): Promise<T>;

  /**
   * Puts the workflow to sleep.
   * @param id The id of the nap.
   * @param ms The amount of milliseconds to sleep.
   */
  sleep(id: string, ms: number): Promise<void>;

  /**
   * Starts a new workflow.
   * @param id The id of the workflow.
   * @param handler The handler name to execute the workflow.
   * @param input The input to the workflow.
   */
  start<T>(id: string, handler: string, input: T): Promise<boolean>;
}

export type Handler = (ctx: Context, input: unknown) => Promise<void>;

export interface Client {
  /**
   * It starts a workflow.
   * @param id The id of the workflow.
   * @param handler The handler name of the workflow.
   * @param input The input of the workflow, it must be serializable into JSON.
   * @returns True if the workflow is created, false if the workflow already
   * existed.
   */
  start<T>(id: string, handler: string, input: T): Promise<boolean>;

  /**
   * Returns a matching workflow status if found, it retries for the specified
   * amount of times and it pauses in between.
   * @param id The id of workflow.
   * @param status A list of status to match.
   * @param times Amount of retries.
   * @param ms Amount of milliseconds to wait between retries.
   */
  wait(
    id: string,
    status: Status[],
    times: number,
    ms: number
  ): Promise<Status | undefined>;

  /**
   * It starts polling workflows.
   * @param shouldStop Circuit breaker for the polling loop.
   */
  poll(shouldStop: () => boolean): Promise<void>;
}

export interface Config {
  handlers: Map<string, Handler>;
  persistence: Persistence;
  maxFailures?: number;
  timeoutIntervalMs?: number;
  pollIntervalMs?: number;
}

interface RunData {
  handler: string;
  input: unknown;
  failures?: number;
}

export interface Persistence {
  insert(workflowId: string, handler: string, input: unknown): Promise<boolean>;
  claim(timeoutAt: Date): Promise<string | undefined>;
  findOutput(workflowId: string, stepId: string): Promise<unknown>;
  findWakeUpAt(workflowId: string, napId: string): Promise<Date | undefined>;
  findRunData(workflowId: string): Promise<RunData | undefined>;
  setAsFinished(workflowId: string): Promise<void>;
  findStatus(workflowId: string): Promise<Status | undefined>;

  updateStatus(
    workflowId: string,
    status: Status,
    timeoutAt: Date,
    failures: number,
    lastError: string
  ): Promise<void>;

  updateOutput(
    workflowId: string,
    stepId: string,
    output: unknown,
    timeoutAt: Date
  ): Promise<void>;

  updateWakeUpAt(
    workflowId: string,
    napId: string,
    wakeUpAt: Date,
    timeoutAt: Date
  ): Promise<void>;
}

function goSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function makeClaim(persistence: Persistence, timeoutIntervalMs: number) {
  return async function (): Promise<string | undefined> {
    const now = new Date();
    const timeoutAt = new Date(now.getTime() + timeoutIntervalMs);
    return await persistence.claim(timeoutAt);
  };
}

function makeMakeStep(persistence: Persistence, timeoutIntervalMs: number) {
  return function (workflowId: string) {
    return async function <T>(
      stepId: string,
      fn: () => Promise<T>
    ): Promise<T> {
      let output = await persistence.findOutput(workflowId, stepId);

      if (output != undefined) {
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

function makeMakeSleep(persistence: Persistence, timeoutIntervalMs: number) {
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

function makeRun(
  persistence: Persistence,
  handlers: Map<string, Handler>,
  makeStep: (
    workflowId: string
  ) => <T>(stepId: string, fn: () => Promise<T>) => Promise<T>,
  makeSleep: (
    workflowId: string
  ) => (napId: string, ms: number) => Promise<void>,
  start: <T>(id: string, handler: string, input: T) => Promise<boolean>,
  maxFailures: number,
  timeoutIntervalMs: number
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
      await persistence.setAsFinished(workflowId);
    } catch (error) {
      let lastError = "";

      if (error instanceof Error) {
        lastError = error.message;
      } else {
        lastError = JSON.stringify(error);
      }

      const failures = (runData.failures || 0) + 1;
      const status = failures < maxFailures ? "failed" : "aborted";
      const now = new Date();
      const timeoutAt = new Date(now.getTime() + timeoutIntervalMs);

      await persistence.updateStatus(
        workflowId,
        status,
        timeoutAt,
        failures,
        lastError
      );
    }
  };
}

function makeStart(persistence: Persistence) {
  return async function <T>(
    workflowId: string,
    handler: string,
    input: T
  ): Promise<boolean> {
    return persistence.insert(workflowId, handler, input);
  };
}

function makeWait(persistence: Persistence) {
  return async function (
    workflowId: string,
    status: Status[],
    times: number,
    ms: number
  ): Promise<Status | undefined> {
    for (let i = 0; i < times; i++) {
      const found = await persistence.findStatus(workflowId);

      if (found && status.includes(found)) {
        return found;
      }

      await goSleep(ms);
    }

    return undefined;
  };
}

function makePoll(
  claim: () => Promise<string | undefined>,
  run: (workflowId: string) => Promise<void>,
  pollIntervalMs: number
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

/**
 * Creates a client based on the given configuration. If no configuration is
 * provided, then the library defaults are used.
 * @param config The configutarion object.
 * @returns The client instance.
 */
export async function makeClient(config: Config): Promise<Client> {
  const { handlers, persistence } = config;
  const maxFailures = config.maxFailures || DEFAULT_MAX_FAILURES;
  const timeoutIntervalMs = config.timeoutIntervalMs || DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = config.pollIntervalMs || DEFAULT_POLL_MS;
  const start = makeStart(persistence);
  const wait = makeWait(persistence);
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
    timeoutIntervalMs
  );

  const poll = makePoll(claim, run, pollIntervalMs);
  return { start, wait, poll };
}

export const forInternalTesting = {
  makeClaim,
  makeMakeStep,
  makeMakeSleep,
  makeRun,
  makeStart,
  makeWait,
  makePoll,
};
