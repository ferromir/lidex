import { goSleep } from "./common";
import { Persistence, Status } from "./model";

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
