import { MongoClient } from "mongodb";
import goSleep from "sleep-promise";

const COLL_NAME = "workflows";

type Status = "idle" | "running" | "failed" | "finished" | "aborted";

const IDLE: Status = "idle";
const RUNNING: Status = "running";
const FAILED: Status = "failed";
const FINISHED: Status = "finished";
const ABORTED: Status = "aborted";

interface Workflow {
  id: string;
  functionName: string;
  input: unknown;
  status: Status;
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

type WorkflowFn = (ctx: Context, input: unknown) => Promise<void>;

export interface Client {
  start<T>(id: string, functionName: string, input: T): Promise<void>;
  status(id: string): Promise<Status | undefined>;

  wait(
    id: string,
    status: Status[],
    times: number,
    ms: number
  ): Promise<Status | undefined>;

  poll(): Promise<void>;
}

export async function createClient(
  functions: Map<string, WorkflowFn>,
  now: () => Date = () => new Date(),
  mongoUrl: string = "mongodb://localhost:27017/lidex",
  maxFailures: number = 3,
  timeoutIntervalMs: number = 300_000,
  pollIntervalMs: number = 5_000
): Promise<Client> {
  const mongo = new MongoClient(mongoUrl);
  const db = mongo.db();
  const workflows = db.collection<Workflow>(COLL_NAME);
  await workflows.createIndex({ id: 1 }, { unique: true });
  await workflows.createIndex({ status: 1 });
  await workflows.createIndex({ status: 1, timeoutAt: 1 });

  async function claim(): Promise<string | undefined> {
    const t = now();
    const timeoutAt = new Date(t.getTime() + timeoutIntervalMs);

    const filter = {
      $or: [
        { status: IDLE },
        {
          status: { $in: [RUNNING, FAILED] },
          timeoutAt: { $lt: t },
        },
      ],
    };

    const update = {
      $set: {
        status: RUNNING,
        timeoutAt,
      },
    };

    const options = {
      projection: {
        _id: 0,
        id: 1,
      },
    };

    const workflow = await workflows.findOneAndUpdate(filter, update, options);
    return workflow?.id;
  }

  function act(workflowId: string) {
    return async function <T>(id: string, fn: () => Promise<T>): Promise<T> {
      const filter = { id: workflowId };

      const options = {
        projection: {
          _id: 0,
          [`actions.${id}`]: 1,
        },
      };

      const workflow = await workflows.findOne(filter, options);

      if (!workflow) {
        throw new Error(`workflow not found: ${workflowId}`);
      }

      if (workflow.actions && workflow.actions[id] != undefined) {
        return workflow.actions[id] as T;
      }

      const output = await fn();
      const update = { $set: { [`actions.${id}`]: output } };
      await workflows.updateOne(filter, update);
      return output;
    };
  }

  function sleep(workflowId: string) {
    return async function (id: string, ms: number): Promise<void> {
      const filter = { id: workflowId };

      const options = {
        projection: {
          _id: 0,
          [`naps.${id}`]: 1,
        },
      };

      const workflow = await workflows.findOne(filter, options);

      if (!workflow) {
        throw new Error(`workflow not found: ${workflowId}`);
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

      const update = {
        $set: {
          [`naps.${id}`]: sleepUntil,
          timeoutAt,
        },
      };

      await workflows.updateOne(filter, update);
      await goSleep(ms);
    };
  }

  async function run(workflowId: string): Promise<void> {
    const filter = { id: workflowId };

    const options = {
      projection: {
        _id: 0,
        functionName: 1,
        input: 1,
        failures: 1,
      },
    };

    const workflow = await workflows.findOne(filter, options);

    if (!workflow) {
      throw new Error(`workflow not found: ${workflowId}`);
    }

    const fn = functions.get(workflow.functionName);

    if (!fn) {
      throw new Error(`function not found: ${workflow.functionName}`);
    }

    const ctx = {
      act: act(workflowId),
      sleep: sleep(workflowId),
      start,
    };

    try {
      await fn(ctx, workflow.input);
      const update = { $set: { status: FINISHED } };
      await workflows.updateOne(filter, update);
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

      const update = {
        $set: {
          status,
          timeoutAt,
          failures,
          lastError,
        },
      };

      await workflows.updateOne(filter, update);
    }
  }

  async function start<T>(
    id: string,
    functionName: string,
    input: T
  ): Promise<void> {
    const workflow = {
      id,
      functionName,
      input,
      status: IDLE,
    };

    try {
      await workflows.insertOne(workflow);
    } catch (error) {
      const e = error as { name: string; code: number };

      // Workflow already started, ignore.
      if (e.name === "MongoServerError" && e.code === 11000) {
        return;
      }

      throw error;
    }
  }

  async function status(id: string): Promise<Status | undefined> {
    const filter = { id };

    const options = {
      projection: {
        _id: 0,
        id: 1,
      },
    };

    const workflow = await workflows.findOne(filter, options);
    return workflow?.status;
  }

  async function wait(
    id: string,
    status: Status[],
    times: number,
    ms: number
  ): Promise<Status | undefined> {
    const filter = {
      id,
      status: { $in: status },
    };

    const options = {
      projection: {
        _id: 0,
        status: 1,
      },
    };

    for (let i = 0; i < times; i++) {
      const workflow = await workflows.findOne(filter, options);

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
    status,
    wait,
    poll,
  };
}
