import { makeClient, makeWorker } from "./index";

test("should export makeClient", () => {
  expect(typeof makeClient).toBe("function");
});

test("should export makeWorker", () => {
  expect(typeof makeWorker).toBe("function");
});
