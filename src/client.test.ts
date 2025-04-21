import { mock } from "jest-mock-extended";
import { makeClient } from "./client"; // adjust the path as needed
import { Persistence, Client } from "./model";
import * as common from "./common";
import * as internal from "./client-internal";

jest.mock("./common", () => ({
  makeStart: jest.fn(),
}));

jest.mock("./client-internal", () => ({
  makeWait: jest.fn(),
}));

describe("makeClient", () => {
  const mockPersistence = mock<Persistence>();
  const mockStart = jest.fn();
  const mockWait = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    (common.makeStart as jest.Mock).mockReturnValue(mockStart);
    (internal.makeWait as jest.Mock).mockReturnValue(mockWait);
  });

  it("should return a Client with start and wait functions", async () => {
    const client: Client = await makeClient(mockPersistence);

    expect(common.makeStart).toHaveBeenCalledWith(mockPersistence);
    expect(internal.makeWait).toHaveBeenCalledWith(mockPersistence);

    expect(client.start).toBe(mockStart);
    expect(client.wait).toBe(mockWait);
  });
});
