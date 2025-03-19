import { createClient } from "./index";

const createIndex = jest.fn();

jest.mock("mongodb", () => ({
  MongoClient: jest.fn().mockImplementation(() => ({
    db: jest.fn().mockImplementation(() => ({
      collection: jest.fn().mockImplementation(() => ({
        createIndex,
      })),
    })),
  })),
}));

describe("createClient", () => {
  it("creates a Client instance", async () => {
    const client = await createClient();
    expect(createIndex).toHaveBeenNthCalledWith(1, { id: 1 }, { unique: true });
    expect(createIndex).toHaveBeenNthCalledWith(2, { status: 1 });
    expect(createIndex).toHaveBeenNthCalledWith(3, { status: 1, timeoutAt: 1 });
    expect(client.start).toBeDefined();
    expect(client.wait).toBeDefined();
    expect(client.poll).toBeDefined();
  });
});
