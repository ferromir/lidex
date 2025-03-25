import goSleep from "sleep-promise";

const DEFAULT_MAX_FAILURES = 3;
const DEFAULT_TIMEOUT_MS = 60_000; // 1m
const DEFAULT_POLL_MS = 1_000; // 1s

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

export interface Workflow {
  id: string;
  handler: string;
  input: unknown;
  status: Status;
  timeoutAt?: Date;
  failures?: number;
  lastError?: string;
}

export interface Step {
  id: string;
  workflowId: string;
  output: unknown;
}

export interface Nap {
  id: string;
  workflowId: string;
  wakeUpAt: Date;
}

export interface Clock {
  now(): Date;
}

export interface Config {
  handlers: Map<string, Handler>;
  clock: Clock;
  persistence: Persistence;
  maxFailures?: number;
  timeoutIntervalMs?: number;
  pollIntervalMs?: number;
}

export interface Persistence {
  insertWorkflow(workflow: Workflow): Promise<boolean>;
  updateWorkflow(workflow: Workflow): Promise<void>;
  claimWorkflow(timeoutAt: Date): Promise<Workflow | undefined>;
  findWorkflow(workflowId: string): Promise<Workflow | undefined>;
  findStep(workflowId: string, stepId: string): Promise<Step | undefined>;
  updateWorkflowAndInsertStep(workflow: Workflow, step: Step): Promise<void>;
  findNap(workflowId: string, napId: string): Promise<Nap | undefined>;
  updateWorkflowAndInsertNap(workflow: Workflow, nap: Nap): Promise<void>;
}

function makeClaim(
  persistence: Persistence,
  clock: Clock,
  timeoutIntervalMs: number
) {
  return async function (): Promise<string | undefined> {
    const now = clock.now();
    const timeoutAt = new Date(now.getTime() + timeoutIntervalMs);
    const workflow = await persistence.claimWorkflow(timeoutAt);
    return workflow?.id;
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
      const workflow = await persistence.findWorkflow(workflowId);

      if (!workflow) {
        throw new Error(`workflow not found: ${workflowId}`);
      }

      let step = await persistence.findStep(workflowId, stepId);

      if (step != undefined) {
        return step.output as T;
      }

      const output = await fn();

      step = {
        id: stepId,
        workflowId,
        output,
      };

      const now = clock.now();
      const timeoutAt = new Date(now.getTime() + timeoutIntervalMs);
      workflow.timeoutAt = timeoutAt;
      await persistence.updateWorkflowAndInsertStep(workflow, step);
      return output as T;
    };
  };
}

function makeMakeSleep(
  persistence: Persistence,
  clock: Clock,
  timeoutIntervalMs: number,
  goSleep: (ms: number) => Promise<void>
) {
  return function (workflowId: string) {
    return async function (napId: string, ms: number): Promise<void> {
      const workflow = await persistence.findWorkflow(workflowId);

      if (!workflow) {
        throw new Error(`workflow not found: ${workflowId}`);
      }

      let nap = await persistence.findNap(workflowId, napId);
      const now = clock.now();

      if (nap) {
        const remainingMs = nap.wakeUpAt.getTime() - now.getTime();

        if (remainingMs > 0) {
          await goSleep(remainingMs);
        }

        return;
      }

      const wakeUpAt = new Date(now.getTime() + ms);

      nap = {
        id: napId,
        workflowId,
        wakeUpAt,
      };

      const timeoutAt = new Date(wakeUpAt.getTime() + timeoutIntervalMs);
      workflow.timeoutAt = timeoutAt;
      await persistence.updateWorkflowAndInsertNap(workflow, nap);
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
  clock: Clock,
  start: <T>(id: string, handler: string, input: T) => Promise<boolean>,
  maxFailures: number,
  timeoutIntervalMs: number
) {
  return async function (workflowId: string): Promise<void> {
    const workflow = await persistence.findWorkflow(workflowId);

    if (!workflow) {
      throw new Error(`workflow not found: ${workflowId}`);
    }

    const fn = handlers.get(workflow.handler);

    if (!fn) {
      throw new Error(`handler not found: ${workflow.handler}`);
    }

    const ctx: Context = {
      step: makeStep(workflowId),
      sleep: makeSleep(workflowId),
      start,
    };

    try {
      await fn(ctx, workflow.input);
      workflow.status = "finished";
      await persistence.updateWorkflow(workflow);
    } catch (error) {
      let lastError = "";

      if (error instanceof Error) {
        lastError = error.message;
      } else {
        lastError = JSON.stringify(error);
      }

      const failures = (workflow.failures || 0) + 1;
      const status = failures < maxFailures ? "failed" : "aborted";
      const now = clock.now();
      const timeoutAt = new Date(now.getTime() + timeoutIntervalMs);
      workflow.failures = failures;
      workflow.status = status;
      workflow.timeoutAt = timeoutAt;
      workflow.lastError = lastError;
      await persistence.updateWorkflow(workflow);
    }
  };
}

function makeStart(persistence: Persistence) {
  return async function <T>(
    workflowId: string,
    handler: string,
    input: T
  ): Promise<boolean> {
    const workflow: Workflow = {
      id: workflowId,
      handler,
      input,
      status: "idle",
    };

    return await persistence.insertWorkflow(workflow);
  };
}

function makeWait(
  persistence: Persistence,
  goSleep: (ms: number) => Promise<void>
) {
  return async function (
    workflowId: string,
    status: Status[],
    times: number,
    pauseMs: number
  ): Promise<Status | undefined> {
    for (let i = 0; i < times; i++) {
      const workflow = await persistence.findWorkflow(workflowId);

      if (workflow && status.includes(workflow.status)) {
        return workflow.status;
      }

      await goSleep(pauseMs);
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
  const { clock, handlers, persistence } = config;
  const maxFailures = config.maxFailures || DEFAULT_MAX_FAILURES;
  const timeoutIntervalMs = config.timeoutIntervalMs || DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = config.pollIntervalMs || DEFAULT_POLL_MS;
  const start = makeStart(persistence);
  const wait = makeWait(persistence, goSleep);
  const claim = makeClaim(persistence, clock, timeoutIntervalMs);
  const makeStep = makeMakeStep(persistence, clock, timeoutIntervalMs);

  const makeSleep = makeMakeSleep(
    persistence,
    clock,
    timeoutIntervalMs,
    goSleep
  );

  const run = makeRun(
    persistence,
    handlers,
    makeStep,
    makeSleep,
    clock,
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
