import { createClient } from "./index";

const createIndex = jest.fn();
const insertOne = jest.fn();

jest.mock("mongodb", () => ({
  MongoClient: jest.fn().mockImplementation(() => ({
    db: jest.fn().mockImplementation(() => ({
      collection: jest.fn().mockImplementation(() => ({
        createIndex,
        insertOne,
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

describe("start", () => {
  it("creates a workflow", async () => {
    const t = new Date();
    const now = () => t;
    const client = await createClient({ now });
    const created = await client.start("workflow-1", "function-1", "input-1");
    expect(created).toBeTruthy();
    const doc = insertOne.mock.calls[0][0];
    expect(doc.id).toBe("workflow-1");
    expect(doc.functionName).toBe("function-1");
    expect(doc.input).toBe("input-1");
    expect(doc.status).toBe("idle");
    expect(doc.createdAt).toBe(t);
  });

  it("returns false if 'id' already exists", async () => {
    insertOne.mockImplementation(() => {
      throw {
        name: "MongoServerError",
        code: 11000,
      };
    });

    const client = await createClient();
    const created = await client.start("workflow-1", "function-1", "input-1");
    expect(created).toBeFalsy();
  });

  it("fails if insert fails", async () => {
    insertOne.mockImplementation(() => {
      throw new Error("test");
    });

    const client = await createClient();
    const p = client.start("workflow-1", "function-1", "input-1");
    await expect(p).rejects.toThrow("test");
  });
});
