import { Persistence } from "./model";

export async function goSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

export function makeStart(persistence: Persistence) {
  return async function <T>(
    workflowId: string,
    handler: string,
    input: T,
  ): Promise<boolean> {
    return persistence.insert(workflowId, handler, input);
  };
}
