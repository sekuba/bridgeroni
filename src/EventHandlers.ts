/*
 * Please refer to https://docs.envio.dev for a thorough guide on all Envio indexer features
 * or https://docs.envio.dev/docs/HyperIndex-LLM/hyperindex-complete for LLMs
 */
import {
  SpokePool,
  SpokePool_FilledRelay,
  SpokePool_FilledV3Relay,
  SpokePool_FundsDeposited,
  EndpointV2,
  EndpointV2_PacketSent,
  EndpointV2_PacketDelivered,
  StargatePool,
  StargatePool_OFTSent,
  StargatePool_OFTReceived,
  TokenMessaging,
  TokenMessaging_BusRode,
  TokenMessaging_BusDriven,
} from "generated";
import { isAddress, getAddress, keccak256, encodePacked, pad } from "viem";
import { mapChainIdToChainInfo } from "../analyze/const";

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
        matched: true,
        amountInbound: eventData.outputAmount,
        assetAddressInbound: unpadAddress(eventData.outputToken),
        ...(eventData.message !== undefined && { message: eventData.message }),
      };
    } else {
      // outbound event
      appPayload = {
        ...appPayload,
        matched: true,
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
        matched: false,

        // Asset information (partial, from inbound)
        assetAddressOutbound: undefined,
        assetAddressInbound: unpadAddress(eventData.outputToken),
        amountOutbound: undefined,
        amountInbound: eventData.outputAmount,

        // Addresses (from inbound)
        sender: unpadAddress(eventData.depositor),
        recipient: unpadAddress(eventData.recipient),
        targetAddress: metadata.emitterAddress, // SpokePool contract address on destination (event emitter)

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
        matched: false,

        // Asset information
        assetAddressOutbound: unpadAddress(eventData.inputToken),
        assetAddressInbound: unpadAddress(eventData.outputToken),
        amountInbound: eventData.outputAmount,
        amountOutbound: eventData.inputAmount,

        // Addresses
        sender: unpadAddress(eventData.depositor),
        recipient: unpadAddress(eventData.recipient),
        targetAddress: metadata.emitterAddress, // SpokePool contract address on origin

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
// LAYERZERO V2 BRIDGE HELPERS
// ============================================================================

function getEidForChain(chainId: number): number {
  const chainInfo = mapChainIdToChainInfo(chainId);
  if (!chainInfo) {
    throw new Error(`Unknown EID for chain ID ${chainId}`);
  }
  return chainInfo.eid;
}

interface LayerZeroPacketData {
  version: number;
  nonce: bigint;
  srcEid: number;
  sender: string;
  dstEid: number;
  receiver: string;
  payload: string;
  guid: string;
}

interface LayerZeroInboundEventData {
  direction: 'inbound';
  originSrcEid: number;
  originSender: string;
  originNonce: bigint;
  receiver: string;
  guid: string;
}

interface LayerZeroOutboundEventData {
  direction: 'outbound';
  chainId: number;
  packet: LayerZeroPacketData;
}

type LayerZeroEventData = LayerZeroInboundEventData | LayerZeroOutboundEventData;

function decodeLayerZeroPacket(encodedPayload: string): LayerZeroPacketData {
  try {
    const payload = encodedPayload.startsWith('0x') ? encodedPayload : '0x' + encodedPayload;

    if (payload.length < 164) {
      throw new Error(`Payload too short: ${payload.length}, minimum 164 characters expected`);
    }

    // Correct LayerZero V2 packet format:
    // Version: 1 byte (2 hex chars)
    // Nonce: 8 bytes (16 hex chars) - uint64
    // SrcEid: 4 bytes (8 hex chars) - uint32
    // Sender: 32 bytes (64 hex chars)
    // DstEid: 4 bytes (8 hex chars) - uint32
    // Receiver: 32 bytes (64 hex chars)
    // Payload: remaining bytes

    const version = parseInt(payload.slice(2, 4), 16);         // 1 byte
    const nonce = BigInt('0x' + payload.slice(4, 20));        // 8 bytes  
    const srcEid = parseInt(payload.slice(20, 28), 16);       // 4 bytes
    const sender = '0x' + payload.slice(28, 92);             // 32 bytes
    const dstEid = parseInt(payload.slice(92, 100), 16);     // 4 bytes
    const receiver = '0x' + payload.slice(100, 164);         // 32 bytes
    const appPayload = payload.slice(164);                   // rest

    const guid = calculateLayerZeroGUID(nonce, srcEid, sender, dstEid, receiver);

    return {
      version,
      nonce,
      srcEid,
      sender: unpadAddress(sender),
      dstEid,
      receiver: unpadAddress(receiver),
      payload: '0x' + appPayload,
      guid,
    };
  } catch (error) {
    console.error('Error decoding LayerZero packet:', error);
    throw error;
  }
}

function calculateLayerZeroGUID(nonce: bigint, srcEid: number | bigint, sender: string, dstEid: number | bigint, receiver: string): string {
  try {
    const paddedSender = pad(sender as `0x${string}`);
    const paddedReceiver = pad(receiver as `0x${string}`);

    const srcEidNumber = typeof srcEid === 'bigint' ? Number(srcEid) : srcEid;
    const dstEidNumber = typeof dstEid === 'bigint' ? Number(dstEid) : dstEid;

    // Use encodePacked as specified in LayerZero documentation:
    // guid = keccak256(abi.encodePacked(_nonce, _srcEid, _sender.toBytes32(), _dstEid, _receiver))
    return keccak256(encodePacked(
      ['uint64', 'uint32', 'bytes32', 'uint32', 'bytes32'],
      [nonce, srcEidNumber, paddedSender, dstEidNumber, paddedReceiver]
    ));
  } catch (error) {
    console.error('Error calculating LayerZero GUID:', error);
    throw error;
  }
}

async function handleLayerZeroMessage(
  eventData: LayerZeroEventData,
  metadata: EventMetadata,
  context: any
): Promise<void> {
  const guid = eventData.direction === 'inbound' ? eventData.guid : eventData.packet.guid;
  const crosschainMessageId = `layerzero:${guid}`;

  let crosschainMessage = await context.CrosschainMessage.get(crosschainMessageId);

  if (crosschainMessage) {
    if (eventData.direction === 'inbound') {
      const inboundTimestamp = metadata.blockTimestamp;
      const latency = crosschainMessage.timestampOutbound !== undefined
        ? inboundTimestamp - crosschainMessage.timestampOutbound
        : undefined;

      crosschainMessage = {
        ...crosschainMessage,
        blockInbound: metadata.blockNumber,
        timestampInbound: inboundTimestamp,
        txHashInbound: metadata.txHash,
        chainIdInbound: BigInt(metadata.chainId),
        toInbound: unpadAddress(eventData.receiver),
        matched: true,
        latency: latency,
      };
    } else {
      const outboundTimestamp = metadata.blockTimestamp;
      const latency = crosschainMessage.timestampInbound !== undefined
        ? crosschainMessage.timestampInbound - outboundTimestamp
        : undefined;

      crosschainMessage = {
        ...crosschainMessage,
        blockOutbound: metadata.blockNumber,
        timestampOutbound: outboundTimestamp,
        txHashOutbound: metadata.txHash,
        chainIdOutbound: BigInt(metadata.chainId),
        fromOutbound: unpadAddress(eventData.packet.sender),
        matched: true,
        latency: latency,
      };
    }
  } else {
    if (eventData.direction === 'inbound') {
      crosschainMessage = {
        id: crosschainMessageId,
        protocol: "layerzero",
        idMatching: guid,
        blockOutbound: undefined,
        timestampOutbound: undefined,
        txHashOutbound: undefined,
        chainIdOutbound: undefined,
        fromOutbound: undefined,
        blockInbound: metadata.blockNumber,
        timestampInbound: metadata.blockTimestamp,
        txHashInbound: metadata.txHash,
        chainIdInbound: BigInt(metadata.chainId),
        toInbound: unpadAddress(eventData.receiver),
        matched: false,
        latency: undefined,
      };
    } else {
      crosschainMessage = {
        id: crosschainMessageId,
        protocol: "layerzero",
        idMatching: guid,
        blockOutbound: metadata.blockNumber,
        timestampOutbound: metadata.blockTimestamp,
        txHashOutbound: metadata.txHash,
        chainIdOutbound: BigInt(metadata.chainId),
        fromOutbound: unpadAddress(eventData.packet.sender),
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

// ============================================================================
// STARGATE V2 BRIDGE HELPERS  
// ============================================================================

interface StargateInboundEventData {
  direction: 'inbound';
  guid: string;
  srcEid: number;
  toAddress: string;
  amountReceivedLD: bigint;
}

interface StargateOutboundEventData {
  direction: 'outbound';
  guid: string;
  dstEid: number;
  fromAddress: string;
  amountSentLD: bigint;
  amountReceivedLD: bigint;
}

type StargateEventData = StargateInboundEventData | StargateOutboundEventData;

async function handleStargateAppPayload(
  eventData: StargateEventData,
  metadata: EventMetadata,
  context: any
): Promise<void> {
  const crosschainMessageId = `layerzero:${eventData.guid}`;
  const transportingMsgProtocol = "layerzero";
  const transportingMsgId = eventData.guid;

  let counter = 0;
  let appPayloadId = `${transportingMsgProtocol}:${transportingMsgId}:${counter}`;
  let appPayload;

  // Find an unmatched id
  while (true) {
    const candidate = await context.AppPayload.get(appPayloadId);
    if (!candidate) {
      appPayload = undefined;
      break;
    }
    if (candidate.matched === true) {
      counter++;
      appPayloadId = `${transportingMsgProtocol}:${transportingMsgId}:${counter}`;
    } else {
      appPayload = candidate;
      break;
    }
  }

  // Build or update the AppPayload
  if (appPayload) {
    if (eventData.direction === 'inbound') {
      appPayload = {
        ...appPayload,
        matched: true,
        amountInbound: eventData.amountReceivedLD,
        recipient: unpadAddress(eventData.toAddress),
      };
    } else {
      appPayload = {
        ...appPayload,
        matched: true,
        amountOutbound: eventData.amountSentLD,
        amountInbound: eventData.amountReceivedLD,
        sender: unpadAddress(eventData.fromAddress),
      };
    }
  } else {
    // Create new AppPayload
    const basePayload = {
      id: appPayloadId,
      appName: "StargateV2",
      transportingMsgProtocol,
      transportingMsgId,
      idMatching: eventData.guid,
      matched: false,
      assetAddressOutbound: undefined,
      assetAddressInbound: undefined,
      amountOutbound: undefined,
      amountInbound: undefined,
      sender: undefined,
      recipient: undefined,
      targetAddress: metadata.emitterAddress,
      crosschainMessage_id: crosschainMessageId,
    };
    if (eventData.direction === 'inbound') {
      appPayload = {
        ...basePayload,
        amountInbound: eventData.amountReceivedLD,
        recipient: unpadAddress(eventData.toAddress),
      };
    } else {
      appPayload = {
        ...basePayload,
        amountOutbound: eventData.amountSentLD,
        amountInbound: eventData.amountReceivedLD,
        sender: unpadAddress(eventData.fromAddress),
      };
    }
  }

  await context.AppPayload.set(appPayload);
}

// ============================================================================
// LAYERZERO V2 EVENT HANDLERS
// ============================================================================

EndpointV2.PacketSent.handler(async ({ event, context }) => {
  try {
    const packet = decodeLayerZeroPacket(event.params.encodedPayload);

    const entity: EndpointV2_PacketSent = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      encodedPayload: event.params.encodedPayload,
      options: event.params.options,
      sendLibrary: event.params.sendLibrary,
      packetVersion: BigInt(packet.version),
      nonce: packet.nonce,
      srcEid: BigInt(packet.srcEid),
      sender: packet.sender,
      dstEid: BigInt(packet.dstEid),
      receiver: packet.receiver,
      payload: packet.payload,
      guid: packet.guid,
      chainId: BigInt(event.chainId),
      txHash: event.transaction.hash,
      from: event.transaction.from,
      to: event.transaction.to,
    };

    context.EndpointV2_PacketSent.set(entity);

    const eventData: LayerZeroOutboundEventData = {
      direction: 'outbound',
      chainId: event.chainId,
      packet: packet,
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

    await handleLayerZeroMessage(eventData, metadata, context);
  } catch (error) {
    console.error(`Error handling PacketSent event: ${error}`);
  }
});

EndpointV2.PacketDelivered.handler(async ({ event, context }) => {
  try {
    // For PacketDelivered, we need to use the EID of the destination chain (where the packet is delivered)
    // not the chain ID itself
    const dstEid = getEidForChain(event.chainId);

    const guid = calculateLayerZeroGUID(
      event.params.origin[2], // nonce
      Number(event.params.origin[0]), // srcEid
      event.params.origin[1], // sender
      dstEid, // use the EID of the destination chain
      event.params.receiver
    );

    const entity: EndpointV2_PacketDelivered = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      originSrcEid: event.params.origin[0], // srcEid
      originSender: unpadAddress(event.params.origin[1]), // sender
      originNonce: event.params.origin[2], // nonce
      receiver: unpadAddress(event.params.receiver),
      guid: guid,
      chainId: BigInt(event.chainId),
      txHash: event.transaction.hash,
      from: event.transaction.from,
      to: event.transaction.to,
    };

    context.EndpointV2_PacketDelivered.set(entity);

    const eventData: LayerZeroInboundEventData = {
      direction: 'inbound',
      originSrcEid: Number(event.params.origin[0]), // srcEid
      originSender: event.params.origin[1], // sender
      originNonce: event.params.origin[2], // nonce
      receiver: event.params.receiver,
      guid: guid,
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

    await handleLayerZeroMessage(eventData, metadata, context);
  } catch (error) {
    console.error(`Error handling PacketDelivered event: ${error}`);
  }
});

// ============================================================================
// STARGATE V2 EVENT HANDLERS
// ============================================================================

StargatePool.OFTSent.handler(async ({ event, context }) => {
  const entity: StargatePool_OFTSent = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    guid: event.params.guid,
    dstEid: event.params.dstEid,
    fromAddress: unpadAddress(event.params.fromAddress),
    amountSentLD: event.params.amountSentLD,
    amountReceivedLD: event.params.amountReceivedLD,
    chainId: BigInt(event.chainId),
    txHash: event.transaction.hash,
    from: event.transaction.from,
    to: event.transaction.to,
  };

  context.StargatePool_OFTSent.set(entity);

  const eventData: StargateOutboundEventData = {
    direction: 'outbound',
    guid: event.params.guid,
    dstEid: Number(event.params.dstEid),
    fromAddress: event.params.fromAddress,
    amountSentLD: event.params.amountSentLD,
    amountReceivedLD: event.params.amountReceivedLD,
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

  await handleStargateAppPayload(eventData, metadata, context);
});

StargatePool.OFTReceived.handler(async ({ event, context }) => {
  const entity: StargatePool_OFTReceived = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    guid: event.params.guid,
    srcEid: event.params.srcEid,
    toAddress: unpadAddress(event.params.toAddress),
    amountReceivedLD: event.params.amountReceivedLD,
    chainId: BigInt(event.chainId),
    txHash: event.transaction.hash,
    from: event.transaction.from,
    to: event.transaction.to,
  };

  context.StargatePool_OFTReceived.set(entity);

  const eventData: StargateInboundEventData = {
    direction: 'inbound',
    guid: event.params.guid,
    srcEid: Number(event.params.srcEid),
    toAddress: event.params.toAddress,
    amountReceivedLD: event.params.amountReceivedLD,
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

  await handleStargateAppPayload(eventData, metadata, context);
});

// ============================================================================
// TOKENMESSAGING EVENT HANDLERS (Stargate)
// ============================================================================

TokenMessaging.BusRode.handler(async ({ event, context }) => {
  const entity: TokenMessaging_BusRode = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    dstEid: event.params.dstEid,
    ticketId: event.params.ticketId,
    fare: event.params.fare,
    passenger: event.params.passenger,
    chainId: BigInt(event.chainId),
    txHash: event.transaction.hash,
    from: event.transaction.from,
    to: event.transaction.to,
  };

  context.TokenMessaging_BusRode.set(entity);
});

TokenMessaging.BusDriven.handler(async ({ event, context }) => {
  const entity: TokenMessaging_BusDriven = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    dstEid: event.params.dstEid,
    startTicketId: event.params.startTicketId,
    numPassengers: event.params.numPassengers,
    guid: event.params.guid,
    chainId: BigInt(event.chainId),
    txHash: event.transaction.hash,
    from: event.transaction.from,
    to: event.transaction.to,
  };

  context.TokenMessaging_BusDriven.set(entity);
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