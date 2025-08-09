/*
 * Please refer to https://docs.envio.dev for a thorough guide on all Envio indexer features
 * or https://docs.envio.dev/docs/HyperIndex-LLM/hyperindex-complete for LLMs
 */
import {
  SpokePool,
  SpokePool_FilledRelay,
  SpokePool_FilledV3Relay,
  SpokePool_FundsDeposited,
} from "generated";
import { isAddress, getAddress } from "viem";

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Utility function to clean padded addresses from blockchain events
 * Removes padding and returns checksummed addresses
 */
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

// ============================================================================
// ACROSS BRIDGE HELPERS
// ============================================================================

/**
 * Calculate Across protocol idMatching value for message correlation
 * This ID is used to match inbound (fill) and outbound (deposit) events
 */
function calculateAcrossIdMatching(eventData: AcrossEventData): string {
  return eventData.direction === 'inbound'
    ? `${eventData.originChainId}-${eventData.depositId}`
    : `${eventData.chainId}-${eventData.depositId}`;
}



interface AcrossInboundEventData {
  // 
  direction: 'inbound';
  originChainId: bigint;
  depositId: bigint;
  recipient: string;
  outputToken: string;
  outputAmount: bigint;
  depositor: string;
  exclusiveRelayer: string;
  fillDeadline: bigint;
  exclusivityDeadline: bigint;
  message?: string;
}

interface AcrossOutboundEventData {
  direction: 'outbound';
  chainId: number;
  depositId: bigint;
  depositor: string;
  inputToken: string;
  inputAmount: bigint;
  outputToken: string;
  outputAmount: bigint;
  recipient: string;
  exclusiveRelayer: string;
  fillDeadline: bigint;
  exclusivityDeadline: bigint;
  message: string;
}

type AcrossEventData = AcrossInboundEventData | AcrossOutboundEventData;

interface EventMetadata {
  chainId: number;
  blockNumber: bigint;
  blockTimestamp: bigint;
  txHash: string;
  txFrom?: string;
  txTo?: string;
  emitterAddress?: string;
}

/**
 * Updates or creates CrosschainMessage entity for Across events
 * Handles both inbound (fills) and outbound (deposits) events
 */
