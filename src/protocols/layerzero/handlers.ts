import { EndpointV2 } from "generated";
import { calculateLayerZeroGUID, getEidForChain, getSlugForEid, unpadAddress } from "../../core/utils";

// Decode PacketSent payload header per LZ V2 format
function decodeLayerZeroPacket(encodedPayload: string) {
  const payload = encodedPayload.startsWith('0x') ? encodedPayload : '0x' + encodedPayload;
  if (payload.length < 164) throw new Error(`LZ payload too short: ${payload.length}`);
  const version = parseInt(payload.slice(2, 4), 16);
  const nonce = BigInt('0x' + payload.slice(4, 20));
  const srcEid = parseInt(payload.slice(20, 28), 16);
  const sender = '0x' + payload.slice(28, 92);
  const dstEid = parseInt(payload.slice(92, 100), 16);
  const receiver = '0x' + payload.slice(100, 164);
  const appPayload = '0x' + payload.slice(164);
  const guid = calculateLayerZeroGUID(nonce, srcEid, sender, dstEid, receiver);
  return {
    version,
    nonce,
    srcEid,
    sender: unpadAddress(sender)!,
    dstEid,
    receiver: unpadAddress(receiver)!,
    payload: appPayload,
    guid,
  };
}

async function upsertEnvelopeOutbound(context: any, guid: string, meta: any, from: string, route?: { srcEid?: number, dstEid?: number }) {
  const id = `layerzero:${guid}`;
  const existing = await context.CrosschainMessage.get(id);
  const routeSrcEid = route?.srcEid !== undefined ? BigInt(route.srcEid) : existing?.routeSrcEid;
  const routeDstEid = route?.dstEid !== undefined ? BigInt(route.dstEid) : existing?.routeDstEid;
  const routeSrcSlug = routeSrcEid !== undefined ? getSlugForEid(routeSrcEid) : existing?.routeSrcSlug;
  const routeDstSlug = routeDstEid !== undefined ? getSlugForEid(routeDstEid) : existing?.routeDstSlug;
  const entity = {
    id,
    transport: 'layerzero',
    messageKey: guid,
    outboundBlock: BigInt(meta.block.number),
    outboundTimestamp: BigInt(meta.block.timestamp),
    outboundTxHash: meta.transaction.hash,
    outboundChainId: BigInt(meta.chainId),
    outboundFrom: unpadAddress(from),
    inboundBlock: existing?.inboundBlock,
    inboundTimestamp: existing?.inboundTimestamp,
    inboundTxHash: existing?.inboundTxHash,
    inboundChainId: existing?.inboundChainId,
    inboundTo: existing?.inboundTo,
    matched: Boolean(existing?.inboundBlock),
    latency: existing?.inboundTimestamp && BigInt(meta.block.timestamp) ? (existing.inboundTimestamp - BigInt(meta.block.timestamp)) : undefined,
    routeSrcEid,
    routeDstEid,
    routeSrcSlug,
    routeDstSlug,
  };
  await context.CrosschainMessage.set(entity);
}

async function upsertEnvelopeInbound(context: any, guid: string, meta: any, to: string, route?: { srcEid?: number, dstEid?: number }) {
  const id = `layerzero:${guid}`;
  const existing = await context.CrosschainMessage.get(id);
  const routeSrcEid = route?.srcEid !== undefined ? BigInt(route.srcEid) : existing?.routeSrcEid;
  const routeDstEid = route?.dstEid !== undefined ? BigInt(route.dstEid) : existing?.routeDstEid;
  const routeSrcSlug = routeSrcEid !== undefined ? getSlugForEid(routeSrcEid) : existing?.routeSrcSlug;
  const routeDstSlug = routeDstEid !== undefined ? getSlugForEid(routeDstEid) : existing?.routeDstSlug;
  const entity = {
    id,
    transport: 'layerzero',
    messageKey: guid,
    outboundBlock: existing?.outboundBlock,
    outboundTimestamp: existing?.outboundTimestamp,
    outboundTxHash: existing?.outboundTxHash,
    outboundChainId: existing?.outboundChainId,
    outboundFrom: existing?.outboundFrom,
    inboundBlock: BigInt(meta.block.number),
    inboundTimestamp: BigInt(meta.block.timestamp),
    inboundTxHash: meta.transaction.hash,
    inboundChainId: BigInt(meta.chainId),
    inboundTo: unpadAddress(to),
    matched: Boolean(existing?.outboundBlock),
    latency: existing?.outboundTimestamp && BigInt(meta.block.timestamp) ? (BigInt(meta.block.timestamp) - existing.outboundTimestamp) : undefined,
    routeSrcEid,
    routeDstEid,
    routeSrcSlug,
    routeDstSlug,
  };
  await context.CrosschainMessage.set(entity);
}

EndpointV2.PacketSent.handler(async ({ event, context }) => {
  try {
    const packet = decodeLayerZeroPacket(event.params.encodedPayload);
    await upsertEnvelopeOutbound(context, packet.guid, event, packet.sender, { srcEid: packet.srcEid, dstEid: packet.dstEid });
  } catch (e) {
    console.error('PacketSent handler error', e);
  }
});

EndpointV2.PacketDelivered.handler(async ({ event, context }) => {
  try {
    const dstEid = getEidForChain(event.chainId);
    const guid = calculateLayerZeroGUID(
      event.params.origin[2], // nonce
      Number(event.params.origin[0]), // srcEid
      event.params.origin[1], // sender
      dstEid, // dest EID
      event.params.receiver
    );
    await upsertEnvelopeInbound(context, guid, event, event.params.receiver, { srcEid: Number(event.params.origin[0]), dstEid });
  } catch (e) {
    console.error('PacketDelivered handler error', e);
  }
});
