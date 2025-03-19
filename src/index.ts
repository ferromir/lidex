import { MongoClient } from "mongodb";
import goSleep from "sleep-promise";

const COLL_NAME = "workflows";
const DEFAULT_MAX_FAILURES = 3;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_MS = 1_000;
const DEFAULT_MONGO_URL = "mongodb://localhost:27017/lidex";
const ERROR_NAME = "LidexError";
const MONGO_ERROR_NAME = "MongoServerError";
const MONGO_ERROR_CODE = 11000;
const IDLE = "idle";
const RUNNING = "running";
const FAILED = "failed";
const FINISHED = "finished";
const ABORTED = "aborted";

export type Status = "idle" | "running" | "failed" | "finished" | "aborted";

interface Workflow {
  id: string;
  functionName: string;
  input: unknown;
  status: Status;
  createdAt: Date;
  timeoutAt?: Date;
  actions?: { [key: string]: unknown };
  naps?: { [key: string]: Date };
  failures?: number;
  lastError?: string;
}

export interface Context {
  act<T>(id: string, fn: () => Promise<T>): Promise<T>;
  sleep(id: string, ms: number): Promise<void>;
  start<T>(id: string, functionName: string, input: T): Promise<void>;
}

export type WorkflowFn = (ctx: Context, input: unknown) => Promise<void>;

export interface Client {
  start<T>(id: string, functionName: string, input: T): Promise<boolean>;

  wait(
    id: string,
    status: Status[],
    times: number,
    ms: number
  ): Promise<Status | undefined>;

  poll(): Promise<void>;
}

export interface Config {
  functions?: Map<string, WorkflowFn>;
  now?: () => Date;
  mongoUrl?: string;
  maxFailures?: number;
  timeoutIntervalMs?: number;
  pollIntervalMs?: number;
}

export class LidexError extends Error {
  name: string;

  constructor(message: string) {
    super(message);
    this.name = ERROR_NAME;
  }
}

export async function createClient(config: Config = {}): Promise<Client> {
  const functions = config.functions || new Map();
  const now = config.now || (() => new Date());
  const mongoUrl = config.mongoUrl || DEFAULT_MONGO_URL;
  const maxFailures = config.maxFailures || DEFAULT_MAX_FAILURES;
  const timeoutIntervalMs = config.timeoutIntervalMs || DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = config.pollIntervalMs || DEFAULT_POLL_MS;
  const mongo = new MongoClient(mongoUrl);
  const db = mongo.db();
  const workflows = db.collection<Workflow>(COLL_NAME);
  await workflows.createIndex({ id: 1 }, { unique: true });
  await workflows.createIndex({ status: 1 });
  await workflows.createIndex({ status: 1, timeoutAt: 1 });

  async function claim(): Promise<string | undefined> {
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
  }

  function act(workflowId: string) {
    return async function <T>(id: string, fn: () => Promise<T>): Promise<T> {
      const workflow = await workflows.findOne(
        {
          id: workflowId,
        },
        {
          projection: {
            _id: 0,
            [`actions.${id}`]: 1,
          },
        }
      );

      if (!workflow) {
        throw new LidexError(`workflow not found: ${workflowId}`);
      }

      if (workflow.actions && workflow.actions[id] != undefined) {
        return workflow.actions[id] as T;
      }

      const output = await fn();

      await workflows.updateOne(
        {
          id: workflowId,
        },
        {
          $set: { [`actions.${id}`]: output },
        }
      );

      return output;
    };
  }

  function sleep(workflowId: string) {
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
  }

  async function run(workflowId: string): Promise<void> {
    const workflow = await workflows.findOne(
      {
        id: workflowId,
      },
      {
        projection: {
          _id: 0,
          functionName: 1,
          input: 1,
          failures: 1,
        },
      }
    );

    if (!workflow) {
      throw new LidexError(`workflow not found: ${workflowId}`);
    }

    const fn = functions.get(workflow.functionName);

    if (!fn) {
      throw new LidexError(`function not found: ${workflow.functionName}`);
    }

    const ctx = {
      act: act(workflowId),
      sleep: sleep(workflowId),
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
  }

  async function start<T>(
    id: string,
    functionName: string,
    input: T
  ): Promise<boolean> {
    try {
      await workflows.insertOne({
        id,
        functionName,
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
  }

  async function wait(
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
  }

  async function poll(): Promise<void> {
    while (true) {
      const workflowId = await claim();

      if (workflowId) {
        run(workflowId); // Intentionally not awaiting
      } else {
        await goSleep(pollIntervalMs);
      }
    }
  }

  return {
    start,
    wait,
    poll,
  };
}
