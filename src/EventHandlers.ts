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
  UltraLightNodeV2,
  SendUln301,
  ReceiveUln301,
  PolygonZkEVMBridgeV2,
  CCTPTransfer,
  LayerZeroPacket,
  LayerZeroV1Packet,
  AgglayerTransfer,
  TokenMessenger_DepositForBurn,
  TokenMessenger_DepositForBurnV2,
  MessageTransmitter_MessageReceived,
  MessageTransmitter_MessageReceivedV2,
  EndpointV2_PacketSent,
  EndpointV2_PacketDelivered,
  UltraLightNodeV2_Packet,
  UltraLightNodeV2_PacketReceived,
  SendUln301_PacketSent,
  ReceiveUln301_PacketDelivered,
  PolygonZkEVMBridgeV2_BridgeEvent,
  PolygonZkEVMBridgeV2_ClaimEvent,
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

import {
  decodeV1Packet,
  decodeV1SendUln301Packet,
  createV1PacketId,
  getActualChainId,
  getLzV1ChainId
} from "./utils/lz1Decoder";

import {
  decodeTokenMetadata,
  decodeGlobalIndex,
} from "./utils/agglayerDecoder";

import { createAgglayerTransferId } from "./constants";

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
 * Create and update a LayerZeroV1Packet entity
 */
function createLayerZeroV1Packet(params: {
  id: string;
  srcChainId: bigint;
  dstChainId: bigint | undefined;
  nonce: bigint;
  ua: string;
  dstAddress: string;
  chainId: number;
  timestamp: bigint;
  txHash: string;
  eventType: 'sent' | 'delivered';
  protocol: 'UltraLightNodeV2' | 'SendUln301';
  prev?: LayerZeroV1Packet;
  // Source-specific fields
  payload?: string;
  encodedPayload?: string;
  options?: string;
  nativeFee?: bigint;
  lzTokenFee?: bigint;
  // Destination-specific fields
  payloadHash?: string;
  srcAddress?: string;
}): LayerZeroV1Packet {
  const isSent = params.eventType === 'sent';
  const isDelivered = params.eventType === 'delivered';
  const matched = !!(params.prev?.sourceTxHash && params.prev?.destinationTxHash) ||
                  !!(isSent && params.prev?.destinationTxHash) ||
                  !!(isDelivered && params.prev?.sourceTxHash);
  
  const sentTs = isSent ? params.timestamp : params.prev?.sentTimestamp;
  const deliveredTs = isDelivered ? params.timestamp : params.prev?.deliveredTimestamp;
  const latencySeconds = matched && sentTs && deliveredTs ? deliveredTs - sentTs : undefined;
  
  return {
    id: params.id,
    srcChainId: params.srcChainId,
    dstChainId: params.dstChainId,
    nonce: params.nonce,
    ua: params.ua,
    dstAddress: params.dstAddress,
    
    // Source-side data
    payload: params.payload || params.prev?.payload,
    encodedPayload: params.encodedPayload || params.prev?.encodedPayload,
    options: params.options || params.prev?.options,
    nativeFee: params.nativeFee || params.prev?.nativeFee,
    lzTokenFee: params.lzTokenFee || params.prev?.lzTokenFee,
    sourceTxHash: isSent ? params.txHash : params.prev?.sourceTxHash,
    sentBlock: isSent ? params.timestamp : params.prev?.sentBlock,
    sentTimestamp: sentTs,
    
    // Destination-side data
    payloadHash: params.payloadHash || params.prev?.payloadHash,
    srcAddress: params.srcAddress || params.prev?.srcAddress,
    destinationTxHash: isDelivered ? params.txHash : params.prev?.destinationTxHash,
    deliveredBlock: isDelivered ? params.timestamp : params.prev?.deliveredBlock,
    deliveredTimestamp: deliveredTs,
    
    // Derived fields
    matched,
    latencySeconds,
    version: 'v1',
    protocol: params.protocol,
    
    // Computed fields for TUI efficiency
    hasPayload: !!(params.payload || params.prev?.payload),
    sourceChainId: isSent ? BigInt(params.chainId) : params.prev?.sourceChainId,
    destinationChainId: isDelivered ? BigInt(params.chainId) : params.prev?.destinationChainId,
    eventType: matched ? "matched" : params.eventType,
    lastUpdated: params.timestamp,
  };
}

