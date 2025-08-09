import assert from "assert";
import { 
  TestHelpers,
  SpokePool_FilledRelay
} from "generated";
const { MockDb, SpokePool } = TestHelpers;

describe("SpokePool contract FilledRelay event tests", () => {
  // Create mock db
  const mockDb = MockDb.createMockDb();

  // Creating mock for SpokePool contract FilledRelay event
  const event = SpokePool.FilledRelay.createMockEvent({/* It mocks event fields with default values. You can overwrite them if you need */});

  it("SpokePool_FilledRelay is created correctly", async () => {
    // Processing the event
    const mockDbUpdated = await SpokePool.FilledRelay.processEvent({
      event,
      mockDb,
    });

    // Getting the actual entity from the mock database
    let actualSpokePoolFilledRelay = mockDbUpdated.entities.SpokePool_FilledRelay.get(
      `${event.chainId}_${event.block.number}_${event.logIndex}`
    );

    // Creating the expected entity
    const expectedSpokePoolFilledRelay: SpokePool_FilledRelay = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      inputToken: event.params.inputToken,
      outputToken: event.params.outputToken,
      inputAmount: event.params.inputAmount,
      outputAmount: event.params.outputAmount,
      repaymentChainId: event.params.repaymentChainId,
      originChainId: event.params.originChainId,
      depositId: event.params.depositId,
      fillDeadline: event.params.fillDeadline,
      exclusivityDeadline: event.params.exclusivityDeadline,
      exclusiveRelayer: event.params.exclusiveRelayer,
      relayer: event.params.relayer,
      depositor: event.params.depositor,
      recipient: event.params.recipient,
      messageHash: event.params.messageHash,
      relayExecutionInfo: event.params.relayExecutionInfo,
      relayExecutionInfo: event.params.relayExecutionInfo,
      relayExecutionInfo: event.params.relayExecutionInfo,
      relayExecutionInfo: event.params.relayExecutionInfo,
    };
    // Asserting that the entity in the mock database is the same as the expected entity
    assert.deepEqual(actualSpokePoolFilledRelay, expectedSpokePoolFilledRelay, "Actual SpokePoolFilledRelay should be the same as the expectedSpokePoolFilledRelay");
  });
});
