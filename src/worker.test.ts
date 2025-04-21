import { mock } from "jest-mock-extended";
import { makeWorker } from "./worker";
import {
  makeClaim,
  makeMakeStep,
  makeMakeSleep,
  makeRun,
  makePoll,
} from "./worker-internal";
import { makeStart } from "./common";
import { Persistence, Handler, WorkerOptions, Worker } from "./model";

jest.mock("./worker-internal", () => ({
  makeClaim: jest.fn(),
  makeMakeStep: jest.fn(),
  makeMakeSleep: jest.fn(),
  makeRun: jest.fn(),
  makePoll: jest.fn(),
}));

jest.mock("./common", () => ({
  makeStart: jest.fn(),
}));

describe("makeWorker", () => {
  const mockPersistence = mock<Persistence>();
  const mockHandlers = new Map<string, Handler>();
  const mockStart = jest.fn();
  const mockClaim = jest.fn();
  const mockMakeStep = jest.fn();
  const mockMakeSleep = jest.fn();
  const mockRun = jest.fn();
  const mockPoll = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (makeStart as jest.Mock).mockReturnValue(mockStart);
    (makeClaim as jest.Mock).mockReturnValue(mockClaim);
    (makeMakeStep as jest.Mock).mockReturnValue(mockMakeStep);
    (makeMakeSleep as jest.Mock).mockReturnValue(mockMakeSleep);
    (makeRun as jest.Mock).mockReturnValue(mockRun);
    (makePoll as jest.Mock).mockReturnValue(mockPoll);
  });

  it("creates a Worker using default options", async () => {
    const worker: Worker = await makeWorker(mockPersistence, mockHandlers);

    expect(makeStart).toHaveBeenCalledWith(mockPersistence);
    expect(makeClaim).toHaveBeenCalledWith(mockPersistence, 60000);
    expect(makeMakeStep).toHaveBeenCalledWith(mockPersistence, 60000);
    expect(makeMakeSleep).toHaveBeenCalledWith(mockPersistence, 60000);
    expect(makeRun).toHaveBeenCalledWith(
      mockPersistence,
      mockHandlers,
      mockMakeStep,
      mockMakeSleep,
      mockStart,
      3,
      60000,
    );
    expect(makePoll).toHaveBeenCalledWith(mockClaim, mockRun, 1000);
    expect(worker).toEqual({ poll: mockPoll });
  });

  it("creates a Worker using custom options", async () => {
    const options: WorkerOptions = {
      maxFailures: 5,
      timeoutIntervalMs: 30000,
      pollIntervalMs: 500,
      retryIntervalMs: 10000,
    };

    const worker: Worker = await makeWorker(
      mockPersistence,
      mockHandlers,
      options,
    );

    expect(makeStart).toHaveBeenCalledWith(mockPersistence);
    expect(makeClaim).toHaveBeenCalledWith(mockPersistence, 30000);
    expect(makeMakeStep).toHaveBeenCalledWith(mockPersistence, 30000);
    expect(makeMakeSleep).toHaveBeenCalledWith(mockPersistence, 30000);
    expect(makeRun).toHaveBeenCalledWith(
      mockPersistence,
      mockHandlers,
      mockMakeStep,
      mockMakeSleep,
      mockStart,
      5,
      10000,
    );
    expect(makePoll).toHaveBeenCalledWith(mockClaim, mockRun, 500);
    expect(worker).toEqual({ poll: mockPoll });
  });
});
