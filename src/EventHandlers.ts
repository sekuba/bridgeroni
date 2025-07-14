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

/* ---------- helpers ---------- */

/*
 * IMPORTANT: CCTPv1 and CCTPv2 are NOT interchangeable!
 * - v1 and v2 events cannot be matched together
 * - Metrics like volume and latency should be calculated separately per version
 * - Raw events and matched transfers can be displayed together in feeds
 * - Some chains (Linea, World Chain) only support v2
 */

/*
 * Decode CCTP v2 message body according to the format:
 * version (4 bytes) + burnToken (32 bytes) + mintRecipient (32 bytes) + 
 * amount (32 bytes) + messageSender (32 bytes) + maxFee (32 bytes) + 
 * feeExecuted (32 bytes) + expirationBlock (32 bytes) + hookData (dynamic)
 */
function decodeV2MessageBody(messageBody: string): {
  version: number;
  burnToken: string;
  mintRecipient: string;
  amount: bigint;
  messageSender: string;
  maxFee: bigint;
  feeExecuted: bigint;
  expirationBlock: bigint;
  hookData: string;
} | null {
  try {
    // Remove 0x prefix if present
    const hex = messageBody.startsWith('0x') ? messageBody.slice(2) : messageBody;
    
    // Validate minimum length (228 bytes = 456 hex chars for fixed fields)
    if (hex.length < 456) return null;
    
    let offset = 0;
    
    // Parse version (4 bytes)
    const version = parseInt(hex.slice(offset, offset + 8), 16);
    offset += 8;
    
    // Parse burnToken (32 bytes)
    const burnToken = '0x' + hex.slice(offset, offset + 64);
    offset += 64;
    
    // Parse mintRecipient (32 bytes)
    const mintRecipient = '0x' + hex.slice(offset, offset + 64);
    offset += 64;
    
    // Parse amount (32 bytes)
    const amount = BigInt('0x' + hex.slice(offset, offset + 64));
    offset += 64;
    
    // Parse messageSender (32 bytes)
    const messageSender = '0x' + hex.slice(offset, offset + 64);
    offset += 64;
    
    // Parse maxFee (32 bytes)
    const maxFee = BigInt('0x' + hex.slice(offset, offset + 64));
    offset += 64;
    
    // Parse feeExecuted (32 bytes)
    const feeExecuted = BigInt('0x' + hex.slice(offset, offset + 64));
    offset += 64;
    
    // Parse expirationBlock (32 bytes)
    const expirationBlock = BigInt('0x' + hex.slice(offset, offset + 64));
    offset += 64;
    
    // Remaining bytes are hookData
    const hookData = hex.length > offset ? '0x' + hex.slice(offset) : '0x';
    
    return {
      version,
      burnToken,
      mintRecipient,
      amount,
      messageSender,
      maxFee,
      feeExecuted,
      expirationBlock,
      hookData
    };
  } catch (error) {
    console.error('Failed to decode message body:', error);
    return null;
  }
}

/*
 * Compute deterministic nonce for CCTP v2 using source and destination event data
 * Uses keccak256 hash of key message components for consistent matching
 */
function computeV2DeterministicNonce(
  sourceDomain: bigint,
  destinationDomain: bigint,
  burnToken: string,
  mintRecipient: string,
  amount: bigint,
  messageSender: string,
  maxFee: bigint,
  hookData: string
): string {
  try {
    // Normalize all inputs to consistent format
    const sourceDomainHex = sourceDomain.toString(16).padStart(8, '0');
    const destinationDomainHex = destinationDomain.toString(16).padStart(8, '0');
    const burnTokenHex = burnToken.slice(2).padStart(64, '0');
    const mintRecipientHex = mintRecipient.slice(2).padStart(64, '0');
    const amountHex = amount.toString(16).padStart(64, '0');
    const messageSenderHex = messageSender.slice(2).padStart(64, '0');
    const maxFeeHex = maxFee.toString(16).padStart(64, '0');
    const hookDataHex = hookData.startsWith('0x') ? hookData.slice(2) : hookData;
    
    // Concatenate all components for consistent hashing
    const concatenated = 
      sourceDomainHex +
      destinationDomainHex +
      burnTokenHex +
      mintRecipientHex +
      amountHex +
      messageSenderHex +
      maxFeeHex +
      hookDataHex;
    
    // Use built-in crypto for hashing (Node.js built-in)
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(concatenated, 'hex').digest('hex');
    
    return '0x' + hash;
  } catch (error) {
    console.error('Failed to compute deterministic nonce:', error);
    // Fallback to timestamp-based nonce if computation fails
    return '0x' + Date.now().toString(16).padStart(64, '0');
  }
}

const DOMAIN_BY_CHAIN_ID: Record<number, bigint> = {
  1: 0n,        // Ethereum
  43114: 1n,    // Avalanche
  10: 2n,       // OP
  42161: 3n,    // Arbitrum
  1151111081099710: 4n,  // Noble
  // 5: Solana (not EVM)
  8453: 6n,     // Base
  137: 7n,      // Polygon
  // 8: Sui (not EVM)
  // 9: Aptos (not EVM)  
  130: 10n,    // Unichain
  59144: 11n,   // Linea
  // 12: Codex (placeholder)
  // 13: Sonic (placeholder)
  480: 14n,     // World Chain
};

