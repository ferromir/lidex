import { createClient } from "./index";

const createIndex = jest.fn();
const insertOne = jest.fn();
const findOne = jest.fn();
const findOneAndUpdate = jest.fn();

jest.mock("mongodb", () => ({
  MongoClient: jest.fn().mockImplementation(() => ({
    db: jest.fn().mockImplementation(() => ({
      collection: jest.fn().mockImplementation(() => ({
        createIndex,
        insertOne,
        findOne,
        findOneAndUpdate,
      })),
    })),
  })),
}));

const goSleep = jest.fn();

jest.mock("sleep-promise", () => {
  const m = jest.fn();
  return {
    ...jest.requireActual("sleep-promise"),
    __esModule: true,
    default: m.mockImplementation((...args) => goSleep(...args)),
  };
});

describe("createClient", () => {
  it("creates a Client instance", async () => {
    const client = await createClient();
    expect(client.start).toBeDefined();
    expect(client.wait).toBeDefined();
    expect(client.poll).toBeDefined();
    expect(createIndex).toHaveBeenNthCalledWith(1, { id: 1 }, { unique: true });
    expect(createIndex).toHaveBeenNthCalledWith(2, { status: 1 });
    expect(createIndex).toHaveBeenNthCalledWith(3, { status: 1, timeoutAt: 1 });
  });
});

describe("start", () => {
  beforeEach(() => {
    insertOne.mockReset();
  });

  it("creates a workflow", async () => {
    const t = new Date("2011-10-05T14:48:00.000Z");
    const client = await createClient({ now: () => t });
    const created = await client.start("workflow-1", "function-1", "input-1");
    expect(created).toBeTruthy();

    expect(insertOne).toHaveBeenCalledWith({
      id: "workflow-1",
      functionName: "function-1",
      input: "input-1",
      status: "idle",
      createdAt: t,
    });
  });

  it("returns false if 'id' already exists", async () => {
    insertOne.mockImplementation(() => {
      throw {
        name: "MongoServerError",
        code: 11000,
      };
    });

    const t = new Date("2011-10-05T14:48:00.000Z");
    const client = await createClient({ now: () => t });
    const created = await client.start("workflow-1", "function-1", "input-1");
    expect(created).toBeFalsy();

    expect(insertOne).toHaveBeenCalledWith({
      id: "workflow-1",
      functionName: "function-1",
      input: "input-1",
      status: "idle",
      createdAt: t,
    });
  });

  it("fails if insert fails", async () => {
    insertOne.mockImplementation(() => {
      throw new Error("test");
    });

    const t = new Date("2011-10-05T14:48:00.000Z");
    const client = await createClient({ now: () => t });
    const p = client.start("workflow-1", "function-1", "input-1");
    await expect(p).rejects.toThrow("test");

    expect(insertOne).toHaveBeenCalledWith({
      id: "workflow-1",
      functionName: "function-1",
      input: "input-1",
      status: "idle",
      createdAt: t,
    });
  });
});

describe("wait", () => {
  beforeEach(() => {
    findOne.mockReset();
    goSleep.mockReset();
  });

  it("tries n times to find a matching workflow", async () => {
    findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: "finished" });

    const client = await createClient();
    const status = await client.wait("workflow-1", ["finished"], 2, 10);
    expect(status).toBe("finished");

    for (let i = 0; i < 2; i++) {
      expect(findOne).toHaveBeenNthCalledWith(
        i + 1,
        {
          id: "workflow-1",
          status: { $in: ["finished"] },
        },
        {
          projection: {
            _id: 0,
            status: 1,
          },
        }
      );
    }

    expect(goSleep).toHaveBeenCalledWith(10);
  });

  it("returns undefined when it can't find the workflow", async () => {
    const client = await createClient();
    const status = await client.wait("workflow-1", ["finished"], 1, 10);
    expect(status).toBeUndefined();

    expect(findOne).toHaveBeenCalledWith(
      {
        id: "workflow-1",
        status: { $in: ["finished"] },
      },
      {
        projection: {
          _id: 0,
          status: 1,
        },
      }
    );
  });
});

describe("poll", () => {
  beforeEach(() => {
    goSleep.mockReset();
  });

  it("waits before polling if no workflow is claimed", async () => {
    goSleep.mockImplementation(() => {
      throw new Error("abort");
    });

    const client = await createClient();
    await expect(client.poll()).rejects.toThrow("abort");
  });
});
