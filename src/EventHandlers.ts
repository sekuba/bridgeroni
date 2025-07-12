/*
 * Please refer to https://docs.envio.dev for a thorough guide on all Envio indexer features
 */
import {
  MessageTransmitter,
  MessageTransmitter_MessageReceived,
  TokenMessenger,
  TokenMessenger_DepositForBurn,
} from "generated";

MessageTransmitter.MessageReceived.handler(async ({ event, context }) => {
  const entity: MessageTransmitter_MessageReceived = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    caller: event.params.caller,
    sourceDomain: event.params.sourceDomain,
    nonce: event.params.nonce,
    sender: event.params.sender,
    messageBody: event.params.messageBody,
  };

  context.MessageTransmitter_MessageReceived.set(entity);
});

TokenMessenger.DepositForBurn.handler(async ({ event, context }) => {
  const entity: TokenMessenger_DepositForBurn = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    nonce: event.params.nonce,
    burnToken: event.params.burnToken,
    amount: event.params.amount,
    depositor: event.params.depositor,
    mintRecipient: event.params.mintRecipient,
    destinationDomain: event.params.destinationDomain,
    destinationTokenMessenger: event.params.destinationTokenMessenger,
    destinationCaller: event.params.destinationCaller,
  };

  context.TokenMessenger_DepositForBurn.set(entity);
});