const idFor = (domain: bigint, nonce: bigint | string) => `${domain}_${nonce}` as const;

/* ---------- SOURCE side ---------- */

TokenMessenger.DepositForBurn.handler(async ({ event, context }) => {
  const srcDomain = DOMAIN_BY_CHAIN_ID[event.chainId];
  if (srcDomain === undefined) return;                // ignore chains we didn’t map

  const id = idFor(srcDomain, event.params.nonce);
  const prev = await context.CCTPTransfer.get(id);

  const depositTs      = BigInt(event.block.timestamp);
  const messageTs      = prev?.messageReceivedTimestamp;
  const matched        = !!(prev?.destinationTxHash);

  const transfer: CCTPTransfer = {
    /* identifiers */
    id,
    sourceDomain: srcDomain,
    destinationDomain: event.params.destinationDomain,
    nonce: event.params.nonce.toString(),

    /* source-side data */
    amount: event.params.amount,
    burnToken: event.params.burnToken,
    depositor: event.params.depositor,
    mintRecipient: event.params.mintRecipient,
    sourceTxHash: event.transaction.hash,
    depositBlock: BigInt(event.block.number),
    depositTimestamp: depositTs,

    /* CCTPv2 specific fields */
    maxFee: prev?.maxFee,
    minFinalityThreshold: prev?.minFinalityThreshold,
    hookData: prev?.hookData,
    finalityThresholdExecuted: prev?.finalityThresholdExecuted,

    /* keep any destination-side we already had */
    destinationTxHash: prev?.destinationTxHash,
    messageReceivedBlock: prev?.messageReceivedBlock,
    messageReceivedTimestamp: messageTs,

    /* derived */
    matched,
    latencySeconds: matched && messageTs ? messageTs - depositTs : undefined,

    /* computed fields for TUI efficiency */
    hasAmount: true,  // deposit events always have amount
    sourceChainId: BigInt(event.chainId),
    destinationChainId: prev?.destinationChainId,
    eventType: matched ? "matched" : "deposit",
    lastUpdated: depositTs,
    version: "v1",
  };

  context.CCTPTransfer.set(transfer);

  /* enhanced raw event log */
  context.TokenMessenger_DepositForBurn.set({
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    ...event.params,
    chainId: BigInt(event.chainId),
    blockNumber: BigInt(event.block.number),
    blockTimestamp: depositTs,
    txHash: event.transaction.hash,
  } as TokenMessenger_DepositForBurn);
});

/* ---------- DESTINATION side ---------- */

MessageTransmitter.MessageReceived.handler(async ({ event, context }) => {
  const id = idFor(event.params.sourceDomain, event.params.nonce);
  const prev = await context.CCTPTransfer.get(id);

  const messageTs = BigInt(event.block.timestamp);
  const depositTs = prev?.depositTimestamp;
  const matched   = !!(prev?.sourceTxHash);

  const transfer: CCTPTransfer = {
    /* identifiers */
    id,
    sourceDomain: event.params.sourceDomain,
    destinationDomain: DOMAIN_BY_CHAIN_ID[event.chainId] ?? null,
    nonce: event.params.nonce.toString(),

    /* keep whatever we got from the source side */
    amount: prev?.amount,
    burnToken: prev?.burnToken,
    depositor: prev?.depositor,
    mintRecipient: prev?.mintRecipient,
    sourceTxHash: prev?.sourceTxHash,
    depositBlock: prev?.depositBlock,
    depositTimestamp: depositTs,

    /* CCTPv2 specific fields */
    maxFee: prev?.maxFee,
    minFinalityThreshold: prev?.minFinalityThreshold,
    hookData: prev?.hookData,
    finalityThresholdExecuted: prev?.finalityThresholdExecuted,

    /* destination-side data */
    destinationTxHash: event.transaction.hash,
    messageReceivedBlock: BigInt(event.block.number),
    messageReceivedTimestamp: messageTs,

    /* derived */
    matched,
    latencySeconds: matched && depositTs ? messageTs - depositTs : undefined,

    /* computed fields for TUI efficiency */
    hasAmount: !!(prev?.amount),  // only true if we have amount from deposit
    sourceChainId: prev?.sourceChainId,
    destinationChainId: BigInt(event.chainId),
    eventType: matched ? "matched" : "received",
    lastUpdated: messageTs,
    version: prev?.version || "v1",
  };

  context.CCTPTransfer.set(transfer);

  /* enhanced raw event log */
  context.MessageTransmitter_MessageReceived.set({
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    ...event.params,
    chainId: BigInt(event.chainId),
    blockNumber: BigInt(event.block.number),
    blockTimestamp: messageTs,
    txHash: event.transaction.hash,
  } as MessageTransmitter_MessageReceived);
});

