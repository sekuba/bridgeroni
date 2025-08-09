import assert from "assert";
import { 
  TestHelpers,
  Arbitrum_SpokePool_FilledRelay
} from "generated";
const { MockDb, Arbitrum_SpokePool } = TestHelpers;

describe("Arbitrum_SpokePool contract FilledRelay event tests", () => {
  // Create mock db
  const mockDb = MockDb.createMockDb();

  // Creating mock for Arbitrum_SpokePool contract FilledRelay event
  const event = Arbitrum_SpokePool.FilledRelay.createMockEvent({/* It mocks event fields with default values. You can overwrite them if you need */});

  it("Arbitrum_SpokePool_FilledRelay is created correctly", async () => {
    // Processing the event
    const mockDbUpdated = await Arbitrum_SpokePool.FilledRelay.processEvent({
      event,
      mockDb,
    });

    // Getting the actual entity from the mock database
    let actualArbitrum_SpokePoolFilledRelay = mockDbUpdated.entities.Arbitrum_SpokePool_FilledRelay.get(
      `${event.chainId}_${event.block.number}_${event.logIndex}`
    );

    // Creating the expected entity
    const expectedArbitrum_SpokePoolFilledRelay: Arbitrum_SpokePool_FilledRelay = {
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
    assert.deepEqual(actualArbitrum_SpokePoolFilledRelay, expectedArbitrum_SpokePoolFilledRelay, "Actual Arbitrum_SpokePoolFilledRelay should be the same as the expectedArbitrum_SpokePoolFilledRelay");
  });
});
