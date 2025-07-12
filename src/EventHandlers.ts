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
  8453: 6n,     // Base
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
  };

  context.CCTPTransfer.set(transfer);

  /* raw log (handy for debugging) */
  context.TokenMessenger_DepositForBurn.set({
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    ...event.params,
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
  };

  context.CCTPTransfer.set(transfer);

  context.MessageTransmitter_MessageReceived.set({
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    ...event.params,
  } as MessageTransmitter_MessageReceived);
});
