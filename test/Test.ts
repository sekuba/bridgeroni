import assert from "assert";
import { 
  TestHelpers,
  MessageTransmitter_MessageReceived
} from "generated";
const { MockDb, MessageTransmitter } = TestHelpers;

describe("MessageTransmitter contract MessageReceived event tests", () => {
  // Create mock db
  const mockDb = MockDb.createMockDb();

  // Creating mock for MessageTransmitter contract MessageReceived event
  const event = MessageTransmitter.MessageReceived.createMockEvent({/* It mocks event fields with default values. You can overwrite them if you need */});

  it("MessageTransmitter_MessageReceived is created correctly", async () => {
    // Processing the event
    const mockDbUpdated = await MessageTransmitter.MessageReceived.processEvent({
      event,
      mockDb,
    });

    // Getting the actual entity from the mock database
    let actualMessageTransmitterMessageReceived = mockDbUpdated.entities.MessageTransmitter_MessageReceived.get(
      `${event.chainId}_${event.block.number}_${event.logIndex}`
    );

    // Creating the expected entity
    const expectedMessageTransmitterMessageReceived: MessageTransmitter_MessageReceived = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      caller: event.params.caller,
      sourceDomain: event.params.sourceDomain,
      nonce: event.params.nonce,
      sender: event.params.sender,
      messageBody: event.params.messageBody,
    };
    // Asserting that the entity in the mock database is the same as the expected entity
    assert.deepEqual(actualMessageTransmitterMessageReceived, expectedMessageTransmitterMessageReceived, "Actual MessageTransmitterMessageReceived should be the same as the expectedMessageTransmitterMessageReceived");
  });
});
