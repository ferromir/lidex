import { MongoClient } from "mongodb";
import { createClient } from "./index";

// jest.mock("mongodb");

jest.mock("mongodb", () => ({
  MongoClient: jest.fn().mockImplementation(() => ({
    db,
  })),
}));

const db = jest.fn().mockImplementation(() => ({
  collection,
}));

const collection = jest.fn().mockImplementation(() => ({
  createIndex: jest.fn(),
}));

it("temp", async () => {
  const now = () => new Date();
  const mongoUrl = "mongodb://localhost:27017/?directConnection=true";
  const dbName = "lidex";
  const functions = new Map();
  const config = { mongoUrl, dbName };
  const client = await createClient(functions, now, config);

  expect(db).toHaveBeenCalledTimes(1);
  expect(db).toHaveBeenCalledWith(dbName);
  expect(collection).toHaveBeenCalledTimes(1);
  expect(collection).toHaveBeenCalledWith("workflows");
});
