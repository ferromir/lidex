import { Persistence } from "./model";

export function makeStart(persistence: Persistence) {
  return async function <T>(
    workflowId: string,
    handler: string,
    input: T,
  ): Promise<boolean> {
    return persistence.insert(workflowId, handler, input);
  };
}
