/**
 * CCTP Bridge Monitor - Event Handlers
 * 
 * Processes CCTP v1 and v2 events to create matched cross-chain transfers.
 * 
 * Key Features:
 * - v1: Uses nonce-based matching (nonce available in both events)
 * - v2: Uses deterministic nonce computation (nonce only in MessageReceived)
 * - Decodes v2 messageBody to extract transfer details
 * - Maintains separate v1/v2 versioning for metrics
 * 
 * IMPORTANT: v1 and v2 events are NOT interchangeable!
 * - Events from different versions cannot be matched together
 * - Some chains (Linea, World Chain) only support v2
 * - Metrics should be calculated separately per version
 */

import {
  MessageTransmitter,
  TokenMessenger,
  TokenMessengerV2,
  MessageTransmitterV2,
  CCTPTransfer,
  TokenMessenger_DepositForBurn,
  TokenMessenger_DepositForBurnV2,
  MessageTransmitter_MessageReceived,
  MessageTransmitter_MessageReceivedV2,
} from "generated";

import { 
  createTransferId,
  getDomainFromChainId
} from "./constants";

import {
  decodeV2MessageBody,
  computeV2DeterministicNonce
} from "./utils/messageDecoder";

/* ---------- Helper Functions ---------- */

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