async function handleAcrossMessage(
  eventData: AcrossEventData,
  metadata: EventMetadata,
  context: any
): Promise<void> {
  // Calculate ID matching based on event direction
  const idMatching = calculateAcrossIdMatching(eventData);
  const crosschainMessageId = `across:${idMatching}`;

  // Try to get existing CrosschainMessage or create new one
  let crosschainMessage = await context.CrosschainMessage.get(crosschainMessageId);

  if (crosschainMessage) {
    // Update existing message with new data
    if (eventData.direction === 'inbound') {
      const inboundTimestamp = metadata.blockTimestamp;
      const isMatched = crosschainMessage.blockOutbound !== undefined;
      const latency = isMatched && crosschainMessage.timestampOutbound !== undefined
        ? inboundTimestamp - crosschainMessage.timestampOutbound
        : undefined;

      crosschainMessage = {
        ...crosschainMessage,
        blockInbound: metadata.blockNumber,
        timestampInbound: inboundTimestamp,
        txHashInbound: metadata.txHash,
        chainIdInbound: BigInt(metadata.chainId),
        toInbound: unpadAddress(eventData.recipient),
        matched: isMatched,
        latency: latency,
      };
    } else {
      // outbound event
      const outboundTimestamp = metadata.blockTimestamp;
      const isMatched = crosschainMessage.blockInbound !== undefined;
      const latency = isMatched && crosschainMessage.timestampInbound !== undefined
        ? crosschainMessage.timestampInbound - outboundTimestamp
        : undefined;

      crosschainMessage = {
        ...crosschainMessage,
        blockOutbound: metadata.blockNumber,
        timestampOutbound: outboundTimestamp,
        txHashOutbound: metadata.txHash,
        chainIdOutbound: BigInt(metadata.chainId),
        fromOutbound: unpadAddress(eventData.depositor),
        matched: isMatched,
        latency: latency,
      };
    }
  } else {
    // Create new message
    if (eventData.direction === 'inbound') {
      // Inbound came first - create with inbound data
      crosschainMessage = {
        id: crosschainMessageId,
        protocol: "across",
        idMatching: idMatching,

        // Outbound data (unknown at this point)
        blockOutbound: undefined,
        timestampOutbound: undefined,
        txHashOutbound: undefined,
        chainIdOutbound: undefined,
        fromOutbound: undefined,

        // Inbound data (from fill event)
        blockInbound: metadata.blockNumber,
        timestampInbound: metadata.blockTimestamp,
        txHashInbound: metadata.txHash,
        chainIdInbound: BigInt(metadata.chainId),
        toInbound: unpadAddress(eventData.recipient),

        matched: false,
        latency: undefined,
      };
    } else {
      // Outbound came first - create with outbound data
      crosschainMessage = {
        id: crosschainMessageId,
        protocol: "across",
        idMatching: idMatching,

        // Outbound data (from deposit event)
        blockOutbound: metadata.blockNumber,
        timestampOutbound: metadata.blockTimestamp,
        txHashOutbound: metadata.txHash,
        chainIdOutbound: BigInt(metadata.chainId),
        fromOutbound: unpadAddress(eventData.depositor),

        // Inbound data (will be filled by fill handler)
        blockInbound: undefined,
        timestampInbound: undefined,
        txHashInbound: undefined,
        chainIdInbound: undefined,
        toInbound: undefined,

        matched: false,
        latency: undefined,
      };
    }
  }

  context.CrosschainMessage.set(crosschainMessage);
}

/**
 * Updates or creates AppPayload entity for Across events
 * Handles both inbound (fills) and outbound (deposits) events
 */
async function handleAcrossAppPayload(
  eventData: AcrossEventData,
  metadata: EventMetadata,
  context: any
): Promise<void> {
  // Calculate ID matching based on event direction
  const idMatching = calculateAcrossIdMatching(eventData);
  const crosschainMessageId = `across:${idMatching}`;
  const transportingMsgProtocol = "across";
  const transportingMsgId = idMatching;

  // For now, Across has exactly one appPayload per CrosschainMessage, so we use counter 0
  // In the future, when supporting multiple appPayloads per message, increment this counter
  const counter = 0;
  const appPayloadId = `${transportingMsgProtocol}:${transportingMsgId}:${counter}`;
  let appPayload = await context.AppPayload.get(appPayloadId);

  if (appPayload) {
    // Update existing AppPayload with new data
    if (eventData.direction === 'inbound') {
      appPayload = {
        ...appPayload,
        amountInbound: eventData.outputAmount,
        assetAddressInbound: unpadAddress(eventData.outputToken),
        ...(eventData.message !== undefined && { message: eventData.message }),
      };
    } else {
      // outbound event
      appPayload = {
        ...appPayload,
        assetAddressOutbound: unpadAddress(eventData.inputToken),
        amountOutbound: eventData.inputAmount,
        sender: unpadAddress(eventData.depositor),
        message: eventData.message,
      };
    }
  } else {
    // Create new AppPayload
    if (eventData.direction === 'inbound') {
      // Inbound came first - create with inbound data
      appPayload = {
        id: appPayloadId,
        appName: "Across",

        // Message transport info
        transportingMsgProtocol: transportingMsgProtocol,
        transportingMsgId: transportingMsgId,
        idMatching: idMatching,

        // Asset information (partial, from inbound)
        assetAddressOutbound: undefined,
        assetAddressInbound: unpadAddress(eventData.outputToken),
        amountOutbound: undefined,
        amountInbound: eventData.outputAmount,

        // Addresses (from inbound)
        sender: unpadAddress(eventData.depositor),
        recipient: unpadAddress(eventData.recipient),
        targetAddress: metadata.emitterAddress, // SpokePool contract address on destination (event emitter)

        // Across-specific data (from inbound)
        fillDeadline: eventData.fillDeadline,
        exclusivityDeadline: eventData.exclusivityDeadline,
        exclusiveRelayer: unpadAddress(eventData.exclusiveRelayer),
        message: eventData.message, // Available in V3 events

        // Reference to crosschain message
        crosschainMessage_id: crosschainMessageId,
      };
    } else {
      // Outbound came first - create with outbound data
      appPayload = {
        id: appPayloadId,
        appName: "Across",

        // Message transport info
        transportingMsgProtocol: transportingMsgProtocol,
        transportingMsgId: transportingMsgId,
        idMatching: idMatching,

        // Asset information
        assetAddressOutbound: unpadAddress(eventData.inputToken),
        assetAddressInbound: unpadAddress(eventData.outputToken),
        amountInbound: eventData.outputAmount,
        amountOutbound: eventData.inputAmount,

        // Addresses
        sender: unpadAddress(eventData.depositor),
        recipient: unpadAddress(eventData.recipient),
        targetAddress: metadata.emitterAddress, // SpokePool contract address on origin

        // Across-specific data
        fillDeadline: eventData.fillDeadline,
        exclusivityDeadline: eventData.exclusivityDeadline,
        exclusiveRelayer: unpadAddress(eventData.exclusiveRelayer),
        message: eventData.message,

        // Reference to crosschain message
        crosschainMessage_id: crosschainMessageId,
      };
    }
  }

  context.AppPayload.set(appPayload);
}

