import { makeClient } from ".";

jest.mock("mongodb", () => ({
  MongoClient: jest.fn().mockImplementation(() => ({
    db: jest.fn().mockImplementation(() => ({
      collection: jest.fn().mockImplementation(() => ({
        createIndex: jest.fn(),
      })),
    })),
  })),
}));

describe("createClient", () => {
  it("creates a Client", async () => {
    const client = await makeClient({
      handlers: new Map(),
      now: () => new Date("2011-10-05T14:48:00.000Z"),
      mongoUrl: "mongodb://localhost:27017/lidex",
    });

    expect(client).toBeDefined();
  });
});
