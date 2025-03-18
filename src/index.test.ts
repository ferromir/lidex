import { Client, createClient } from "./index";

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
  const now = () => new Date();
  const mongoUrl = "mongodb://localhost:27017/?directConnection=true";
  const dbName = "lidex";
  const functions = new Map();
  const config = { mongoUrl, dbName };
  let client: Client;

  beforeEach(async () => {
    createIndex.mockReset();
    client = await createClient(functions, now, config);
  });

  it("creates indexes for the collection", async () => {
    expect(createIndex).toHaveBeenNthCalledWith(1, { id: 1 }, { unique: true });
    expect(createIndex).toHaveBeenNthCalledWith(2, { status: 1 });
    expect(createIndex).toHaveBeenNthCalledWith(3, { status: 1, timeoutAt: 1 });
  });

  it("creates a client", async () => {
    expect(client.start).toBeDefined();
    expect(client.wait).toBeDefined();
    expect(client.poll).toBeDefined();
  });
});
