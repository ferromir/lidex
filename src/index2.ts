import { Collection, MongoClient } from "mongodb";
import goSleep from "sleep-promise";

const COLL_NAME = "workflows";
const DEFAULT_MAX_FAILURES = 3;
const DEFAULT_TIMEOUT_MS = 300_000; // 5m
const DEFAULT_POLL_MS = 5_000; // 5s
const ERROR_NAME = "LidexError";
const MONGO_ERROR_NAME = "MongoServerError";
const MONGO_ERROR_CODE = 11000;
const IDLE = "idle";
const RUNNING = "running";
const FAILED = "failed";
const FINISHED = "finished";
const ABORTED = "aborted";

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
   * It polls continuously the database for workflows to run.
   */
  poll(shouldStop: () => boolean): Promise<void>;
}

// export interface Workflow {
//   id: string;
//   handler: string;
//   input: unknown;
//   status: Status;
//   createdAt: Date;
//   timeoutAt?: Date;
//   steps?: { [key: string]: unknown };
//   naps?: { [key: string]: Date };
//   failures?: number;
//   lastError?: string;
// }

export interface RunData {
  handler: string;
  input: unknown;
  failures?: number;
}

export interface Clock {
  now(): Date;
}

export interface Sleeper {
  goSleep(ms: number): Promise<void>;
}

// id,
//         handler,
//         input,
//         status: IDLE,
//         createdAt: now(),

export interface Persistence {
  create(workflowId: string, handler: string, input: unknown): Promise<boolean>;
  find(workflowId: string): Promise<RunData | undefined>;
  claim(clock: Clock, timeoutAt: Date): Promise<string | undefined>;

  findByStatus(
    workflowId: string,
    status: Status[]
  ): Promise<Status | undefined>;

  findOutput(workflowId: string, stepId: string): Promise<unknown>;
  findSleepUntil(workflowId: string, napId: string): Promise<Date | undefined>;
  setAsFinished(workflowId: string): Promise<void>;

  setOutput(
    workflowId: string,
    stepId: string,
    output: unknown,
    timeoutAt: Date
  ): Promise<void>;

  setSleepUntil(
    workflowId: string,
    napId: string,
    sleepUntil: Date,
    timeoutAt: Date
  ): Promise<void>;

  updateError(
    workflowId: string,
    status: Status,
    timeoutAt: Date,
    failures: number,
    lastError: string
  ): Promise<void>;
}

export interface Config {
  handlers: Map<string, Handler>;
  clock: Clock;
  persistence: Persistence;
  maxFailures?: number;
  timeoutIntervalMs?: number;
  pollIntervalMs?: number;
}

class LidexError extends Error {
  name: string;

  constructor(message: string) {
    super(message);
    this.name = ERROR_NAME;
  }
}

function makeClaim(
  persistence: Persistence,
  clock: Clock,
  timeoutIntervalMs: number
) {
  return async function (): Promise<string | undefined> {
    const t = clock.now();
    const timeoutAt = new Date(t.getTime() + timeoutIntervalMs);
    return persistence.claimWorkflow(clock, timeoutAt);
  };
}

function makeMakeStep(
  persistence: Persistence,
  clock: Clock,
  timeoutIntervalMs: number
) {
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
      const t = clock.now();
      const timeoutAt = new Date(t.getTime() + timeoutIntervalMs);
      await persistence.setOutput(workflowId, stepId, output, timeoutAt);
      return output as T;
    };
  };
}

function makeMakeSleep(
  persistence: Persistence,
  clock: Clock,
  timeoutIntervalMs: number,
  sleeper: Sleeper
) {
  return function (workflowId: string) {
    return async function (napId: string, ms: number): Promise<void> {
      let sleepUntil = await persistence.findSleepUntil(workflowId, napId);
      const now = clock.now();

      if (sleepUntil != undefined) {
        const remainingMs = sleepUntil.getTime() - now.getTime();

        if (remainingMs > 0) {
          await sleeper.goSleep(remainingMs);
        }

        return;
      }

      sleepUntil = new Date(now.getTime() + ms);
      const timeoutAt = new Date(sleepUntil.getTime() + timeoutIntervalMs);
      await persistence.setSleepUntil(workflowId, napId, sleepUntil, timeoutAt);
      await sleeper.goSleep(ms);
    };
  };
}

