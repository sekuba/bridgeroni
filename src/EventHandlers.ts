/*
 * Please refer to https://docs.envio.dev for a thorough guide on all Envio indexer features
 */
import {
  SpokePool,
  SpokePool_FilledRelay,
  SpokePool_FilledV3Relay,
  SpokePool_FundsDeposited,
} from "generated";

SpokePool.FilledRelay.handler(async ({ event, context }) => {
  const entity: SpokePool_FilledRelay = {
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
    relayExecutionInfo_0: event.params.relayExecutionInfo
        [0]
    ,
    relayExecutionInfo_1: event.params.relayExecutionInfo
        [1]
    ,
    relayExecutionInfo_2: event.params.relayExecutionInfo
        [2]
    ,
    relayExecutionInfo_3: event.params.relayExecutionInfo
        [3]
    ,
  };

  context.SpokePool_FilledRelay.set(entity);
});

SpokePool.FilledV3Relay.handler(async ({ event, context }) => {
  const entity: SpokePool_FilledV3Relay = {
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
    message: event.params.message,
    relayExecutionInfo_0: event.params.relayExecutionInfo
        [0]
    ,
    relayExecutionInfo_1: event.params.relayExecutionInfo
        [1]
    ,
    relayExecutionInfo_2: event.params.relayExecutionInfo
        [2]
    ,
    relayExecutionInfo_3: event.params.relayExecutionInfo
        [3]
    ,
  };

  context.SpokePool_FilledV3Relay.set(entity);
});

SpokePool.FundsDeposited.handler(async ({ event, context }) => {
  const entity: SpokePool_FundsDeposited = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    inputToken: event.params.inputToken,
    outputToken: event.params.outputToken,
    inputAmount: event.params.inputAmount,
    outputAmount: event.params.outputAmount,
    destinationChainId: event.params.destinationChainId,
    depositId: event.params.depositId,
    quoteTimestamp: event.params.quoteTimestamp,
    fillDeadline: event.params.fillDeadline,
    exclusivityDeadline: event.params.exclusivityDeadline,
    depositor: event.params.depositor,
    recipient: event.params.recipient,
    exclusiveRelayer: event.params.exclusiveRelayer,
    message: event.params.message,
  };

  context.SpokePool_FundsDeposited.set(entity);
});
