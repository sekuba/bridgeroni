/**
 * Cross-Chain Bridge Monitor - Event Handlers
 * 
 * Processes CCTP v1/v2 and LayerZero v2 events to create matched cross-chain transfers.
 * 
 * Key Features:
 * - CCTP v1: Uses nonce-based matching (nonce available in both events)
 * - CCTP v2: Uses deterministic nonce computation (nonce only in MessageReceived)
 * - LayerZero v2: Uses packet header decoding for source/destination matching
 * - Maintains separate protocol versioning for metrics
 * 
 * IMPORTANT: Different protocols use different matching strategies!
 * - CCTP events use domain-based matching
 * - LayerZero events use EID-based matching
 * - Metrics should be calculated separately per protocol
 */

import {
  MessageTransmitter,
  TokenMessenger,
  TokenMessengerV2,
  MessageTransmitterV2,
  EndpointV2,
  CCTPTransfer,
  LayerZeroPacket,
  TokenMessenger_DepositForBurn,
  TokenMessenger_DepositForBurnV2,
  MessageTransmitter_MessageReceived,
  MessageTransmitter_MessageReceivedV2,
  EndpointV2_PacketSent,
  EndpointV2_PacketDelivered,
} from "generated";

import { 
  createTransferId,
  getDomainFromChainId,
  LAYERZERO_EID_BY_CHAIN_ID,
  LAYERZERO_EID_TO_CHAIN_ID
} from "./constants";

import {
  decodeV2MessageBody,
  computeV2DeterministicNonce
} from "./utils/cctpDecoder";

import {
  decodePacket,
  createLayerZeroGuid
} from "./utils/lz2Decoder";

/* ---------- Helper Functions ---------- */

/**
 * Create and update a LayerZeroPacket entity
 */
function createLayerZeroPacket(params: {
  id: string;
  srcEid: bigint;
  dstEid: bigint | undefined;
  nonce: bigint;
  sender: string;
  receiver: string;
  chainId: number;
  timestamp: bigint;
  txHash: string;
  eventType: 'sent' | 'delivered';
  prev?: LayerZeroPacket;
  // Sent-specific fields
  encodedPayload?: string;
  options?: string;
  sendLibrary?: string;
  payload?: string;
}): LayerZeroPacket {
  const isSent = params.eventType === 'sent';
  const isDelivered = params.eventType === 'delivered';
  const matched = !!(params.prev?.sourceTxHash && params.prev?.destinationTxHash) ||
                  !!(isSent && params.prev?.destinationTxHash) ||
                  !!(isDelivered && params.prev?.sourceTxHash);
  
  const sentTs = isSent ? params.timestamp : params.prev?.sentTimestamp;
  const deliveredTs = isDelivered ? params.timestamp : params.prev?.deliveredTimestamp;
  const latencySeconds = matched && sentTs && deliveredTs ? deliveredTs - sentTs : undefined;
  
  // Derive chain IDs from EIDs for proper URL generation
  const srcChainId = params.srcEid ? LAYERZERO_EID_TO_CHAIN_ID[Number(params.srcEid)] : undefined;
  const dstChainId = params.dstEid ? LAYERZERO_EID_TO_CHAIN_ID[Number(params.dstEid)] : undefined;
  
  return {
    id: params.id,
    srcEid: params.srcEid,
    dstEid: params.dstEid,
    nonce: params.nonce,
    sender: params.sender,
    receiver: params.receiver,
    
    // Source-side data
    encodedPayload: params.encodedPayload || params.prev?.encodedPayload,
    options: params.options || params.prev?.options,
    sendLibrary: params.sendLibrary || params.prev?.sendLibrary,
    payload: params.payload || params.prev?.payload,
    sourceTxHash: isSent ? params.txHash : params.prev?.sourceTxHash,
    sentBlock: isSent ? params.timestamp : params.prev?.sentBlock,
    sentTimestamp: sentTs,
    
    // Destination-side data
    destinationTxHash: isDelivered ? params.txHash : params.prev?.destinationTxHash,
    deliveredBlock: isDelivered ? params.timestamp : params.prev?.deliveredBlock,
    deliveredTimestamp: deliveredTs,
    
    // Derived fields
    matched,
    latencySeconds,
    
    // Computed fields for TUI efficiency
    hasPayload: !!(params.payload || params.prev?.payload),
    sourceChainId: srcChainId ? BigInt(srcChainId) : (isSent ? BigInt(params.chainId) : params.prev?.sourceChainId),
    destinationChainId: dstChainId ? BigInt(dstChainId) : (isDelivered ? BigInt(params.chainId) : params.prev?.destinationChainId),
    eventType: matched ? "matched" : params.eventType,
    lastUpdated: params.timestamp,
  };
}

