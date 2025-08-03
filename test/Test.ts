import assert from "assert";
import { 
  TestHelpers,
  L1AssetRouter_BridgehubDepositBaseTokenInitiated
} from "generated";
const { MockDb, L1AssetRouter } = TestHelpers;

describe("L1AssetRouter contract BridgehubDepositBaseTokenInitiated event tests", () => {
  // Create mock db
  const mockDb = MockDb.createMockDb();

  // Creating mock for L1AssetRouter contract BridgehubDepositBaseTokenInitiated event
  const event = L1AssetRouter.BridgehubDepositBaseTokenInitiated.createMockEvent({/* It mocks event fields with default values. You can overwrite them if you need */});

  it("L1AssetRouter_BridgehubDepositBaseTokenInitiated is created correctly", async () => {
    // Processing the event
    const mockDbUpdated = await L1AssetRouter.BridgehubDepositBaseTokenInitiated.processEvent({
      event,
      mockDb,
    });

    // Getting the actual entity from the mock database
    let actualL1AssetRouterBridgehubDepositBaseTokenInitiated = mockDbUpdated.entities.L1AssetRouter_BridgehubDepositBaseTokenInitiated.get(
      `${event.chainId}_${event.block.number}_${event.logIndex}`
    );

    // Creating the expected entity
    const expectedL1AssetRouterBridgehubDepositBaseTokenInitiated: L1AssetRouter_BridgehubDepositBaseTokenInitiated = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      chainId: event.params.chainId,
      from: event.params.from,
      assetId: event.params.assetId,
      amount: event.params.amount,
    };
    // Asserting that the entity in the mock database is the same as the expected entity
    assert.deepEqual(actualL1AssetRouterBridgehubDepositBaseTokenInitiated, expectedL1AssetRouterBridgehubDepositBaseTokenInitiated, "Actual L1AssetRouterBridgehubDepositBaseTokenInitiated should be the same as the expectedL1AssetRouterBridgehubDepositBaseTokenInitiated");
  });
});
