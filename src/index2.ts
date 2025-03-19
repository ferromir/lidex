import { Collection, MongoClient } from "mongodb";
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

export interface Workflow {
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

function makeClaim(
  now: () => Date,
  timeoutIntervalMs: number,
  workflows: Collection<Workflow>
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

function makeAct(workflows: Collection<Workflow>, workflowId: string) {
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

export const onlyForTesting = {
  makeClaim,
  makeAct,
};