/**
 * Create and update a CCTPTransfer entity
 */
function createCCTPTransfer(params: {
  id: string;
  sourceDomain: bigint;
  destinationDomain: bigint | undefined;
  nonce: string;
  version: 'v1' | 'v2';
  chainId: number;
  timestamp: bigint;
  txHash: string;
  eventType: 'deposit' | 'received';
  prev?: CCTPTransfer;
  // Deposit-specific fields
  amount?: bigint;
  burnToken?: string;
  depositor?: string;
  mintRecipient?: string;
  // V2-specific fields
  maxFee?: bigint;
  minFinalityThreshold?: bigint;
  hookData?: string;
  finalityThresholdExecuted?: bigint;
  // Message-specific fields
  messageBody?: string;
}): CCTPTransfer {
  const isDeposit = params.eventType === 'deposit';
  const isReceived = params.eventType === 'received';
  const matched = !!(params.prev?.sourceTxHash && params.prev?.destinationTxHash) ||
                  !!(isDeposit && params.prev?.destinationTxHash) ||
                  !!(isReceived && params.prev?.sourceTxHash);
  
  const depositTs = isDeposit ? params.timestamp : params.prev?.depositTimestamp;
  const messageTs = isReceived ? params.timestamp : params.prev?.messageReceivedTimestamp;
  const latencySeconds = matched && depositTs && messageTs ? messageTs - depositTs : undefined;
  
  return {
    id: params.id,
    sourceDomain: params.sourceDomain,
    destinationDomain: params.destinationDomain,
    nonce: params.nonce,
    version: params.version,
    
    // Source-side data
    amount: params.amount || params.prev?.amount,
    burnToken: params.burnToken || params.prev?.burnToken,
    depositor: params.depositor || params.prev?.depositor,
    mintRecipient: params.mintRecipient || params.prev?.mintRecipient,
    sourceTxHash: isDeposit ? params.txHash : params.prev?.sourceTxHash,
    depositBlock: isDeposit ? BigInt(params.timestamp) : params.prev?.depositBlock,
    depositTimestamp: depositTs,
    
    // V2-specific fields
    maxFee: params.maxFee || params.prev?.maxFee,
    minFinalityThreshold: params.minFinalityThreshold || params.prev?.minFinalityThreshold,
    hookData: params.hookData || params.prev?.hookData,
    finalityThresholdExecuted: params.finalityThresholdExecuted || params.prev?.finalityThresholdExecuted,
    
    // Destination-side data
    destinationTxHash: isReceived ? params.txHash : params.prev?.destinationTxHash,
    messageReceivedBlock: isReceived ? BigInt(params.timestamp) : params.prev?.messageReceivedBlock,
    messageReceivedTimestamp: messageTs,
    
    // Derived fields
    matched,
    latencySeconds,
    
    // Computed fields for TUI efficiency
    hasAmount: !!(params.amount || params.prev?.amount),
    sourceChainId: isDeposit ? BigInt(params.chainId) : params.prev?.sourceChainId,
    destinationChainId: isReceived ? BigInt(params.chainId) : params.prev?.destinationChainId,
    eventType: matched ? "matched" : params.eventType,
    lastUpdated: params.timestamp,
  };
}

