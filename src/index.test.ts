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

const config = {
  mongoUrl: "mongodb://localhost:27017/?directConnection=true",
  dbName: "lidex",
};

describe("createClient", () => {
  it("creates a Client instance", async () => {
    const now = () => new Date();
    const functions = new Map();
    const client = await createClient(functions, now, config);
    expect(createIndex).toHaveBeenNthCalledWith(1, { id: 1 }, { unique: true });
    expect(createIndex).toHaveBeenNthCalledWith(2, { status: 1 });
    expect(createIndex).toHaveBeenNthCalledWith(3, { status: 1, timeoutAt: 1 });
    expect(client.start).toBeDefined();
    expect(client.wait).toBeDefined();
    expect(client.poll).toBeDefined();
  });
});
