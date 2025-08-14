import { StargatePool, TokenMessaging } from "generated";
import { ZERO_GUID, calculateLayerZeroGUID, getEidForChain, unpadAddress } from "../../core/utils";

// Taxi mode: guid != 0
function taxiPayloadId(guid: string) {
  return `lz:${guid}-0`;
}

// Bus mode: stable id per ticket per source chain
function busPayloadId(srcChainId: number, ticketId: bigint) {
  return `sg-bus:${srcChainId}:${ticketId}`;
}

async function upsertPayloadOutboundTaxi(context: any, guid: string, event: any) {
  const pid = taxiPayloadId(guid);
  const existing = await context.AppPayload.get(pid);
  const entity = {
    id: pid,
    app: 'StargateV2',
    payloadType: 'transfer',
    transportingProtocol: 'layerzero',
    transportingMessageId: guid,
    crosschainMessage_id: `layerzero:${guid}`,
    outboundAssetAddress: undefined,
    outboundAmount: event.params.amountSentLD,
    outboundSender: unpadAddress(event.params.fromAddress),
    outboundTargetAddress: event.srcAddress,
    outboundRaw: undefined,
    inboundAssetAddress: existing?.inboundAssetAddress,
    inboundAmount: existing?.inboundAmount,
    inboundRecipient: existing?.inboundRecipient,
    inboundRaw: existing?.inboundRaw,
    matched: Boolean(existing?.inboundAmount),
  };
  await context.AppPayload.set(entity);
}

async function upsertPayloadInboundTaxi(context: any, guid: string, event: any) {
  const pid = taxiPayloadId(guid);
  const existing = await context.AppPayload.get(pid);
  const entity = {
    id: pid,
    app: 'StargateV2',
    payloadType: 'transfer',
    transportingProtocol: 'layerzero',
    transportingMessageId: guid,
    crosschainMessage_id: `layerzero:${guid}`,
    outboundAssetAddress: existing?.outboundAssetAddress,
    outboundAmount: existing?.outboundAmount,
    outboundSender: existing?.outboundSender,
    outboundTargetAddress: existing?.outboundTargetAddress,
    outboundRaw: existing?.outboundRaw,
    inboundAssetAddress: undefined,
    inboundAmount: event.params.amountReceivedLD,
    inboundRecipient: unpadAddress(event.params.toAddress),
    inboundRaw: undefined,
    matched: Boolean(existing?.outboundAmount),
  };
  await context.AppPayload.set(entity);
}

// Bus: BusRode (outbound passenger creation)
TokenMessaging.BusRode.handler(async ({ event, context }) => {
  // Create or update per-ticket payload; guid unknown yet
  const pid = busPayloadId(event.chainId, event.params.ticketId);
  const existing = await context.AppPayload.get(pid);
  // Decode minimal passenger fields from packed bytes: assetId/receiver/amountSD/nativeDrop are protocol-level; here we only store recipient as best-effort
  const entity = {
    id: pid,
    app: 'StargateV2',
    payloadType: 'busPassenger',
    transportingProtocol: 'layerzero',
    transportingMessageId: undefined,
    crosschainMessage_id: undefined,
    outboundAssetAddress: undefined,
    outboundAmount: event.params.fare, // fare represents amount in LD for the passenger
    outboundSender: undefined,
    outboundTargetAddress: event.srcAddress,
    outboundRaw: event.params.passenger,
    inboundAssetAddress: existing?.inboundAssetAddress,
    inboundAmount: existing?.inboundAmount,
    inboundRecipient: existing?.inboundRecipient,
    inboundRaw: existing?.inboundRaw,
    matched: Boolean(existing?.inboundAmount),
  };
  await context.AppPayload.set(entity);
});