// ============================================================================
// ACROSS BRIDGE EVENT HANDLERS
// ============================================================================

/**
 * Handler for Across FilledRelay events (V2 fills)
 * These are inbound events that represent completed bridge transfers
 */
SpokePool.FilledRelay.handler(async ({ event, context }) => {
  // Store raw event entity
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
    relayExecutionInfo_0: event.params.relayExecutionInfo[0],
    relayExecutionInfo_1: event.params.relayExecutionInfo[1],
    relayExecutionInfo_2: event.params.relayExecutionInfo[2],
    relayExecutionInfo_3: event.params.relayExecutionInfo[3],
    // Metadata fields
    chainId: BigInt(event.chainId),
    txHash: event.transaction.hash,
    from: event.transaction.from,
    to: event.transaction.to,
  };

  context.SpokePool_FilledRelay.set(entity);

  // Process crosschain message and app payload
  const eventData: AcrossInboundEventData = {
    direction: 'inbound',
    originChainId: event.params.originChainId,
    depositId: event.params.depositId,
    recipient: event.params.recipient,
    outputToken: event.params.outputToken,
    outputAmount: event.params.outputAmount,
    depositor: event.params.depositor,
    exclusiveRelayer: event.params.exclusiveRelayer,
    fillDeadline: event.params.fillDeadline,
    exclusivityDeadline: event.params.exclusivityDeadline,
    // Note: V2 FilledRelay doesn't have message field
  };

  const metadata: EventMetadata = {
    chainId: event.chainId,
    blockNumber: BigInt(event.block.number),
    blockTimestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
    txFrom: event.transaction.from,
    txTo: event.transaction.to,
    emitterAddress: event.srcAddress,
  };

  await handleAcrossMessage(eventData, metadata, context);
  await handleAcrossAppPayload(eventData, metadata, context);
});

/**
 * Handler for Across FilledV3Relay events (V3 fills)
 * These are inbound events that represent completed bridge transfers
 */
