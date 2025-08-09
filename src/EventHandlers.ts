/*
 * Please refer to https://docs.envio.dev for a thorough guide on all Envio indexer features
 */
import {
  SpokePool,
  SpokePool_FilledRelay,
  SpokePool_FilledV3Relay,
  SpokePool_FundsDeposited,
  CrosschainMessage,
  AppPayload,
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

  // Update CrosschainMessage entity with inbound data
  const idMatching = `${event.params.originChainId}-${event.params.depositId}`;
  const crosschainMessageId = `acrossV3:${idMatching}`;
  
  // Try to get existing CrosschainMessage or create new one
  let crosschainMessage = await context.CrosschainMessage.get(crosschainMessageId);
  
  if (crosschainMessage) {
    // Update existing message with inbound data
    crosschainMessage = {
      ...crosschainMessage,
      blockInbound: BigInt(event.block.number),
      timestampInbound: BigInt(event.block.timestamp),
      txHashInbound: event.transaction.hash,
      chainIdInbound: BigInt(event.chainId),
      toInbound: event.params.recipient,
      matched: crosschainMessage.blockOutbound !== undefined, // true if outbound data already exists
    };
  } else {
    // Create new message if outbound wasn't seen yet (inbound came first)
    crosschainMessage = {
      id: crosschainMessageId,
      protocol: "acrossV3",
      idMatching: idMatching,
      
      // Outbound data (unknown at this point)
      blockOutbound: undefined,
      timestampOutbound: undefined,
      txHashOutbound: undefined,
      chainIdOutbound: undefined,
      fromOutbound: undefined,
      
      // Inbound data (from FilledRelay)
      blockInbound: BigInt(event.block.number),
      timestampInbound: BigInt(event.block.timestamp),
      txHashInbound: event.transaction.hash,
      chainIdInbound: BigInt(event.chainId),
      toInbound: event.params.recipient,
      
      matched: false, // will be true when outbound is also recorded
    };
  }

  context.CrosschainMessage.set(crosschainMessage);

  // Update AppPayload entity with inbound data
  const appPayloadId = `acrossV3:${idMatching}:${idMatching}`;
  let appPayload = await context.AppPayload.get(appPayloadId);
  
  if (appPayload) {
    // Update existing AppPayload
    appPayload = {
      ...appPayload,
      amountIn: event.params.outputAmount,
      assetAddressInbound: event.params.outputToken,
    };
  } else {
    // Create new AppPayload if outbound wasn't seen yet
    appPayload = {
      id: appPayloadId,
      appName: "AcrossV3",
      
      // Message transport info
      transportingMsgProtocol: "acrossV3",
      transportingMessageId: idMatching,
      idMatching: idMatching,
      
      // Asset information (partial, from inbound)
      assetAddressOutbound: undefined,
      assetAddressInbound: event.params.outputToken,
      amountOut: undefined,
      amountIn: event.params.outputAmount,
      
      // Addresses (from inbound)
      sender: event.params.depositor,
      recipient: event.params.recipient,
      targetAddress: event.srcAddress, // SpokePool contract address on destination
      
      // Across-specific data (from inbound)
      fillDeadline: event.params.fillDeadline,
      exclusivityDeadline: event.params.exclusivityDeadline,
      exclusiveRelayer: event.params.exclusiveRelayer,
      message: undefined, // Not available in FilledRelay
      
      // Reference to crosschain message
      crosschainMessage_id: crosschainMessageId,
    };
  }

  context.AppPayload.set(appPayload);
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

  // Update CrosschainMessage entity with inbound data
  const idMatching = `${event.params.originChainId}-${event.params.depositId}`;
  const crosschainMessageId = `acrossV3:${idMatching}`;
  
  // Try to get existing CrosschainMessage or create new one
  let crosschainMessage = await context.CrosschainMessage.get(crosschainMessageId);
  
  if (crosschainMessage) {
    // Update existing message with inbound data
    crosschainMessage = {
      ...crosschainMessage,
      blockInbound: BigInt(event.block.number),
      timestampInbound: BigInt(event.block.timestamp),
      txHashInbound: event.transaction.hash,
      chainIdInbound: BigInt(event.chainId),
      toInbound: event.params.recipient,
      matched: crosschainMessage.blockOutbound !== undefined, // true if outbound data already exists
    };
  } else {
    // Create new message if outbound wasn't seen yet (inbound came first)
    crosschainMessage = {
      id: crosschainMessageId,
      protocol: "acrossV3",
      idMatching: idMatching,
      
      // Outbound data (unknown at this point)
      blockOutbound: undefined,
      timestampOutbound: undefined,
      txHashOutbound: undefined,
      chainIdOutbound: undefined,
      fromOutbound: undefined,
      
      // Inbound data (from FilledV3Relay)
      blockInbound: BigInt(event.block.number),
      timestampInbound: BigInt(event.block.timestamp),
      txHashInbound: event.transaction.hash,
      chainIdInbound: BigInt(event.chainId),
      toInbound: event.params.recipient,
      
      matched: false, // will be true when outbound is also recorded
    };
  }

  context.CrosschainMessage.set(crosschainMessage);

  // Update AppPayload entity with inbound data
  const appPayloadId = `across:${idMatching}:${idMatching}`;
  let appPayload = await context.AppPayload.get(appPayloadId);
  
  if (appPayload) {
    // Update existing AppPayload
    appPayload = {
      ...appPayload,
      amountIn: event.params.outputAmount,
      assetAddressInbound: event.params.outputToken,
      message: event.params.message, // FilledV3Relay has message field
    };
  } else {
    // Create new AppPayload if outbound wasn't seen yet
    appPayload = {
      id: appPayloadId,
      appName: "AcrossV3",
      
      // Message transport info
      transportingMsgProtocol: "acrossV3",
      transportingMessageId: idMatching,
      idMatching: idMatching,
      
      // Asset information (partial, from inbound)
      assetAddressOutbound: undefined,
      assetAddressInbound: event.params.outputToken,
      amountOut: undefined,
      amountIn: event.params.outputAmount,
      
      // Addresses (from inbound)
      sender: event.params.depositor,
      recipient: event.params.recipient,
      targetAddress: event.srcAddress, // SpokePool contract address on destination
      
      // Across-specific data (from inbound)
      fillDeadline: event.params.fillDeadline,
      exclusivityDeadline: event.params.exclusivityDeadline,
      exclusiveRelayer: event.params.exclusiveRelayer,
      message: event.params.message, // Available in FilledV3Relay
      
      // Reference to crosschain message
      crosschainMessage_id: crosschainMessageId,
    };
  }

  context.AppPayload.set(appPayload);
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

  // Create or update CrosschainMessage entity for outbound event
  const idMatching = `${event.chainId}-${event.params.depositId}`;
  const crosschainMessageId = `acrossV3:${idMatching}`;
  
  // Try to get existing CrosschainMessage or create new one
  let crosschainMessage = await context.CrosschainMessage.get(crosschainMessageId);
  
  if (crosschainMessage) {
    // Update existing message with outbound data
    crosschainMessage = {
      ...crosschainMessage,
      blockOutbound: BigInt(event.block.number),
      timestampOutbound: BigInt(event.block.timestamp),
      txHashOutbound: event.transaction.hash,
      chainIdOutbound: BigInt(event.chainId),
      fromOutbound: event.params.depositor,
      matched: crosschainMessage.blockInbound !== undefined, // true if inbound data already exists
    };
  } else {
    // Create new message with outbound data
    crosschainMessage = {
      id: crosschainMessageId,
      protocol: "acrossV3",
      idMatching: idMatching,
      
      // Outbound data (from FundsDeposited)
      blockOutbound: BigInt(event.block.number),
      timestampOutbound: BigInt(event.block.timestamp),
      txHashOutbound: event.transaction.hash,
      chainIdOutbound: BigInt(event.chainId),
      fromOutbound: event.params.depositor,
      
      // Inbound data (will be filled by FilledRelay handler)
      blockInbound: undefined,
      timestampInbound: undefined,
      txHashInbound: undefined,
      chainIdInbound: undefined,
      toInbound: undefined,
      
      matched: false,
    };
  }

  context.CrosschainMessage.set(crosschainMessage);

  // Create or update AppPayload entity
  const appPayloadId = `acrossV3:${idMatching}:${idMatching}`;
  let appPayload = await context.AppPayload.get(appPayloadId);
  
  if (appPayload) {
    // Update existing AppPayload with outbound data
    appPayload = {
      ...appPayload,
      assetAddressOutbound: event.params.inputToken,
      amountOut: event.params.inputAmount,
      sender: event.params.depositor,
      message: event.params.message,
    };
  } else {
    // Create new AppPayload with outbound data
    appPayload = {
      id: appPayloadId,
      appName: "AcrossV3",
      
      // Message transport info
      transportingMsgProtocol: "acrossV3",
      transportingMessageId: idMatching,
      idMatching: idMatching,
      
      // Asset information
      assetAddressOutbound: event.params.inputToken,
      assetAddressInbound: event.params.outputToken,
      amountOut: event.params.inputAmount,
      amountIn: event.params.outputAmount,
      
      // Addresses
      sender: event.params.depositor,
      recipient: event.params.recipient,
      targetAddress: event.srcAddress, // SpokePool contract address on origin
      
      // Across-specific data
      fillDeadline: event.params.fillDeadline,
      exclusivityDeadline: event.params.exclusivityDeadline,
      exclusiveRelayer: event.params.exclusiveRelayer,
      message: event.params.message,
      
      // Reference to crosschain message
      crosschainMessage_id: crosschainMessageId,
    };
  }

  context.AppPayload.set(appPayload);
});
