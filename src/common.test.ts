import { mock } from "jest-mock-extended";
import { makeStart } from "./common";
import type { Persistence } from "./model";

const persistence = mock<Persistence>();

afterEach(() => {
  jest.clearAllMocks();
});

test("makeStart inserts workflow", async () => {
  const start = makeStart(persistence);
  await start("id", "handler", { foo: "bar" });
  expect(persistence.insert).toHaveBeenCalledWith("id", "handler", {
    foo: "bar",
  });
});
