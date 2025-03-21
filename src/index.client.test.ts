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
    const client = await makeClient();
    expect(client).toBeDefined();
  });
});
