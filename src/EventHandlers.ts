import {
  MessageTransmitter,
  TokenMessenger,
  CCTPTransfer,
  TokenMessenger_DepositForBurn,
  MessageTransmitter_MessageReceived,
} from "generated";

/* ---------- helpers ---------- */

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

const idFor = (domain: bigint, nonce: bigint) => `${domain}_${nonce}` as const;

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
    nonce: event.params.nonce,

    /* source-side data */
    amount: event.params.amount,
    burnToken: event.params.burnToken,
    depositor: event.params.depositor,
    mintRecipient: event.params.mintRecipient,
    sourceTxHash: event.transaction.hash,
    depositBlock: BigInt(event.block.number),
    depositTimestamp: depositTs,

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
    nonce: event.params.nonce,

    /* keep whatever we got from the source side */
    amount: prev?.amount,
    burnToken: prev?.burnToken,
    depositor: prev?.depositor,
    mintRecipient: prev?.mintRecipient,
    sourceTxHash: prev?.sourceTxHash,
    depositBlock: prev?.depositBlock,
    depositTimestamp: depositTs,

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