/* ---------- CCTP v1 Event Handlers ---------- */

// v1 Source: TokenMessenger DepositForBurn
// Has nonce available for direct matching
TokenMessenger.DepositForBurn.handler(async ({ event, context }) => {
  const srcDomain = getDomainFromChainId(event.chainId);
  if (srcDomain === undefined) return;

  const id = createTransferId(srcDomain, event.params.nonce);
  const prev = await context.CCTPTransfer.get(id);
  const timestamp = BigInt(event.block.timestamp);

  const transfer = createCCTPTransfer({
    id,
    sourceDomain: srcDomain,
    destinationDomain: event.params.destinationDomain,
    nonce: event.params.nonce.toString(),
    version: 'v1',
    chainId: event.chainId,
    timestamp,
    txHash: event.transaction.hash,
    eventType: 'deposit',
    prev,
    amount: event.params.amount,
    burnToken: event.params.burnToken,
    depositor: event.params.depositor,
    mintRecipient: event.params.mintRecipient,
  });

  context.CCTPTransfer.set(transfer);

  // Enhanced raw event log
  context.TokenMessenger_DepositForBurn.set({
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    ...event.params,
    chainId: BigInt(event.chainId),
    blockNumber: BigInt(event.block.number),
    blockTimestamp: timestamp,
    txHash: event.transaction.hash,
  } as TokenMessenger_DepositForBurn);
});

// v1 Destination: MessageTransmitter MessageReceived
// Uses nonce from event for matching
MessageTransmitter.MessageReceived.handler(async ({ event, context }) => {
  const id = createTransferId(event.params.sourceDomain, event.params.nonce);
  const prev = await context.CCTPTransfer.get(id);
  const timestamp = BigInt(event.block.timestamp);
  const destDomain = getDomainFromChainId(event.chainId);

  const transfer = createCCTPTransfer({
    id,
    sourceDomain: event.params.sourceDomain,
    destinationDomain: destDomain,
    nonce: event.params.nonce.toString(),
    version: (prev?.version || 'v1') as 'v1' | 'v2',
    chainId: event.chainId,
    timestamp,
    txHash: event.transaction.hash,
    eventType: 'received',
    prev,
  });

  context.CCTPTransfer.set(transfer);

  // Enhanced raw event log
  context.MessageTransmitter_MessageReceived.set({
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    ...event.params,
    chainId: BigInt(event.chainId),
    blockNumber: BigInt(event.block.number),
    blockTimestamp: timestamp,
    txHash: event.transaction.hash,
  } as MessageTransmitter_MessageReceived);
});

/* ---------- CCTP v2 Event Handlers ---------- */

// v2 Source: TokenMessengerV2 DepositForBurn
// No nonce available - compute deterministic nonce for matching
TokenMessengerV2.DepositForBurn.handler(async ({ event, context }) => {
  const srcDomain = getDomainFromChainId(event.chainId);
  if (srcDomain === undefined) return;

  // Compute deterministic nonce from deposit event data
  const computedNonce = computeV2DeterministicNonce(
    srcDomain,
    event.params.destinationDomain,
    event.params.burnToken,
    event.params.mintRecipient,
    event.params.amount,
    event.params.depositor, // messageSender is the depositor
    event.params.maxFee,
    event.params.hookData
  );

  const id = createTransferId(srcDomain, computedNonce);
  const prev = await context.CCTPTransfer.get(id);
  const timestamp = BigInt(event.block.timestamp);

  const transfer = createCCTPTransfer({
    id,
    sourceDomain: srcDomain,
    destinationDomain: event.params.destinationDomain,
    nonce: computedNonce,
    version: 'v2',
    chainId: event.chainId,
    timestamp,
    txHash: event.transaction.hash,
    eventType: 'deposit',
    prev,
    amount: event.params.amount,
    burnToken: event.params.burnToken,
    depositor: event.params.depositor,
    mintRecipient: event.params.mintRecipient,
    maxFee: event.params.maxFee,
    minFinalityThreshold: event.params.minFinalityThreshold,
    hookData: event.params.hookData,
  });

  context.CCTPTransfer.set(transfer);

  // Enhanced raw event log
  context.TokenMessenger_DepositForBurnV2.set({
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    ...event.params,
    chainId: BigInt(event.chainId),
    blockNumber: BigInt(event.block.number),
    blockTimestamp: timestamp,
    txHash: event.transaction.hash,
  } as TokenMessenger_DepositForBurnV2);
});

