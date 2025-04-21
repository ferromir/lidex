import { makeClient, makeWorker } from "./index";

test("should re-export", () => {
  expect(typeof makeClient).toBe("function");
  expect(typeof makeWorker).toBe("function");
});
