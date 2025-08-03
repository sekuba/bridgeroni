import assert from "assert";
import { 
  TestHelpers,
  L1AssetRouter_AssetDeploymentTrackerRegistered
} from "generated";
const { MockDb, L1AssetRouter } = TestHelpers;

describe("L1AssetRouter contract AssetDeploymentTrackerRegistered event tests", () => {
  // Create mock db
  const mockDb = MockDb.createMockDb();

  // Creating mock for L1AssetRouter contract AssetDeploymentTrackerRegistered event
  const event = L1AssetRouter.AssetDeploymentTrackerRegistered.createMockEvent({/* It mocks event fields with default values. You can overwrite them if you need */});

  it("L1AssetRouter_AssetDeploymentTrackerRegistered is created correctly", async () => {
    // Processing the event
    const mockDbUpdated = await L1AssetRouter.AssetDeploymentTrackerRegistered.processEvent({
      event,
      mockDb,
    });

    // Getting the actual entity from the mock database
    let actualL1AssetRouterAssetDeploymentTrackerRegistered = mockDbUpdated.entities.L1AssetRouter_AssetDeploymentTrackerRegistered.get(
      `${event.chainId}_${event.block.number}_${event.logIndex}`
    );

    // Creating the expected entity
    const expectedL1AssetRouterAssetDeploymentTrackerRegistered: L1AssetRouter_AssetDeploymentTrackerRegistered = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      assetId: event.params.assetId,
      additionalData: event.params.additionalData,
      assetDeploymentTracker: event.params.assetDeploymentTracker,
    };
    // Asserting that the entity in the mock database is the same as the expected entity
    assert.deepEqual(actualL1AssetRouterAssetDeploymentTrackerRegistered, expectedL1AssetRouterAssetDeploymentTrackerRegistered, "Actual L1AssetRouterAssetDeploymentTrackerRegistered should be the same as the expectedL1AssetRouterAssetDeploymentTrackerRegistered");
  });
});