// v2 Destination: MessageTransmitterV2 MessageReceived
// Decode messageBody and compute same deterministic nonce
MessageTransmitterV2.MessageReceived.handler(async ({ event, context }) => {
  const destDomain = getDomainFromChainId(event.chainId);
  if (destDomain === undefined) return;

  const timestamp = BigInt(event.block.timestamp);
  const sourceDomain = event.params.sourceDomain;
  
  // Decode message body to extract transfer details
  const decodedMessage = decodeV2MessageBody(event.params.messageBody);
  if (!decodedMessage) {
    console.error('Failed to decode message body for v2 MessageReceived event');
    return;
  }
  
  // Compute the same deterministic nonce that was used on the source side
  const computedNonce = computeV2DeterministicNonce(
    sourceDomain,
    destDomain,
    decodedMessage.burnToken,
    decodedMessage.mintRecipient,
    decodedMessage.amount,
    decodedMessage.messageSender,
    decodedMessage.maxFee,
    decodedMessage.hookData
  );
  
  const id = createTransferId(sourceDomain, computedNonce);
  const prev = await context.CCTPTransfer.get(id);

  const transfer = createCCTPTransfer({
    id,
    sourceDomain: sourceDomain,
    destinationDomain: destDomain,
    nonce: computedNonce,
    version: 'v2',
    chainId: event.chainId,
    timestamp,
    txHash: event.transaction.hash,
    eventType: 'received',
    prev,
    // Use decoded message data if source side data is not available
    amount: decodedMessage.amount,
    burnToken: decodedMessage.burnToken,
    depositor: decodedMessage.messageSender,
    mintRecipient: decodedMessage.mintRecipient,
    maxFee: decodedMessage.maxFee,
    hookData: decodedMessage.hookData,
    finalityThresholdExecuted: event.params.finalityThresholdExecuted,
  });

  context.CCTPTransfer.set(transfer);

  // Enhanced raw event log
  context.MessageTransmitter_MessageReceivedV2.set({
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    ...event.params,
    chainId: BigInt(event.chainId),
    blockNumber: BigInt(event.block.number),
    blockTimestamp: timestamp,
    txHash: event.transaction.hash,
  } as MessageTransmitter_MessageReceivedV2);
});

/* ---------- LayerZero v2 Event Handlers ---------- */
/*
 * LayerZero v2 event handling supports unordered event processing:
 * 
 * Scenario 1: PacketSent processed first, then PacketDelivered
 * - PacketSent creates new packet record with source data
 * - PacketDelivered updates existing packet with destination data → MATCHED
 * 
 * Scenario 2: PacketDelivered processed first, then PacketSent  
 * - PacketDelivered creates new packet record with destination data
 * - PacketSent updates existing packet with source data → MATCHED
 * 
 * Scenario 3: Only PacketSent processed (no delivery yet)
 * - PacketSent creates packet record with source data only → UNMATCHED
 * 
 * Scenario 4: Only PacketDelivered processed (no sent event indexed)
 * - PacketDelivered creates packet record with destination data only → UNMATCHED
 * 
 * All scenarios use the same GUID for matching: keccak256(nonce, srcEid, sender, dstEid, receiver)
 */