/**
 * Create and update an AgglayerTransfer entity
 */
function createAgglayerTransfer(params: {
  id: string;
  assetOriginNetwork: bigint;
  assetDestinationNetwork: bigint | undefined;
  assetOriginAddress: string;
  destinationAddress: string;
  amount: bigint;
  chainId: number;
  timestamp: bigint;
  txHash: string;
  eventType: 'bridge' | 'claim';
  prev?: AgglayerTransfer;
  // Bridge-specific fields
  leafType?: bigint;
  metadata?: string;
  depositCount?: bigint;
  // Claim-specific fields
  globalIndex?: bigint;
  mainnetFlag?: boolean;
  rollupIndex?: bigint;
  localRootIndex?: bigint;
}): AgglayerTransfer {
  const isBridge = params.eventType === 'bridge';
  const isClaim = params.eventType === 'claim';
  
  // Enhanced matching logic: check both transaction existence AND depositCount matching
  const hasSourceAndDest = !!(params.prev?.sourceTxHash && params.prev?.destinationTxHash) ||
                          !!(isBridge && params.prev?.destinationTxHash) ||
                          !!(isClaim && params.prev?.sourceTxHash);
  
  // Check if depositCount matches localRootIndex for additional verification
  const depositCount = params.depositCount || params.prev?.depositCount;
  const localRootIndex = params.localRootIndex || params.prev?.localRootIndex;
  const depositCountMatches = !!(depositCount !== undefined && localRootIndex !== undefined && depositCount === localRootIndex);
  const matched = hasSourceAndDest && depositCountMatches;
  
  const bridgeTs = isBridge ? params.timestamp : params.prev?.bridgeTimestamp;
  const claimTs = isClaim ? params.timestamp : params.prev?.claimTimestamp;
  const latencySeconds = matched && bridgeTs && claimTs ? claimTs - bridgeTs : undefined;
  
  // Decode token information from metadata
  const metadata = params.metadata || params.prev?.metadata;
  const tokenInfo = metadata ? decodeTokenMetadata(metadata) : null;
  
  return {
    id: params.id,
    assetOriginNetwork: params.assetOriginNetwork,
    assetDestinationNetwork: params.assetDestinationNetwork,
    assetOriginAddress: params.assetOriginAddress,
    destinationAddress: params.destinationAddress,
    amount: params.amount,
    
    // Source-side data
    leafType: params.leafType ?? params.prev?.leafType ?? 0n,
    metadata: metadata,
    depositCount: depositCount ?? 0n,
    sourceTxHash: isBridge ? params.txHash : params.prev?.sourceTxHash,
    bridgeBlock: isBridge ? params.timestamp : params.prev?.bridgeBlock,
    bridgeTimestamp: bridgeTs,
    
    // Decoded token information
    tokenName: tokenInfo?.name || params.prev?.tokenName,
    tokenSymbol: tokenInfo?.symbol || params.prev?.tokenSymbol,
    tokenDecimals: tokenInfo?.decimals || params.prev?.tokenDecimals,
    
    // Destination-side data
    globalIndex: params.globalIndex || params.prev?.globalIndex,
    mainnetFlag: params.mainnetFlag !== undefined ? params.mainnetFlag : params.prev?.mainnetFlag,
    rollupIndex: params.rollupIndex || params.prev?.rollupIndex,
    localRootIndex: localRootIndex,
    destinationTxHash: isClaim ? params.txHash : params.prev?.destinationTxHash,
    claimBlock: isClaim ? params.timestamp : params.prev?.claimBlock,
    claimTimestamp: claimTs,
    
    // Derived fields
    matched,
    latencySeconds,
    depositCountMatches,
    
    // Computed fields for TUI efficiency
    hasAmount: !!params.amount,
    sourceChainId: isBridge ? BigInt(params.chainId) : params.prev?.sourceChainId,
    destinationChainId: isClaim ? BigInt(params.chainId) : params.prev?.destinationChainId,
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

/* ---------- LayerZero v1 Event Handlers ---------- */
/*
 * LayerZero v1 has two different event paths:
 * 
 * Path 1: UltraLightNodeV2
 * - Source: UltraLightNodeV2.Packet (bytes payload)
 * - Destination: UltraLightNodeV2.PacketReceived (uint16 srcChainId, bytes srcAddress, address dstAddress, uint64 nonce, bytes32 payloadHash)
 * 
 * Path 2: SendUln301 -> ReceiveUln301
 * - Source: SendUln301.PacketSent (bytes encodedPayload, bytes options, uint256 nativeFee, uint256 lzTokenFee)
 * - Destination: ReceiveUln301.PacketDelivered ((uint32,bytes32,uint64) origin, address receiver)
 * 
 * Matching Strategy:
 * - Path 1: Use decoded payload data (nonce, srcChainId, ua, dstChainId, dstAddress) to create deterministic ID
 * - Path 2: Use the same structure as LayerZero v2 (nonce, srcEid, sender, dstEid, receiver) to create deterministic ID
 * 
 * All scenarios support unordered event processing similar to LayerZero v2.
 */

// LayerZero v1 UltraLightNodeV2 Source: Packet event
// Decode payload to extract routing information for matching
UltraLightNodeV2.Packet.handler(async ({ event, context }) => {
  const timestamp = BigInt(event.block.timestamp);
  
  // Decode the packet payload to extract routing information
  const decodedPacket = decodeV1Packet(event.params.payload);
  if (!decodedPacket) {
    console.error('Failed to decode LayerZero v1 packet payload');
    return;
  }
  
  // Get actual chain IDs from LayerZero v1 chain IDs
  const actualSrcChainId = getActualChainId(decodedPacket.localChainId) || event.chainId;
  const actualDstChainId = getActualChainId(decodedPacket.dstChainId);
  
  // Create matching ID based on decoded packet data
  const packetId = createV1PacketId(
    decodedPacket.nonce,
    decodedPacket.localChainId,
    decodedPacket.ua,
    decodedPacket.dstChainId,
    decodedPacket.dstAddress
  );
  
  // Check if we already have a packet (possibly from a received event that was processed first)
  const existingPacket = await context.LayerZeroV1Packet.get(packetId);
  
  const packet = createLayerZeroV1Packet({
    id: packetId,
    srcChainId: BigInt(actualSrcChainId),
    dstChainId: actualDstChainId ? BigInt(actualDstChainId) : undefined,
    nonce: decodedPacket.nonce,
    ua: decodedPacket.ua,
    dstAddress: decodedPacket.dstAddress,
    chainId: event.chainId,
    timestamp,
    txHash: event.transaction.hash,
    eventType: 'sent',
    protocol: 'UltraLightNodeV2',
    prev: existingPacket,
    payload: decodedPacket.payload,
  });
  
  context.LayerZeroV1Packet.set(packet);
  
  // Enhanced raw event log
  context.UltraLightNodeV2_Packet.set({
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    ...event.params,
    chainId: BigInt(event.chainId),
    blockNumber: BigInt(event.block.number),
    blockTimestamp: timestamp,
    txHash: event.transaction.hash,
  } as UltraLightNodeV2_Packet);
});

// LayerZero v1 UltraLightNodeV2 Destination: PacketReceived event
// Use event parameters to match with sent packet
UltraLightNodeV2.PacketReceived.handler(async ({ event, context }) => {
  const timestamp = BigInt(event.block.timestamp);
  
  // Get actual chain IDs from LayerZero v1 chain IDs
  const srcChainId = Number(event.params.srcChainId);
  const actualSrcChainId = getActualChainId(srcChainId) || srcChainId;
  const actualDstChainId = event.chainId;
  
  // Create matching ID using the same parameters as the source event
  // Note: srcAddress in v1 is bytes, dstAddress is address
  const packetId = createV1PacketId(
    event.params.nonce,
    srcChainId,
    event.params.dstAddress, // This is actually the UA (User Application)
    getLzV1ChainId(actualDstChainId) || actualDstChainId,
    event.params.dstAddress
  );
  
  // Check if we already have a packet (possibly from a sent event that was processed first)
  const existingPacket = await context.LayerZeroV1Packet.get(packetId);
  
  const packet = createLayerZeroV1Packet({
    id: packetId,
    srcChainId: BigInt(actualSrcChainId),
    dstChainId: BigInt(actualDstChainId),
    nonce: event.params.nonce,
    ua: event.params.dstAddress, // UA is the destination address in this context
    dstAddress: event.params.dstAddress,
    chainId: event.chainId,
    timestamp,
    txHash: event.transaction.hash,
    eventType: 'delivered',
    protocol: 'UltraLightNodeV2',
    prev: existingPacket,
    payloadHash: event.params.payloadHash,
    srcAddress: event.params.srcAddress,
  });
  
  context.LayerZeroV1Packet.set(packet);
  
  // Enhanced raw event log
  context.UltraLightNodeV2_PacketReceived.set({
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    srcChainId: event.params.srcChainId,
    srcAddress: event.params.srcAddress,
    dstAddress: event.params.dstAddress,
    nonce: event.params.nonce,
    payloadHash: event.params.payloadHash,
    chainId: BigInt(event.chainId),
    blockNumber: BigInt(event.block.number),
    blockTimestamp: timestamp,
    txHash: event.transaction.hash,
  } as UltraLightNodeV2_PacketReceived);
});

// LayerZero v1 SendUln301 Source: PacketSent event
// Decode encodedPayload to extract routing information for matching
SendUln301.PacketSent.handler(async ({ event, context }) => {
  const timestamp = BigInt(event.block.timestamp);
  
  // Decode the encoded payload to extract routing information
  const decodedPacket = decodeV1SendUln301Packet(event.params.encodedPayload);
  if (!decodedPacket) {
    console.error('Failed to decode LayerZero v1 SendUln301 packet payload');
    return;
  }
  
  const { header, payload } = decodedPacket;
  
  // Get actual chain IDs from EIDs
  const actualSrcChainId = getActualChainId(header.srcEid) || event.chainId;
  const actualDstChainId = getActualChainId(header.dstEid);
  
  // Create matching ID using the same structure as LayerZero v2
  const guid = createLayerZeroGuid(
    header.nonce,
    header.srcEid,
    header.sender,
    header.dstEid,
    header.receiver
  );
  
  // Check if we already have a packet (possibly from a delivered event that was processed first)
  const existingPacket = await context.LayerZeroV1Packet.get(guid);
  
  const packet = createLayerZeroV1Packet({
    id: guid,
    srcChainId: BigInt(actualSrcChainId),
    dstChainId: actualDstChainId ? BigInt(actualDstChainId) : undefined,
    nonce: header.nonce,
    ua: header.sender, // In SendUln301, sender acts as the UA
    dstAddress: header.receiver,
    chainId: event.chainId,
    timestamp,
    txHash: event.transaction.hash,
    eventType: 'sent',
    protocol: 'SendUln301',
    prev: existingPacket,
    encodedPayload: event.params.encodedPayload,
    options: event.params.options,
    nativeFee: event.params.nativeFee,
    lzTokenFee: event.params.lzTokenFee,
    payload,
  });
  
  context.LayerZeroV1Packet.set(packet);
  
  // Enhanced raw event log
  context.SendUln301_PacketSent.set({
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    ...event.params,
    chainId: BigInt(event.chainId),
    blockNumber: BigInt(event.block.number),
    blockTimestamp: timestamp,
    txHash: event.transaction.hash,
  } as SendUln301_PacketSent);
});

// LayerZero v1 ReceiveUln301 Destination: PacketDelivered event
// Uses the same origin tuple format as LayerZero v2
ReceiveUln301.PacketDelivered.handler(async ({ event, context }) => {
  const timestamp = BigInt(event.block.timestamp);
  
  // Extract origin information from the tuple (uint32,bytes32,uint64)
  // event.params.origin is [srcEid, sender, nonce]
  const origin = {
    srcEid: Number(event.params.origin[0]),  // uint32 srcEid
    sender: event.params.origin[1],          // bytes32 sender
    nonce: event.params.origin[2],           // uint64 nonce
  };
  
  // Get actual chain IDs from EIDs
  const actualSrcChainId = getActualChainId(origin.srcEid) || origin.srcEid;
  const actualDstChainId = event.chainId;
  
  // Create matching ID using the same structure as the source event
  const guid = createLayerZeroGuid(
    origin.nonce,
    origin.srcEid,
    origin.sender,
    getLzV1ChainId(actualDstChainId) || actualDstChainId,
    event.params.receiver
  );
  
  // Check if we already have a packet (possibly from a sent event that was processed first)
  const existingPacket = await context.LayerZeroV1Packet.get(guid);
  
  const packet = createLayerZeroV1Packet({
    id: guid,
    srcChainId: BigInt(actualSrcChainId),
    dstChainId: BigInt(actualDstChainId),
    nonce: origin.nonce,
    ua: origin.sender, // In ReceiveUln301, sender acts as the UA
    dstAddress: event.params.receiver,
    chainId: event.chainId,
    timestamp,
    txHash: event.transaction.hash,
    eventType: 'delivered',
    protocol: 'SendUln301',
    prev: existingPacket,
  });
  
  context.LayerZeroV1Packet.set(packet);
  
  // Enhanced raw event log
  context.ReceiveUln301_PacketDelivered.set({
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    originSrcEid: event.params.origin[0],    // uint32 srcEid
    originSender: event.params.origin[1],    // bytes32 sender
    originNonce: event.params.origin[2],     // uint64 nonce
    receiver: event.params.receiver,
    chainId: BigInt(event.chainId),
    blockNumber: BigInt(event.block.number),
    blockTimestamp: timestamp,
    txHash: event.transaction.hash,
  } as ReceiveUln301_PacketDelivered);
});

/* ---------- Agglayer Bridge Event Handlers ---------- */
/*
 * Agglayer bridge handling provides robust cross-chain event matching for the Polygon zkEVM ecosystem.
 * 
 * Key Features:
 * - Deterministic matching using (assetOriginNetwork, assetOriginAddress, destinationAddress, amount, depositCount)
 * - Unordered event processing (bridge/claim events can arrive in any sequence)
 * - Enhanced validation: matches require both transaction existence AND depositCount == localRootIndex
 * - Comprehensive metadata decoding for token information (name, symbol, decimals)
 * - Global index decoding for mainnet flag, rollup index, and local root index analysis
 * 
 * Matching Logic:
 * - Bridge events create transfer records with source-side data
 * - Claim events update existing transfers with destination-side data
 * - Strict matching prevents overcounting: requires exact field matches + nonce verification
 * - Orphaned events are preserved for separate analysis
 * 
 * Supported Networks:
 * - Ethereum (Network 0) ↔ Polygon zkEVM (Network 1)
 * - Asset bridging (leafType=0) and message bridging (leafType=1)
 */

/**
 * Agglayer Bridge Event Handler
 * 
 * Processes BridgeEvent from PolygonZkEVMBridgeV2 contract.
 * This event is emitted when assets/messages are sent from one network to another.
 * 
 * Event contains:
 * - leafType: 0 for asset bridging, 1 for message bridging
 * - originNetwork/destinationNetwork: Network IDs (0=Ethereum, 1=Polygon zkEVM)
 * - originAddress: Token contract address on origin network
 * - destinationAddress: Recipient address on destination network
 * - amount: Amount being bridged
 * - metadata: ABI-encoded token info (name, symbol, decimals)
 * - depositCount: Sequential nonce for this origin network
 */
PolygonZkEVMBridgeV2.BridgeEvent.handler(async ({ event, context }) => {
  const timestamp = BigInt(event.block.timestamp);
  
  // Create deterministic ID using all matching fields
  // Including depositCount ensures uniqueness for identical transfers
  const transferId = createAgglayerTransferId(
    event.params.originNetwork,
    event.params.originAddress,
    event.params.destinationAddress,
    event.params.amount,
    event.params.depositCount
  );
  
  // Check for existing transfer (claim event may have been processed first)
  const existingTransfer = await context.AgglayerTransfer.get(transferId);
  
  const transfer = createAgglayerTransfer({
    id: transferId,
    assetOriginNetwork: event.params.originNetwork,
    assetDestinationNetwork: event.params.destinationNetwork,
    assetOriginAddress: event.params.originAddress,
    destinationAddress: event.params.destinationAddress,
    amount: event.params.amount,
    chainId: event.chainId,
    timestamp,
    txHash: event.transaction.hash,
    eventType: 'bridge',
    prev: existingTransfer,
    leafType: event.params.leafType,
    metadata: event.params.metadata,
    depositCount: event.params.depositCount,
  });
  
  context.AgglayerTransfer.set(transfer);
  
  // Enhanced raw event log
  context.PolygonZkEVMBridgeV2_BridgeEvent.set({
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    ...event.params,
    chainId: BigInt(event.chainId),
    blockNumber: BigInt(event.block.number),
    blockTimestamp: timestamp,
    txHash: event.transaction.hash,
  } as PolygonZkEVMBridgeV2_BridgeEvent);
});

/**
 * Agglayer Claim Event Handler
 * 
 * Processes ClaimEvent from PolygonZkEVMBridgeV2 contract.
 * This event is emitted when assets/messages are claimed on the destination network.
 * 
 * Event contains:
 * - globalIndex: Encoded index containing mainnet flag, rollup index, and local root index
 * - originNetwork: Network where the asset originated (0=Ethereum, 1=Polygon zkEVM)  
 * - originAddress: Token contract address on origin network
 * - destinationAddress: Recipient address on destination network
 * - amount: Amount being claimed
 * 
 * Key insight: localRootIndex from globalIndex equals depositCount from BridgeEvent
 * This enables deterministic matching between bridge and claim events.
 */
PolygonZkEVMBridgeV2.ClaimEvent.handler(async ({ event, context }) => {
  const timestamp = BigInt(event.block.timestamp);
  
  // Decode globalIndex to extract mainnet flag, rollup index, and local root index
  const globalIndexDecoded = decodeGlobalIndex(event.params.globalIndex);
  
  // Use localRootIndex as depositCount for matching with BridgeEvent
  // This is the key insight that enables robust event matching
  const depositCount = globalIndexDecoded.localRootIndex;
  
  // Create identical ID as BridgeEvent for matching
  const transferId = createAgglayerTransferId(
    event.params.originNetwork,
    event.params.originAddress,
    event.params.destinationAddress,
    event.params.amount,
    depositCount
  );
  
  // Check for existing transfer (bridge event may have been processed first)
  const existingTransfer = await context.AgglayerTransfer.get(transferId);
  
  const transfer = createAgglayerTransfer({
    id: transferId,
    assetOriginNetwork: event.params.originNetwork,
    assetDestinationNetwork: existingTransfer?.assetDestinationNetwork, // May not be in claim event
    assetOriginAddress: event.params.originAddress,
    destinationAddress: event.params.destinationAddress,
    amount: event.params.amount,
    chainId: event.chainId,
    timestamp,
    txHash: event.transaction.hash,
    eventType: 'claim',
    prev: existingTransfer,
    globalIndex: event.params.globalIndex,
    mainnetFlag: globalIndexDecoded.mainnetFlag,
    rollupIndex: globalIndexDecoded.rollupIndex,
    localRootIndex: globalIndexDecoded.localRootIndex,
  });
  
  context.AgglayerTransfer.set(transfer);
  
  // Enhanced raw event log
  context.PolygonZkEVMBridgeV2_ClaimEvent.set({
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    ...event.params,
    chainId: BigInt(event.chainId),
    blockNumber: BigInt(event.block.number),
    blockTimestamp: timestamp,
    txHash: event.transaction.hash,
  } as PolygonZkEVMBridgeV2_ClaimEvent);
});