SpokePool.FilledV3Relay.handler(async ({ event, context }) => {
  // Store raw event entity
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
    relayExecutionInfo_0: event.params.relayExecutionInfo[0],
    relayExecutionInfo_1: event.params.relayExecutionInfo[1],
    relayExecutionInfo_2: event.params.relayExecutionInfo[2],
    relayExecutionInfo_3: event.params.relayExecutionInfo[3],
    // Metadata fields
    chainId: BigInt(event.chainId),
    txHash: event.transaction.hash,
    from: event.transaction.from,
    to: event.transaction.to,
  };

  context.SpokePool_FilledV3Relay.set(entity);

  // Process crosschain message and app payload
  const eventData: AcrossInboundEventData = {
    direction: 'inbound',
    originChainId: event.params.originChainId,
    depositId: event.params.depositId,
    recipient: event.params.recipient,
    outputToken: event.params.outputToken,
    outputAmount: event.params.outputAmount,
    depositor: event.params.depositor,
    exclusiveRelayer: event.params.exclusiveRelayer,
    fillDeadline: event.params.fillDeadline,
    exclusivityDeadline: event.params.exclusivityDeadline,
    message: event.params.message, // V3 has message field
  };

  const metadata: EventMetadata = {
    chainId: event.chainId,
    blockNumber: BigInt(event.block.number),
    blockTimestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
    txFrom: event.transaction.from,
    txTo: event.transaction.to,
    emitterAddress: event.srcAddress,
  };

  await handleAcrossMessage(eventData, metadata, context);
  await handleAcrossAppPayload(eventData, metadata, context);
});

/**
 * Handler for Across FundsDeposited events
 * These are outbound events that represent bridge transfer requests
 */
SpokePool.FundsDeposited.handler(async ({ event, context }) => {
  // Store raw event entity
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
    // Metadata fields
    chainId: BigInt(event.chainId),
    txHash: event.transaction.hash,
    from: event.transaction.from,
    to: event.transaction.to,
  };

  context.SpokePool_FundsDeposited.set(entity);

  // Process crosschain message and app payload
  const eventData: AcrossOutboundEventData = {
    direction: 'outbound',
    chainId: event.chainId,
    depositId: event.params.depositId,
    depositor: event.params.depositor,
    inputToken: event.params.inputToken,
    inputAmount: event.params.inputAmount,
    outputToken: event.params.outputToken,
    outputAmount: event.params.outputAmount,
    recipient: event.params.recipient,
    exclusiveRelayer: event.params.exclusiveRelayer,
    fillDeadline: event.params.fillDeadline,
    exclusivityDeadline: event.params.exclusivityDeadline,
    message: event.params.message,
  };

  const metadata: EventMetadata = {
    chainId: event.chainId,
    blockNumber: BigInt(event.block.number),
    blockTimestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
    txFrom: event.transaction.from,
    txTo: event.transaction.to,
  };

  await handleAcrossMessage(eventData, metadata, context);
  await handleAcrossAppPayload(eventData, metadata, context);
});

// ============================================================================
// FUTURE BRIDGE INTEGRATIONS
// ============================================================================

/*
 * When adding new bridges (e.g., LayerZero, Wormhole, etc.), follow this pattern:
 * 
 * 1. Create bridge-specific helper functions similar to the Across ones above
 * 2. Define bridge-specific event data interfaces
 * 3. Add event handlers that follow the same structure:
 *    - Store raw event entity
 *    - Extract event data and metadata
 *    - Call helper functions for CrosschainMessage and AppPayload
 * 
 * Example structure:
 * 
 * // ============================================================================
 * // LAYERZERO BRIDGE HELPERS
 * // ============================================================================
 * 
 * interface LayerZeroEventData { ... }
 * 
 * async function handleLayerZeroMessage(...) { ... }
 * async function handleLayerZeroAppPayload(...) { ... }
 * 
 * // ============================================================================
 * // LAYERZERO BRIDGE EVENT HANDLERS
 * // ============================================================================
 * 
 * LayerZero.MessageSent.handler(async ({ event, context }) => {
 *   // Store raw event
 *   // Extract data
 *   // Call helper functions for message and app payload
 * });
 */