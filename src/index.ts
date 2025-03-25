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

/**
 * For internal usage only.
 */
export interface Workflow {
  id: string;
  handler: string;
  input: unknown;
  status: Status;
  createdAt: Date;
  timeoutAt?: Date;
  steps?: { [key: string]: unknown };
  naps?: { [key: string]: Date };
  failures?: number;
  lastError?: string;
}

export interface Config {
  handlers: Map<string, Handler>;
  now: () => Date;
  mongoUrl: string;
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
  workflows: Collection<Workflow>,
  now: () => Date,
  timeoutIntervalMs: number
) {
  return async function (): Promise<string | undefined> {
    const t = now();
    const timeoutAt = new Date(t.getTime() + timeoutIntervalMs);

    const workflow = await workflows.findOneAndUpdate(
      {
        $or: [
          { status: IDLE },
          {
            status: { $in: [RUNNING, FAILED] },
            timeoutAt: { $lt: t },
          },
        ],
      },
      {
        $set: {
          status: RUNNING,
          timeoutAt,
        },
      },
      {
        projection: {
          _id: 0,
          id: 1,
        },
      }
    );

    return workflow?.id;
  };
}

function makeMakeStep(
  workflows: Collection<Workflow>,
  timeoutIntervalMs: number,
  now: () => Date
) {
  return function (workflowId: string) {
    return async function <T>(id: string, fn: () => Promise<T>): Promise<T> {
      const workflow = await workflows.findOne(
        {
          id: workflowId,
        },
        {
          projection: {
            _id: 0,
            [`steps.${id}`]: 1,
          },
        }
      );

      if (!workflow) {
        throw new LidexError(`workflow not found: ${workflowId}`);
      }

      if (workflow.steps && workflow.steps[id] != undefined) {
        return workflow.steps[id] as T;
      }

      const output = await fn();
      const timeoutAt = new Date(now().getTime() + timeoutIntervalMs);

      await workflows.updateOne(
        {
          id: workflowId,
        },
        {
          $set: {
            [`steps.${id}`]: output,
            timeoutAt,
          },
        }
      );

      return output as T;
    };
  };
}

function makeMakeSleep(
  workflows: Collection<Workflow>,
  timeoutIntervalMs: number,
  goSleep: (ms: number) => Promise<void>,
  now: () => Date
) {
  return function (workflowId: string) {
    return async function (id: string, ms: number): Promise<void> {
      const workflow = await workflows.findOne(
        {
          id: workflowId,
        },
        {
          projection: {
            _id: 0,
            [`naps.${id}`]: 1,
          },
        }
      );

      if (!workflow) {
        throw new LidexError(`workflow not found: ${workflowId}`);
      }

      const t = now();

      if (workflow.naps && workflow.naps[id]) {
        const remainingMs = workflow.naps[id].getTime() - t.getTime();

        if (remainingMs > 0) {
          await goSleep(remainingMs);
        }

        return;
      }

      const sleepUntil = new Date(t.getTime() + ms);
      const timeoutAt = new Date(sleepUntil.getTime() + timeoutIntervalMs);

      await workflows.updateOne(
        {
          id: workflowId,
        },
        {
          $set: {
            [`naps.${id}`]: sleepUntil,
            timeoutAt,
          },
        }
      );

      await goSleep(ms);
    };
  };
}

function makeRun(
  workflows: Collection<Workflow>,
  handlers: Map<string, Handler>,
  makeStep: (
    workflowId: string
  ) => <T>(stepId: string, fn: () => Promise<T>) => Promise<T>,
  makeSleep: (
    workflowId: string
  ) => (napId: string, ms: number) => Promise<void>,
  now: () => Date,
  start: <T>(id: string, handler: string, input: T) => Promise<boolean>,
  maxFailures: number,
  timeoutIntervalMs: number
) {
  return async function (workflowId: string): Promise<void> {
    const workflow = await workflows.findOne(
      {
        id: workflowId,
      },
      {
        projection: {
          _id: 0,
          handler: 1,
          input: 1,
          failures: 1,
        },
      }
    );

    if (!workflow) {
      throw new LidexError(`workflow not found: ${workflowId}`);
    }

    const fn = handlers.get(workflow.handler);

    if (!fn) {
      throw new LidexError(`handler not found: ${workflow.handler}`);
    }

    const ctx: Context = {
      step: makeStep(workflowId),
      sleep: makeSleep(workflowId),
      start,
    };

    try {
      await fn(ctx, workflow.input);

      await workflows.updateOne(
        {
          id: workflowId,
        },
        {
          $set: { status: FINISHED },
        }
      );
    } catch (error) {
      let lastError = "";

      if (error instanceof Error) {
        lastError = error.message;
      } else {
        lastError = JSON.stringify(error);
      }

      const failures = (workflow.failures || 0) + 1;
      const status = failures < maxFailures ? FAILED : ABORTED;
      const t = now();
      const timeoutAt = new Date(t.getTime() + timeoutIntervalMs);

      await workflows.updateOne(
        {
          id: workflowId,
        },
        {
          $set: {
            status,
            timeoutAt,
            failures,
            lastError,
          },
        }
      );
    }
  };
}

function makeStart(workflows: Collection<Workflow>, now: () => Date) {
  return async function <T>(
    id: string,
    handler: string,
    input: T
  ): Promise<boolean> {
    try {
      await workflows.insertOne({
        id,
        handler,
        input,
        status: IDLE,
        createdAt: now(),
      });

      return true;
    } catch (error) {
      const e = error as { name: string; code: number };

      // Workflow already started, ignore.
      if (e.name === MONGO_ERROR_NAME && e.code === MONGO_ERROR_CODE) {
        return false;
      }

      throw error;
    }
  };
}

function makeWait(
  workflows: Collection<Workflow>,
  goSleep: (ms: number) => Promise<void>
) {
  return async function (
    id: string,
    status: Status[],
    times: number,
    ms: number
  ): Promise<Status | undefined> {
    for (let i = 0; i < times; i++) {
      const workflow = await workflows.findOne(
        {
          id,
          status: { $in: status },
        },
        {
          projection: {
            _id: 0,
            status: 1,
          },
        }
      );

      if (workflow) {
        return workflow.status;
      }

      await goSleep(ms);
    }

    return undefined;
  };
}

function makePoll(
  claim: () => Promise<string | undefined>,
  run: (workflowId: string) => Promise<void>,
  goSleep: (ms: number) => Promise<void>,
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
  const { now, handlers, mongoUrl } = config;
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
