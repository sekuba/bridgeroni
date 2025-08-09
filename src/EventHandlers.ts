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
import { isAddress, getAddress } from "viem";

// Utility function to clean padded addresses
function unpadAddress(paddedAddress: string): string {
  // Remove 0x prefix temporarily
  const withoutPrefix = paddedAddress.startsWith('0x') ? paddedAddress.slice(2) : paddedAddress;
  
  // Take the last 40 characters (20 bytes) which represent the address
  const addressPart = withoutPrefix.slice(-40);
  const cleanedAddress = '0x' + addressPart;
  
  // Validate and return checksummed address, or return original if invalid
  if (isAddress(cleanedAddress)) {
    return getAddress(cleanedAddress); // Returns checksummed address
  }
  
  // If not a valid address, return original (might be zero address or other value)
  return paddedAddress;
}

SpokePool.FilledRelay.handler(async ({ event, context }) => {
  const entity: SpokePool_FilledRelay = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    inputToken: unpadAddress(event.params.inputToken),
    outputToken: unpadAddress(event.params.outputToken),
    inputAmount: event.params.inputAmount,
    outputAmount: event.params.outputAmount,
    repaymentChainId: event.params.repaymentChainId,
    originChainId: event.params.originChainId,
    depositId: event.params.depositId,
    fillDeadline: event.params.fillDeadline,
    exclusivityDeadline: event.params.exclusivityDeadline,
    exclusiveRelayer: unpadAddress(event.params.exclusiveRelayer),
    relayer: unpadAddress(event.params.relayer),
    depositor: unpadAddress(event.params.depositor),
    recipient: unpadAddress(event.params.recipient),
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
    // metadata
    chainId: BigInt(event.chainId),
    txHash: event.transaction.hash,
    from: event.transaction.from,
    to: event.transaction.to,
  };

  context.SpokePool_FilledRelay.set(entity);

  // Update CrosschainMessage entity with inbound data
  const idMatching = `${event.params.originChainId}-${event.params.depositId}`;
  const crosschainMessageId = `acrossV3:${idMatching}`;
  
  // Try to get existing CrosschainMessage or create new one
  let crosschainMessage = await context.CrosschainMessage.get(crosschainMessageId);
  
  if (crosschainMessage) {
    // Update existing message with inbound data
    const inboundTimestamp = BigInt(event.block.timestamp);
    const isMatched = crosschainMessage.blockOutbound !== undefined;
    const latency = isMatched && crosschainMessage.timestampOutbound !== undefined 
      ? inboundTimestamp - crosschainMessage.timestampOutbound 
      : undefined;
    
    crosschainMessage = {
      ...crosschainMessage,
      blockInbound: BigInt(event.block.number),
      timestampInbound: inboundTimestamp,
      txHashInbound: event.transaction.hash,
      chainIdInbound: BigInt(event.chainId),
      toInbound: unpadAddress(event.params.recipient),
      matched: isMatched,
      latency: latency,
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
      toInbound: unpadAddress(event.params.recipient),
      
      matched: false, // will be true when outbound is also recorded
      latency: undefined, // will be calculated when matched
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
      assetAddressInbound: unpadAddress(event.params.outputToken),
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
      assetAddressInbound: unpadAddress(event.params.outputToken),
      amountOut: undefined,
      amountIn: event.params.outputAmount,
      
      // Addresses (from inbound)
      sender: unpadAddress(event.params.depositor),
      recipient: unpadAddress(event.params.recipient),
      targetAddress: event.srcAddress, // SpokePool contract address on destination
      
      // Across-specific data (from inbound)
      fillDeadline: event.params.fillDeadline,
      exclusivityDeadline: event.params.exclusivityDeadline,
      exclusiveRelayer: unpadAddress(event.params.exclusiveRelayer),
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
    inputToken: unpadAddress(event.params.inputToken),
    outputToken: unpadAddress(event.params.outputToken),
    inputAmount: event.params.inputAmount,
    outputAmount: event.params.outputAmount,
    repaymentChainId: event.params.repaymentChainId,
    originChainId: event.params.originChainId,
    depositId: event.params.depositId,
    fillDeadline: event.params.fillDeadline,
    exclusivityDeadline: event.params.exclusivityDeadline,
    exclusiveRelayer: unpadAddress(event.params.exclusiveRelayer),
    relayer: unpadAddress(event.params.relayer),
    depositor: unpadAddress(event.params.depositor),
    recipient: unpadAddress(event.params.recipient),
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
    // metadata
    chainId: BigInt(event.chainId),
    txHash: event.transaction.hash,
    from: event.transaction.from,
    to: event.transaction.to,
  };

  context.SpokePool_FilledV3Relay.set(entity);

  // Update CrosschainMessage entity with inbound data
  const idMatching = `${event.params.originChainId}-${event.params.depositId}`;
  const crosschainMessageId = `acrossV3:${idMatching}`;
  
  // Try to get existing CrosschainMessage or create new one
  let crosschainMessage = await context.CrosschainMessage.get(crosschainMessageId);
  
  if (crosschainMessage) {
    // Update existing message with inbound data
    const inboundTimestamp = BigInt(event.block.timestamp);
    const isMatched = crosschainMessage.blockOutbound !== undefined;
    const latency = isMatched && crosschainMessage.timestampOutbound !== undefined 
      ? inboundTimestamp - crosschainMessage.timestampOutbound 
      : undefined;
    
    crosschainMessage = {
      ...crosschainMessage,
      blockInbound: BigInt(event.block.number),
      timestampInbound: inboundTimestamp,
      txHashInbound: event.transaction.hash,
      chainIdInbound: BigInt(event.chainId),
      toInbound: unpadAddress(event.params.recipient),
      matched: isMatched,
      latency: latency,
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
      toInbound: unpadAddress(event.params.recipient),
      
      matched: false, // will be true when outbound is also recorded
      latency: undefined, // will be calculated when matched
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
      assetAddressInbound: unpadAddress(event.params.outputToken),
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
      assetAddressInbound: unpadAddress(event.params.outputToken),
      amountOut: undefined,
      amountIn: event.params.outputAmount,
      
      // Addresses (from inbound)
      sender: unpadAddress(event.params.depositor),
      recipient: unpadAddress(event.params.recipient),
      targetAddress: event.srcAddress, // SpokePool contract address on destination
      
      // Across-specific data (from inbound)
      fillDeadline: event.params.fillDeadline,
      exclusivityDeadline: event.params.exclusivityDeadline,
      exclusiveRelayer: unpadAddress(event.params.exclusiveRelayer),
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
    inputToken: unpadAddress(event.params.inputToken),
    outputToken: unpadAddress(event.params.outputToken),
    inputAmount: event.params.inputAmount,
    outputAmount: event.params.outputAmount,
    destinationChainId: event.params.destinationChainId,
    depositId: event.params.depositId,
    quoteTimestamp: event.params.quoteTimestamp,
    fillDeadline: event.params.fillDeadline,
    exclusivityDeadline: event.params.exclusivityDeadline,
    depositor: unpadAddress(event.params.depositor),
    recipient: unpadAddress(event.params.recipient),
    exclusiveRelayer: unpadAddress(event.params.exclusiveRelayer),
    message: event.params.message,
    // metadata
    chainId: BigInt(event.chainId),
    txHash: event.transaction.hash,
    from: event.transaction.from,
    to: event.transaction.to,
  };

  context.SpokePool_FundsDeposited.set(entity);

  // Create or update CrosschainMessage entity for outbound event
  const idMatching = `${event.chainId}-${event.params.depositId}`;
  const crosschainMessageId = `acrossV3:${idMatching}`;
  
  // Try to get existing CrosschainMessage or create new one
  let crosschainMessage = await context.CrosschainMessage.get(crosschainMessageId);
  
  if (crosschainMessage) {
    // Update existing message with outbound data
    const outboundTimestamp = BigInt(event.block.timestamp);
    const isMatched = crosschainMessage.blockInbound !== undefined;
    const latency = isMatched && crosschainMessage.timestampInbound !== undefined 
      ? crosschainMessage.timestampInbound - outboundTimestamp 
      : undefined;
    
    crosschainMessage = {
      ...crosschainMessage,
      blockOutbound: BigInt(event.block.number),
      timestampOutbound: outboundTimestamp,
      txHashOutbound: event.transaction.hash,
      chainIdOutbound: BigInt(event.chainId),
      fromOutbound: unpadAddress(event.params.depositor),
      matched: isMatched,
      latency: latency,
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
      fromOutbound: unpadAddress(event.params.depositor),
      
      // Inbound data (will be filled by FilledRelay handler)
      blockInbound: undefined,
      timestampInbound: undefined,
      txHashInbound: undefined,
      chainIdInbound: undefined,
      toInbound: undefined,
      
      matched: false,
      latency: undefined, // will be calculated when matched
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
      assetAddressOutbound: unpadAddress(event.params.inputToken),
      amountOut: event.params.inputAmount,
      sender: unpadAddress(event.params.depositor),
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
      assetAddressOutbound: unpadAddress(event.params.inputToken),
      assetAddressInbound: unpadAddress(event.params.outputToken),
      amountOut: event.params.inputAmount,
      amountIn: event.params.outputAmount,
      
      // Addresses
      sender: unpadAddress(event.params.depositor),
      recipient: unpadAddress(event.params.recipient),
      targetAddress: event.srcAddress, // SpokePool contract address on origin
      
      // Across-specific data
      fillDeadline: event.params.fillDeadline,
      exclusivityDeadline: event.params.exclusivityDeadline,
      exclusiveRelayer: unpadAddress(event.params.exclusiveRelayer),
      message: event.params.message,
      
      // Reference to crosschain message
      crosschainMessage_id: crosschainMessageId,
    };
  }

  context.AppPayload.set(appPayload);
});
