import { SpokePool } from "generated";
import { getEidForChain, getSlugForChainId, unpadAddress } from "../../core/utils";

function acrossMessageKeyFromOutbound(chainId: number, depositId: bigint) {
  return `${chainId}-${depositId}`;
}
function acrossMessageKeyFromInbound(originChainId: bigint, depositId: bigint) {
  return `${originChainId}-${depositId}`;
}

async function upsertEnvelopeOutbound(context: any, messageKey: string, event: any, from: string) {
  const id = `across:${messageKey}`;
  const existing = await context.CrosschainMessage.get(id);
  const srcSlug = getSlugForChainId(event.chainId);
  const dstSlug = getSlugForChainId(Number(event.params?.destinationChainId ?? 0));
  let srcEid: bigint | undefined = undefined;
  let dstEid: bigint | undefined = undefined;
  try { srcEid = BigInt(getEidForChain(event.chainId)); } catch {}
  try { if (event.params?.destinationChainId) dstEid = BigInt(getEidForChain(Number(event.params.destinationChainId))); } catch {}
  const entity = {
    id,
    transport: 'across',
    messageKey,
    outboundBlock: BigInt(event.block.number),
    outboundTimestamp: BigInt(event.block.timestamp),
    outboundTxHash: event.transaction.hash,
    outboundChainId: BigInt(event.chainId),
    outboundFrom: unpadAddress(from),
    inboundBlock: existing?.inboundBlock,
    inboundTimestamp: existing?.inboundTimestamp,
    inboundTxHash: existing?.inboundTxHash,
    inboundChainId: existing?.inboundChainId,
    inboundTo: existing?.inboundTo,
    matched: Boolean(existing?.inboundBlock),
    latency: existing?.inboundTimestamp && BigInt(event.block.timestamp) ? (existing.inboundTimestamp - BigInt(event.block.timestamp)) : undefined,
    routeSrcSlug: srcSlug ?? existing?.routeSrcSlug,
    routeDstSlug: dstSlug ?? existing?.routeDstSlug,
    routeSrcEid: srcEid ?? existing?.routeSrcEid,
    routeDstEid: dstEid ?? existing?.routeDstEid,
  };
  await context.CrosschainMessage.set(entity);
}

async function upsertEnvelopeInbound(context: any, messageKey: string, event: any, to: string) {
  const id = `across:${messageKey}`;
  const existing = await context.CrosschainMessage.get(id);
  const dstSlug = getSlugForChainId(event.chainId);
  const srcSlug = getSlugForChainId(Number(event.params?.originChainId ?? 0));
  let srcEid: bigint | undefined = existing?.routeSrcEid;
  let dstEid: bigint | undefined = existing?.routeDstEid;
  try { if (!dstEid) dstEid = BigInt(getEidForChain(event.chainId)); } catch {}
  try { if (!srcEid && event.params?.originChainId) srcEid = BigInt(getEidForChain(Number(event.params.originChainId))); } catch {}
  const entity = {
    id,
    transport: 'across',
    messageKey,
    outboundBlock: existing?.outboundBlock,
    outboundTimestamp: existing?.outboundTimestamp,
    outboundTxHash: existing?.outboundTxHash,
    outboundChainId: existing?.outboundChainId,
    outboundFrom: existing?.outboundFrom,
    inboundBlock: BigInt(event.block.number),
    inboundTimestamp: BigInt(event.block.timestamp),
    inboundTxHash: event.transaction.hash,
    inboundChainId: BigInt(event.chainId),
    inboundTo: unpadAddress(to),
    matched: Boolean(existing?.outboundBlock),
    latency: existing?.outboundTimestamp && BigInt(event.block.timestamp) ? (BigInt(event.block.timestamp) - existing.outboundTimestamp) : undefined,
    routeSrcSlug: srcSlug ?? existing?.routeSrcSlug,
    routeDstSlug: dstSlug ?? existing?.routeDstSlug,
    routeSrcEid: srcEid ?? existing?.routeSrcEid,
    routeDstEid: dstEid ?? existing?.routeDstEid,
  };
  await context.CrosschainMessage.set(entity);
}