/* ---------- CCTPv2 SOURCE side ---------- */

TokenMessengerV2.DepositForBurn.handler(async ({ event, context }) => {
  const srcDomain = DOMAIN_BY_CHAIN_ID[event.chainId];
  if (srcDomain === undefined) return;                // ignore chains we didn't map

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

  // Use the computed nonce as the ID for matching
  const id = idFor(srcDomain, computedNonce);
  const prev = await context.CCTPTransfer.get(id);
  
  const depositTs = BigInt(event.block.timestamp);
  const messageTs = prev?.messageReceivedTimestamp;
  const matched = !!(prev?.destinationTxHash);

  const transfer: CCTPTransfer = {
    /* identifiers */
    id,
    sourceDomain: srcDomain,
    destinationDomain: event.params.destinationDomain,
    nonce: computedNonce,

    /* source-side data */
    amount: event.params.amount,
    burnToken: event.params.burnToken,
    depositor: event.params.depositor,
    mintRecipient: event.params.mintRecipient,
    sourceTxHash: event.transaction.hash,
    depositBlock: BigInt(event.block.number),
    depositTimestamp: depositTs,

    /* CCTPv2 specific fields */
    maxFee: event.params.maxFee,
    minFinalityThreshold: event.params.minFinalityThreshold,
    hookData: event.params.hookData,
    finalityThresholdExecuted: prev?.finalityThresholdExecuted,

    /* keep any destination-side data we already had */
    destinationTxHash: prev?.destinationTxHash,
    messageReceivedBlock: prev?.messageReceivedBlock,
    messageReceivedTimestamp: messageTs,

    /* derived */
    matched,
    latencySeconds: matched && messageTs ? messageTs - depositTs : undefined,

    /* computed fields for TUI efficiency */
    hasAmount: true,  // deposit events always have amount
    sourceChainId: BigInt(event.chainId),
    destinationChainId: prev?.destinationChainId,
    eventType: matched ? "matched" : "deposit",
    lastUpdated: depositTs,
    version: "v2",
  };

  context.CCTPTransfer.set(transfer);

  /* enhanced raw event log */
  context.TokenMessenger_DepositForBurnV2.set({
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    ...event.params,
    chainId: BigInt(event.chainId),
    blockNumber: BigInt(event.block.number),
    blockTimestamp: depositTs,
    txHash: event.transaction.hash,
  } as TokenMessenger_DepositForBurnV2);
});

/* ---------- CCTPv2 DESTINATION side ---------- */

MessageTransmitterV2.MessageReceived.handler(async ({ event, context }) => {
  const destDomain = DOMAIN_BY_CHAIN_ID[event.chainId];
  if (destDomain === undefined) return;

  const messageTs = BigInt(event.block.timestamp);
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
  
  // Use the computed nonce to find existing deposit
  const id = idFor(sourceDomain, computedNonce);
  const prev = await context.CCTPTransfer.get(id);
  
  const depositTs = prev?.depositTimestamp;
  const matched = !!(prev?.sourceTxHash);

  const transfer: CCTPTransfer = {
    /* identifiers */
    id,
    sourceDomain: sourceDomain,
    destinationDomain: destDomain,
    nonce: computedNonce,

    /* use decoded message data if source side data is not available */
    amount: prev?.amount || decodedMessage.amount,
    burnToken: prev?.burnToken || decodedMessage.burnToken,
    depositor: prev?.depositor || decodedMessage.messageSender,
    mintRecipient: prev?.mintRecipient || decodedMessage.mintRecipient,
    sourceTxHash: prev?.sourceTxHash,
    depositBlock: prev?.depositBlock,
    depositTimestamp: depositTs,

    /* CCTPv2 specific fields */
    maxFee: prev?.maxFee || decodedMessage.maxFee,
    minFinalityThreshold: prev?.minFinalityThreshold,
    hookData: prev?.hookData || decodedMessage.hookData,
    finalityThresholdExecuted: event.params.finalityThresholdExecuted,

    /* destination-side data */
    destinationTxHash: event.transaction.hash,
    messageReceivedBlock: BigInt(event.block.number),
    messageReceivedTimestamp: messageTs,

    /* derived */
    matched,
    latencySeconds: matched && depositTs ? messageTs - depositTs : undefined,

    /* computed fields for TUI efficiency */
    hasAmount: !!(prev?.amount || decodedMessage.amount),
    sourceChainId: prev?.sourceChainId,
    destinationChainId: BigInt(event.chainId),
    eventType: matched ? "matched" : "received",
    lastUpdated: messageTs,
    version: "v2",
  };

  context.CCTPTransfer.set(transfer);

  /* enhanced raw event log */
  context.MessageTransmitter_MessageReceivedV2.set({
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    ...event.params,
    chainId: BigInt(event.chainId),
    blockNumber: BigInt(event.block.number),
    blockTimestamp: messageTs,
    txHash: event.transaction.hash,
  } as MessageTransmitter_MessageReceivedV2);
});
