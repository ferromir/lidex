import { MongoClient } from "mongodb";
import goSleep from "sleep-promise";

const DEFAULT_COLL_NAME = "workflows";
const DEFAULT_TIMEOUT_MS = 300_000; // 5m
const DEFAULT_POLL_MS = 5_000; // 5s
const DEFAULT_MAX_FAILURES = 3;

type Status =
  | "idle"
  | "running"
  | "sleeping"
  | "failed"
  | "finished"
  | "aborted";

const IDLE: Status = "idle";
const RUNNING: Status = "running";
const SLEEPING: Status = "sleeping";
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

interface Context {
  act<T>(id: string, fn: () => Promise<T>): Promise<T>;
  sleep(id: string, ms: number): Promise<void>;
  start<T>(id: string, functionName: string, input: T): Promise<void>;
}

type WorkflowFn = (ctx: Context, input: unknown) => Promise<void>;

interface Config {
  mongoUrl: string;
  dbName: string;
  now: () => Date;
  functions: Map<string, WorkflowFn>;
  maxFailures?: number;
  timeoutIntervalMs?: number;
  pollIntervalMs?: number;
}

interface Client {
  start<T>(id: string, functionName: string, input: T): Promise<void>;

  wait(
    id: string,
    status: Status[],
    times: number,
    ms: number
  ): Promise<boolean>;

  poll(): Promise<void>;
}

export async function createClient(config: Config): Promise<Client> {
  const { mongoUrl, dbName, now, functions } = config;
  const maxFailures = config.maxFailures || DEFAULT_MAX_FAILURES;
  const timeoutIntervalMs = config.timeoutIntervalMs || DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = config.pollIntervalMs || DEFAULT_POLL_MS;
  const mongo = new MongoClient(mongoUrl);
  const db = mongo.db(dbName);
  const workflows = db.collection<Workflow>(DEFAULT_COLL_NAME);
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
          status: { $in: [RUNNING, SLEEPING, FAILED] },
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

      if (workflow.actions && workflow.actions[id]) {
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
          return;
        }
      }

      const sleepUntil = new Date(t.getTime() + ms);
      const timeoutAt = new Date(sleepUntil.getTime() + timeoutIntervalMs);

      const update = {
        $set: {
          status: SLEEPING,
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

    const ctx: Context = {
      act: act(workflowId),
      sleep: sleep(workflowId),
      start,
    };

    const fn = functions.get(workflow.functionName);

    if (!fn) {
      throw new Error(`function not found: ${workflow.functionName}`);
    }

    try {
      await fn(ctx, workflow.input);
      const update = { $set: { status: FINISHED } };
      await workflows.updateOne(filter, update);
    } catch (err) {
      console.error(err);
      let lastError = "";

      if (err instanceof Error) {
        lastError = err.message;
      } else {
        lastError = JSON.stringify(err);
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
    const workflow: Workflow = {
      id,
      functionName,
      input,
      status: IDLE,
    };

    await workflows.insertOne(workflow);
  }

  async function wait(
    id: string,
    status: Status[],
    times: number,
    ms: number
  ): Promise<boolean> {
    const filter = {
      id,
      status: { $in: status },
    };

    const options = {
      projection: {
        _id: 0,
        id: 1,
      },
    };

    for (let i = 0; i < times; i++) {
      const workflow = await workflows.findOne(filter, options);

      if (workflow) {
        return true;
      }

      await goSleep(ms);
    }

    return false;
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
