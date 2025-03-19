import { Context, createClient } from "./index";

const createIndex = jest.fn();
const insertOne = jest.fn();
const findOne = jest.fn();
const findOneAndUpdate = jest.fn();
const updateOne = jest.fn();

jest.mock("mongodb", () => ({
  MongoClient: jest.fn().mockImplementation(() => ({
    db: jest.fn().mockImplementation(() => ({
      collection: jest.fn().mockImplementation(() => ({
        createIndex,
        insertOne,
        findOne,
        findOneAndUpdate,
        updateOne,
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

beforeEach(() => {
  createIndex.mockReset();
  insertOne.mockReset();
  findOne.mockReset();
  findOneAndUpdate.mockReset();
  updateOne.mockReset();
  goSleep.mockReset();
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
  it("creates a workflow", async () => {
    const t = new Date("2011-10-05T14:48:00.000Z");
    const client = await createClient({ now: () => t });
    const created = await client.start("workflow-1", "function-1", "input-1");
    expect(created).toBeTruthy();
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
  });

  it("fails if insert fails", async () => {
    insertOne.mockImplementation(() => {
      throw new Error("test");
    });

    const t = new Date("2011-10-05T14:48:00.000Z");
    const client = await createClient({ now: () => t });
    const p = client.start("workflow-1", "function-1", "input-1");
    await expect(p).rejects.toThrow("test");
  });
});

describe("wait", () => {
  it("tries n times to find a matching workflow", async () => {
    findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: "finished" });

    const client = await createClient();
    const status = await client.wait("workflow-1", ["finished"], 2, 10);
    expect(status).toBe("finished");
  });

  it("returns undefined when it can't find the workflow", async () => {
    const client = await createClient();
    const status = await client.wait("workflow-1", ["finished"], 1, 10);
    expect(status).toBeUndefined();
  });
});

describe("poll", () => {
  it("waits before polling if no workflow is claimed", async () => {
    goSleep.mockImplementation(() => {
      throw new Error("abort");
    });

    const client = await createClient();
    await expect(client.poll()).rejects.toThrow("abort");
  });
});

describe("run", () => {
  it("runs a workflows that succeeds", async () => {
    findOneAndUpdate.mockImplementationOnce(() => {
      return Promise.resolve({ id: "workflow-1" });
    });

    findOne.mockImplementation(() => {
      return Promise.resolve({
        functionName: "function-1",
        input: "input-1",
      });
    });

    goSleep.mockImplementation(() => {
      throw new Error("abort");
    });

    function fn1(_ctx: Context, _input: string): Promise<void> {
      return Promise.resolve();
    }

    const functions = new Map();
    functions.set("function-1", fn1);
    const client = await createClient({ functions });
    await expect(client.poll()).rejects.toThrow("abort");
  });

  it("runs a workflows that fails", async () => {
    findOneAndUpdate.mockImplementationOnce(() => {
      return Promise.resolve({ id: "workflow-1" });
    });

    findOne.mockImplementation(() => {
      return Promise.resolve({
        functionName: "function-1",
        input: "input-1",
      });
    });

    goSleep.mockImplementation(() => {
      throw new Error("abort");
    });

    function fn1(_ctx: Context, _input: string): Promise<void> {
      throw new Error("kapot!");
    }

    const functions = new Map();
    functions.set("function-1", fn1);
    const client = await createClient({ functions });
    await expect(client.poll()).rejects.toThrow("abort");
  });
});