// LayerZero v2 Source: EndpointV2 PacketSent
// Decode packet header to extract routing information
EndpointV2.PacketSent.handler(async ({ event, context }) => {
  const timestamp = BigInt(event.block.timestamp);
  
  // Decode the packet header to extract routing information
  const decodedPacket = decodePacket(event.params.encodedPayload);
  if (!decodedPacket) {
    console.error('Failed to decode LayerZero packet header');
    return;
  }
  
  const { header, payload } = decodedPacket;
  
  // Create LayerZero GUID for proper matching
  const guid = createLayerZeroGuid(
    header.nonce,
    header.srcEid,
    header.sender,
    header.dstEid,
    header.receiver
  );
  
  // Check if we already have a packet (possibly from a delivered event that was processed first)
  const existingPacket = await context.LayerZeroPacket.get(guid);
  
  const packet = createLayerZeroPacket({
    id: guid,
    srcEid: BigInt(header.srcEid),
    dstEid: BigInt(header.dstEid),
    nonce: header.nonce,
    sender: header.sender,
    receiver: header.receiver,
    chainId: event.chainId,
    timestamp,
    txHash: event.transaction.hash,
    eventType: 'sent',
    prev: existingPacket,
    encodedPayload: event.params.encodedPayload,
    options: event.params.options,
    sendLibrary: event.params.sendLibrary,
    payload,
  });
  
  context.LayerZeroPacket.set(packet);
  
  // Enhanced raw event log
  context.EndpointV2_PacketSent.set({
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    ...event.params,
    chainId: BigInt(event.chainId),
    blockNumber: BigInt(event.block.number),
    blockTimestamp: timestamp,
    txHash: event.transaction.hash,
  } as EndpointV2_PacketSent);
});

// LayerZero v2 Destination: EndpointV2 PacketDelivered
// Uses Origin tuple to match with sent packet
EndpointV2.PacketDelivered.handler(async ({ event, context }) => {
  const timestamp = BigInt(event.block.timestamp);
  
  // Extract origin information from the tuple (uint32,bytes32,uint64)
  // event.params.origin is [srcEid, sender, nonce]
  const origin = {
    srcEid: Number(event.params.origin[0]),  // uint32 srcEid
    sender: event.params.origin[1],          // bytes32 sender
    nonce: event.params.origin[2],           // uint64 nonce
  };
  
  // Get the EID for the current chain (destination)
  const destEid = LAYERZERO_EID_BY_CHAIN_ID[event.chainId];
  if (!destEid) {
    console.error(`No LayerZero EID found for chain ID ${event.chainId}`);
    return;
  }
  
  // Create the LayerZero GUID using the complete routing information
  const guid = createLayerZeroGuid(
    origin.nonce,
    origin.srcEid,
    origin.sender,
    destEid,
    event.params.receiver
  );
  
  // Check if we already have a packet (possibly from a sent event that was processed first)
  const existingPacket = await context.LayerZeroPacket.get(guid);
  
  // Create or update the packet record
  // If no existing packet, create a new one (sent event will be processed later)
  // If existing packet exists, update it with delivered information
  const packet = createLayerZeroPacket({
    id: guid,
    srcEid: BigInt(origin.srcEid),
    dstEid: BigInt(destEid),
    nonce: origin.nonce,
    sender: origin.sender,
    receiver: event.params.receiver,
    chainId: event.chainId,
    timestamp,
    txHash: event.transaction.hash,
    eventType: 'delivered',
    prev: existingPacket,
  });
  
  context.LayerZeroPacket.set(packet);
  
  // Enhanced raw event log
  context.EndpointV2_PacketDelivered.set({
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    originSrcEid: event.params.origin[0],    // uint32 srcEid
    originSender: event.params.origin[1],    // bytes32 sender
    originNonce: event.params.origin[2],     // uint64 nonce
    receiver: event.params.receiver,
    chainId: BigInt(event.chainId),
    blockNumber: BigInt(event.block.number),
    blockTimestamp: timestamp,
    txHash: event.transaction.hash,
  } as EndpointV2_PacketDelivered);
});