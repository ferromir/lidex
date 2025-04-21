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

export interface WorkerOptions {
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