async function upsertPayloadOutbound(context: any, payloadId: string, messageKey: string, data: {
  assetOut: string,
  amountOut: bigint,
  assetIn: string,
  amountIn: bigint,
  sender: string,
  recipient: string,
  target?: string,
  raw?: string,
}) {
  const existing = await context.AppPayload.get(payloadId);
  const entity = {
    id: payloadId,
    app: 'Across',
    payloadType: 'transfer',
    transportingProtocol: 'across',
    transportingMessageId: messageKey,
    crosschainMessage_id: `across:${messageKey}`,
    outboundAssetAddress: unpadAddress(data.assetIn),
    outboundAmount: data.amountIn,
    outboundSender: unpadAddress(data.sender),
    outboundTargetAddress: data.target,
    outboundRaw: data.raw,
    inboundAssetAddress: existing?.inboundAssetAddress,
    inboundAmount: existing?.inboundAmount,
    inboundRecipient: existing?.inboundRecipient,
    inboundRaw: existing?.inboundRaw,
    matched: Boolean(existing?.inboundAmount),
  };
  await context.AppPayload.set(entity);
}

async function upsertPayloadInbound(context: any, payloadId: string, messageKey: string, data: {
  assetIn: string,
  amountIn: bigint,
  depositor?: string,
  recipient: string,
  raw?: string,
}) {
  const existing = await context.AppPayload.get(payloadId);
  const entity = {
    id: payloadId,
    app: 'Across',
    payloadType: 'transfer',
    transportingProtocol: 'across',
    transportingMessageId: messageKey,
    crosschainMessage_id: `across:${messageKey}`,
    outboundAssetAddress: existing?.outboundAssetAddress,
    outboundAmount: existing?.outboundAmount,
    outboundSender: existing?.outboundSender,
    outboundTargetAddress: existing?.outboundTargetAddress,
    outboundRaw: existing?.outboundRaw,
    inboundAssetAddress: unpadAddress(data.assetIn),
    inboundAmount: data.amountIn,
    inboundRecipient: unpadAddress(data.recipient),
    inboundRaw: data.raw,
    matched: Boolean(existing?.outboundAmount),
  };
  await context.AppPayload.set(entity);
}

// Outbound: FundsDeposited
SpokePool.FundsDeposited.handler(async ({ event, context }) => {
  const messageKey = acrossMessageKeyFromOutbound(event.chainId, event.params.depositId);
  const payloadId = `across:${messageKey}-0`;
  await upsertEnvelopeOutbound(context, messageKey, event, event.params.depositor);
  await upsertPayloadOutbound(context, payloadId, messageKey, {
    assetOut: event.params.outputToken,
    amountOut: event.params.outputAmount,
    assetIn: event.params.inputToken,
    amountIn: event.params.inputAmount,
    sender: event.params.depositor,
    recipient: event.params.recipient,
    target: event.srcAddress,
    raw: event.params.message,
  });
});

// Inbound: FilledRelay (V2) and FilledV3Relay
SpokePool.FilledRelay.handler(async ({ event, context }) => {
  const messageKey = acrossMessageKeyFromInbound(event.params.originChainId, event.params.depositId);
  const payloadId = `across:${messageKey}-0`;
  await upsertEnvelopeInbound(context, messageKey, event, event.params.recipient);
  await upsertPayloadInbound(context, payloadId, messageKey, {
    assetIn: event.params.outputToken,
    amountIn: event.params.outputAmount,
    depositor: event.params.depositor,
    recipient: event.params.recipient,
  });
});

SpokePool.FilledV3Relay.handler(async ({ event, context }) => {
  const messageKey = acrossMessageKeyFromInbound(event.params.originChainId, event.params.depositId);
  const payloadId = `across:${messageKey}-0`;
  await upsertEnvelopeInbound(context, messageKey, event, event.params.recipient);
  await upsertPayloadInbound(context, payloadId, messageKey, {
    assetIn: event.params.outputToken,
    amountIn: event.params.outputAmount,
    depositor: event.params.depositor,
    recipient: event.params.recipient,
    raw: event.params.message,
  });
});
