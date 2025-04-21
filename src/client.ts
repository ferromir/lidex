import { makeWait } from "./client-internal";
import { makeStart } from "./common";
import { Client, Persistence } from "./model";

export async function makeClient(persistence: Persistence): Promise<Client> {
  const start = makeStart(persistence);
  const wait = makeWait(persistence);
  return { start, wait };
}