// Bus: BusDriven (source chain) provides dstEid, startTicketId, numPassengers, guid
TokenMessaging.BusDriven.handler(async ({ event, context }) => {
  const guid = event.params.guid;
  const id = `layerzero:${guid}`;

  // Create/Update BusIndex
  const index = {
    id,
    srcChainId: BigInt(event.chainId),
    ticketStart: event.params.startTicketId,
    numPassengers: event.params.numPassengers,
    nextInboundOrdinal: BigInt((await context.BusIndex.get(id))?.nextInboundOrdinal ?? 0n),
  };
  context.BusIndex.set(index);

  // Link all known passengers to the envelope id (may not exist yet if PacketSent not seen)
  for (let i = 0n; i < event.params.numPassengers; i++) {
    const ticketId = event.params.startTicketId + i;
    const pid = busPayloadId(event.chainId, ticketId);
    const payload = await context.AppPayload.get(pid);
    if (payload) {
      context.AppPayload.set({
        ...payload,
        transportingProtocol: 'layerzero',
        transportingMessageId: guid,
        crosschainMessage_id: id,
      });
    }
  }

  // Try to consume any buffered inbound entries
  const headId = id;
  let head = await context.InboundBufferHead.get(headId);
  if (!head) return; // nothing buffered yet
  let assigned = head.assignedSeq;
  while (assigned < head.nextSeq && index.nextInboundOrdinal < index.numPassengers) {
    const entryId = `${id}:${assigned}`;
    const entry = await context.InboundBufferEntry.get(entryId);
    if (!entry) break;
    const ord = index.nextInboundOrdinal;
    const ticketId = index.ticketStart + ord;
    const pid = busPayloadId(Number(index.srcChainId), ticketId);
    const payload = await context.AppPayload.get(pid);
    if (payload) {
      context.AppPayload.set({
        ...payload,
        transportingProtocol: 'layerzero',
        transportingMessageId: guid,
        crosschainMessage_id: id,
        inboundAmount: entry.amount,
        inboundRecipient: entry.toAddress,
        matched: Boolean(payload.outboundAmount),
      });
    }
    assigned = assigned + 1n;
    index.nextInboundOrdinal = index.nextInboundOrdinal + 1n;
  }
  context.InboundBufferHead.set({ id: headId, nextSeq: head.nextSeq, assignedSeq: assigned });
  context.BusIndex.set(index);
});

// Taxi outbound
StargatePool.OFTSent.handler(async ({ event, context }) => {
  const guid = event.params.guid;
  if (guid === ZERO_GUID) return; // bus mode handled via BusRode
  await upsertPayloadOutboundTaxi(context, guid, event);
});

// Both taxi and bus inbound; bus uses buffering and index to map
StargatePool.OFTReceived.handler(async ({ event, context }) => {
  const guid = event.params.guid;
  // sekuba: so far i have only seen 0x0 guids in OFTSent in the wild
  if (guid !== ZERO_GUID) {
    // Taxi or already-known bus GUID
    const index = await context.BusIndex.get(`layerzero:${guid}`);
    if (!index) {
      // Taxi
      await upsertPayloadInboundTaxi(context, guid, event);
      return;
    }
    // Bus: try to assign by index; also buffer
    const headId = `layerzero:${guid}`;
    let head = await context.InboundBufferHead.get(headId);
    if (!head) head = { id: headId, nextSeq: 0n, assignedSeq: 0n };
    const seq = head.nextSeq;
    const entryId = `${headId}:${seq}`;
    context.InboundBufferEntry.set({
      id: entryId,
      guid,
      seq,
      chainId: BigInt(event.chainId),
      toAddress: unpadAddress(event.params.toAddress) ?? event.params.toAddress,
      amount: event.params.amountReceivedLD,
      txHash: event.transaction.hash,
    });
    const updatedHead = { id: head.id, nextSeq: head.nextSeq + 1n, assignedSeq: head.assignedSeq };
    context.InboundBufferHead.set(updatedHead);

    // Attempt immediate assignment if possible
    let assigned = updatedHead.assignedSeq;
    const indexNow = await context.BusIndex.get(`layerzero:${guid}`);
    if (!indexNow) return;
    let nextSeqCurrent = updatedHead.nextSeq;
    let nextInboundOrdinal = indexNow.nextInboundOrdinal;
    while (assigned < nextSeqCurrent && nextInboundOrdinal < indexNow.numPassengers) {
      const consumeId = `${headId}:${assigned}`;
      const entry = await context.InboundBufferEntry.get(consumeId);
      if (!entry) break;
      const ord = nextInboundOrdinal;
      const ticketId = indexNow.ticketStart + ord;
      const pid = busPayloadId(Number(indexNow.srcChainId), ticketId);
      const payload = await context.AppPayload.get(pid);
      if (payload) {
        context.AppPayload.set({
          ...payload,
          transportingProtocol: 'layerzero',
          transportingMessageId: guid,
          crosschainMessage_id: `layerzero:${guid}`,
          inboundAmount: entry.amount,
          inboundRecipient: entry.toAddress,
          matched: Boolean(payload.outboundAmount),
        });
      }
      assigned = assigned + 1n;
      nextInboundOrdinal = nextInboundOrdinal + 1n;
    }
    context.InboundBufferHead.set({ id: headId, nextSeq: nextSeqCurrent, assignedSeq: assigned });
    context.BusIndex.set({ id: indexNow.id, srcChainId: indexNow.srcChainId, ticketStart: indexNow.ticketStart, numPassengers: indexNow.numPassengers, nextInboundOrdinal });
    return;
  }
});
