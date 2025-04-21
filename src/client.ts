import { Client, Persistence, Status } from "./model";
import { goSleep } from "./go-sleep";
import { makeStart } from "./common";

export function makeWait(persistence: Persistence) {
  return async function (
    workflowId: string,
    status: Status[],
    times: number,
    ms: number,
  ): Promise<Status | undefined> {
    for (let i = 0; i < times; i++) {
      const foundStatus = await persistence.findStatus(workflowId);

      if (foundStatus && status.includes(foundStatus)) {
        return foundStatus;
      }

      await goSleep(ms);
    }

    return undefined;
  };
}
export async function makeClient(persistence: Persistence): Promise<Client> {
  const start = makeStart(persistence);
  const wait = makeWait(persistence);
  return { start, wait };
}