function makeRun(
  persistence: Persistence,
  handlers: Map<string, Handler>,
  makeStep: (
    workflowId: string
  ) => <T>(actionId: string, fn: () => Promise<T>) => Promise<T>,
  makeSleep: (
    workflowId: string
  ) => (napId: string, ms: number) => Promise<void>,
  clock: Clock,
  start: <T>(id: string, handler: string, input: T) => Promise<boolean>,
  maxFailures: number,
  timeoutIntervalMs: number
) {
  return async function (workflowId: string): Promise<void> {
    const runData = await persistence.find(workflowId);

    if (!runData) {
      throw new LidexError(`workflow not found: ${workflowId}`);
    }

    const { handler, input, failures } = runData;
    const fn = handlers.get(handler);

    if (!fn) {
      throw new LidexError(`handler not found: ${handler}`);
    }

    const ctx: Context = {
      step: makeStep(workflowId),
      sleep: makeSleep(workflowId),
      start,
    };

    try {
      await fn(ctx, input);
      await persistence.setAsFinished(workflowId);
    } catch (error) {
      let lastError = "";

      if (error instanceof Error) {
        lastError = error.message;
      } else {
        lastError = JSON.stringify(error);
      }

      const failuresInc = (failures || 0) + 1;
      const status = failuresInc < maxFailures ? FAILED : ABORTED;
      const t = clock.now();
      const timeoutAt = new Date(t.getTime() + timeoutIntervalMs);

      await persistence.updateError(
        workflowId,
        status,
        timeoutAt,
        failuresInc,
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
    return await persistence.create(workflowId, handler, input);
  };
}

function makeWait(persistence: Persistence, sleeper: Sleeper) {
  return async function (
    workflowId: string,
    status: Status[],
    times: number,
    ms: number
  ): Promise<Status | undefined> {
    for (let i = 0; i < times; i++) {
      const result = await persistence.findByStatus(workflowId, status);

      if (result) {
        return result;
      }

      await sleeper.goSleep(ms);
    }

    return undefined;
  };
}

function makePoll(
  claim: () => Promise<string | undefined>,
  run: (workflowId: string) => Promise<void>,
  sleeper: Sleeper,
  pollIntervalMs: number
) {
  return async function (shouldStop: () => boolean): Promise<void> {
    while (!shouldStop()) {
      const workflowId = await claim();

      if (workflowId) {
        run(workflowId); // Intentionally not awaiting
      } else {
        await sleeper.goSleep(pollIntervalMs);
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
  const { clock, handlers, persistence } = config;
  const maxFailures = config.maxFailures || DEFAULT_MAX_FAILURES;
  const timeoutIntervalMs = config.timeoutIntervalMs || DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = config.pollIntervalMs || DEFAULT_POLL_MS;
  const mongo = new MongoClient(mongoUrl);
  const db = mongo.db();
  const workflows = db.collection<Workflow>(COLL_NAME);
  await workflows.createIndex({ id: 1 }, { unique: true });
  await workflows.createIndex({ status: 1 });
  await workflows.createIndex({ status: 1, timeoutAt: 1 });
  const start = makeStart(workflows, now);
  const wait = makeWait(workflows, goSleep);
  const claim = makeClaim(workflows, now, timeoutIntervalMs);
  const makeStep = makeMakeStep(workflows, timeoutIntervalMs, now);
  const makeSleep = makeMakeSleep(workflows, timeoutIntervalMs, goSleep, now);

  const run = makeRun(
    workflows,
    handlers,
    makeStep,
    makeSleep,
    now,
    start,
    maxFailures,
    timeoutIntervalMs
  );

  const poll = makePoll(claim, run, goSleep, pollIntervalMs);
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
