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

export interface ClientConfig {
  persistence: Persistence;
}

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
    ms: number,
  ): Promise<Status | undefined>;
}

export type Handler = (ctx: Context, input: unknown) => Promise<void>;

export interface WorkerConfig {
  persistence: Persistence;
  handlers: Map<string, Handler>;
  maxFailures?: number;
  timeoutIntervalMs?: number;
  pollIntervalMs?: number;
  retryIntervalMs?: number;
}

export interface Worker {
  /**
   * It starts polling workflows.
   * @param shouldStop Circuit breaker for the polling loop.
   */
  poll(shouldStop: () => boolean): Promise<void>;
}

export interface RunData {
  handler: string;
  input: unknown;
  failures?: number;
}

export interface Persistence {
  /**
   * Initializes the persistence provider.
   */
  init(): Promise<void>;

  /**
   * Inserts a workflow.
   * @param workflowId The id of the workflow.
   * @param handler The name of the handler.
   * @param input The input for the workflow.
   * @returns True is the workflow was inserted. False is the workflow already
   * exists.
   */
  insert(workflowId: string, handler: string, input: unknown): Promise<boolean>;

  /**
   * It consists of two actions:
   * 1. Find a workflow that is ready to run.
   * 2. Update the timeout and set the status to "running".
   * These 2 steps have to be performed atomically.
   *
   * A "ready to run" workflow matches the following condition:
   * (status is "idle") OR
   * (status is "running" AND timeoutAt < CURRENT_TIME) OR
   * (status is "failed" AND timeoutAt < CURRENT_TIME)
   * @param now The current time.
   * @param timeoutAt The workflow timeout.
   * @returns The workflow id.
   */
  claim(now: Date, timeoutAt: Date): Promise<string | undefined>;

  /**
   * Finds the stored output for the given workflow and step.
   * @param workflowId Id of the workflow.
   * @param stepId Id of the step.
   * @returns The output. Returns undefined if not found.
   */
  findOutput(workflowId: string, stepId: string): Promise<unknown>;

  /**
   * Finds the stored wake up time for the given workflow and nap.
   * @param workflowId Id of the workflow.
   * @param napId Id of the nap.
   * @returns The wake up time. Returns undefined if not found.
   */
  findWakeUpAt(workflowId: string, napId: string): Promise<Date | undefined>;

  /**
   * Finds information about the workflow required to run it.
   * @param workflowId Id of the workflow.
   * @returns The run data.
   */
  findRunData(workflowId: string): Promise<RunData | undefined>;

  /**
   * It sets the status of the workflow to "finished".
   * @param workflowId Id of the workflow.
   */
  setAsFinished(workflowId: string): Promise<void>;

  /**
   * Finds the status of a workflow.
   * @param workflowId Id of the workflow.
   * @returns The status if found, otherwise undefined.
   */
  findStatus(workflowId: string): Promise<Status | undefined>;

  /**
   * Updates the status, timeoutAt, failures and lastError.
   * @param workflowId Id of the workflow.
   * @param status Status of the workflow.
   * @param timeoutAt The workflow timeout.
   * @param failures The amount of failures.
   * @param lastError Last error message.
   */
  updateStatus(
    workflowId: string,
    status: Status,
    timeoutAt: Date,
    failures: number,
    lastError: string,
  ): Promise<void>;

  /**
   * Updates the step's output and timeoutAt.
   * @param workflowId Id of the workflow.
   * @param stepId Id of the step.
   * @param output Output of the step.
   * @param timeoutAt The workflow timeout.
   */
  updateOutput(
    workflowId: string,
    stepId: string,
    output: unknown,
    timeoutAt: Date,
  ): Promise<void>;

  /**
   * Updates the step's output and timeoutAt.
   * @param workflowId Id of the workflow.
   * @param napId Id of the nap.
   * @param wakeUpAt Wake up time of the nap.
   * @param timeoutAt The workflow timeout.
   */
  updateWakeUpAt(
    workflowId: string,
    napId: string,
    wakeUpAt: Date,
    timeoutAt: Date,
  ): Promise<void>;

  /**
   * Terminates the persistence provider.
   */
  terminate(): Promise<void>;
}

// Shared code:

async function goSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

function makeStart(persistence: Persistence) {
  return async function <T>(
    workflowId: string,
    handler: string,
    input: T,
  ): Promise<boolean> {
    return persistence.insert(workflowId, handler, input);
  };
}

// Client code:

function makeWait(persistence: Persistence) {
  return async function (
    workflowId: string,
    status: Status[],
    times: number,
    ms: number,
  ): Promise<Status | undefined> {
    for (let i = 0; i < times; i++) {
      const foundStatus = await persistence.findStatus(workflowId);

      if (foundStatus && status.includes(foundStatus)) {
        return foundStatus;
      }

      await goSleep(ms);
    }

    return undefined;
  };
}

export async function makeClient(config: ClientConfig): Promise<Client> {
  const { persistence } = config;
  const start = makeStart(persistence);
  const wait = makeWait(persistence);
  return { start, wait };
}

// Worker code:

const DEFAULT_MAX_FAILURES = 3;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_MS = 1_000;
const DEFAULT_RETRY_MS = 60_000;

function makeClaim(persistence: Persistence, timeoutIntervalMs: number) {
  return async function (): Promise<string | undefined> {
    const now = new Date();
    const timeoutAt = new Date(now.getTime() + timeoutIntervalMs);
    return await persistence.claim(now, timeoutAt);
  };
}

function makeMakeStep(persistence: Persistence, timeoutIntervalMs: number) {
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
      let lastError = "";

      if (error instanceof Error) {
        lastError = error.message;
      } else {
        lastError = JSON.stringify(error);
      }

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

function makePoll(
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

export async function makeWorker(config: WorkerConfig): Promise<Worker> {
  const { handlers, persistence } = config;
  const maxFailures = config.maxFailures || DEFAULT_MAX_FAILURES;
  const timeoutIntervalMs = config.timeoutIntervalMs || DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = config.pollIntervalMs || DEFAULT_POLL_MS;
  const retryIntervalMs = config.retryIntervalMs || DEFAULT_RETRY_MS;
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
