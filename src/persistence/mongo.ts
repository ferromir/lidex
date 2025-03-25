import { Collection, MongoClient } from "mongodb";
import { Status } from "../index2";

interface Workflow {
  id: string;
  handler: string;
  input: unknown;
  status: Status;
  timeoutAt?: Date;
  steps?: { [key: string]: unknown };
  naps?: { [key: string]: Date };
  failures?: number;
  lastError?: string;
}

export class MongoPersistence {
  workflows: Collection<Workflow>;

  constructor(url: string) {
    const client = new MongoClient(url);
    const db = client.db();
    this.workflows = db.collection("workflows");
  }

  async init() {
    await this.workflows.createIndex({ id: 1 }, { unique: true });
    await this.workflows.createIndex({ status: 1 });
    await this.workflows.createIndex({ status: 1, timeoutAt: 1 });
  }

  async insert(
    workflowId: string,
    handler: string,
    input: unknown
  ): Promise<boolean> {
    try {
      await this.workflows.insertOne({
        id: workflowId,
        handler,
        input,
        status: "idle",
      });

      return true;
    } catch (error) {
      const e = error as { name: string; code: number };

      // Workflow already started, ignore.
      if (e.name === "MongoServerError" && e.code === 11000) {
        return false;
      }

      throw error;
    }
  }

  async setAsRunning(timeoutAt: Date): Promise<string | undefined> {
    const workflow = await this.workflows.findOneAndUpdate(
      {
        $or: [
          { status: "idle" },
          {
            status: { $in: ["running", "failed"] },
            timeoutAt: { $lt: timeoutAt },
          },
        ],
      },
      {
        $set: {
          status: "running",
          timeoutAt,
        },
      },
      {
        projection: {
          _id: 0,
          id: 1,
        },
      }
    );

    return workflow?.id;
  }
}
