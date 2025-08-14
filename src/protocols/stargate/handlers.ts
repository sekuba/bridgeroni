import { StargatePool, TokenMessaging } from "generated";
import { ZERO_GUID, getEidForChain, unpadAddress } from "../../core/utils";

// Helpers
function taxiPayloadId(guid: string) {
  return `lz:${guid}-0`;
}

function busPassengerEntityId(srcEid: number, dstEid: number, ticketId: bigint) {
  return `stargatev2-bus-passenger:${srcEid}:${dstEid}:${ticketId}`;
}

function normalizeHex(input: string): `0x${string}` {
  return (input.startsWith('0x') ? input : (`0x${input}`)) as `0x${string}`;
}

// Decode passenger bytes per encodePacked(uint16, bytes32, uint64, bool)
function decodeBusPassenger(passengerBytes: string) {
  const bytes = normalizeHex(passengerBytes);
  if (bytes.length < 88) throw new Error(`Passenger bytes too short: ${bytes.length}`);
  const assetId = parseInt(bytes.slice(2, 6), 16);
  const receiver = '0x' + bytes.slice(6, 70);
  const amountSD = BigInt('0x' + bytes.slice(70, 86));
  const nativeDrop = parseInt(bytes.slice(86, 88), 16) !== 0;
  return {
    assetId: String(assetId),
    receiver: unpadAddress(receiver) ?? receiver,
    amountSD,
    nativeDrop: nativeDrop ? 'true' : 'false',
  } as const;
}

// No explicit inbound buffer; we use AppPayload as a buffer entity.

// Taxi upserts
async function upsertPayloadOutboundTaxi(context: any, guid: string, event: any) {
  const pid = taxiPayloadId(guid);
  const existing = await context.AppPayload.get(pid);
  const entity = {
    id: pid,
    app: 'StargateV2-taxi',
    payloadType: 'transfer',
    transportingProtocol: 'layerzero',
    transportingMessageId: `layerzero:${guid}`,
    crosschainMessage_id: `layerzero:${guid}`,
    outboundAssetAddress: undefined,
    outboundAmount: event.params.amountSentLD,
    outboundSender: unpadAddress(event.params.fromAddress),
    outboundTargetAddress: undefined,
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
    app: 'StargateV2-taxi',
    payloadType: 'transfer',
    transportingProtocol: 'layerzero',
    transportingMessageId: `layerzero:${guid}`,
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

// Bus: BusRode — create per-passenger pre-OFTSent entity by tx hash
TokenMessaging.BusRode.handler(async ({ event, context }) => {
  const passenger = decodeBusPassenger(event.params.passenger);
  const entity = {
    id: event.transaction.hash,
    dstEid: BigInt(event.params.dstEid),
    ticketId: event.params.ticketId,
    fare: event.params.fare,
    passengerAssetId: passenger.assetId,
    passengerReceiver: passenger.receiver,
    passengerAmountSD: passenger.amountSD,
    passengerNativeDrop: passenger.nativeDrop,
    fromAddress: undefined,
    amountSentLD: undefined,
    amountReceivedLD: undefined,
  };
  await context.BusRodeOftSentLfg.set(entity);
});

// StargatePool.OFTSent — outbound
StargatePool.OFTSent.handler(async ({ event, context }) => {
  const guid = event.params.guid;
  if (guid === ZERO_GUID) {
    // Bus passenger in bus mode — enrich BusRode entity and re-id to stable key
    const preId = event.transaction.hash;
    const pre = await context.BusRodeOftSentLfg.get(preId);
    if (!pre) return; // Should not happen if same-tx ordering holds
    const srcEid = getEidForChain(event.chainId);
    const newId = busPassengerEntityId(srcEid, Number(pre.dstEid), pre.ticketId);
    const updated = {
      id: newId,
      dstEid: pre.dstEid,
      ticketId: pre.ticketId,
      fare: pre.fare,
      passengerAssetId: pre.passengerAssetId,
      passengerReceiver: pre.passengerReceiver,
      passengerAmountSD: pre.passengerAmountSD,
      passengerNativeDrop: pre.passengerNativeDrop,
      fromAddress: unpadAddress(event.params.fromAddress),
      amountSentLD: event.params.amountSentLD,
      amountReceivedLD: event.params.amountReceivedLD,
    };
    await context.BusRodeOftSentLfg.set(updated);
    return;
  }
  // Taxi (non-zero guid)
  await upsertPayloadOutboundTaxi(context, guid, event);
});

// TokenMessaging.BusDriven — use loader to get pre-existing AppPayload buffers (inbound-first)
TokenMessaging.BusDriven.handlerWithLoader({
  loader: async ({ event, context }) => {
    const guid: string = event.params.guid;
    const tmid = `layerzero:${guid}`;
    const payloads = await context.AppPayload.getWhere.transportingMessageId.eq(tmid);
    return { payloads };
  },
  handler: async ({ event, context, loaderReturn }) => {
    const guid: string = event.params.guid;
    const tmid = `layerzero:${guid}`;
    const srcEid = getEidForChain(event.chainId);
    const passengerIds: string[] = [];
    for (let i = 0n; i < event.params.numPassengers; i++) {
      const ticketId = event.params.startTicketId + i;
      passengerIds.push(busPassengerEntityId(srcEid, Number(event.params.dstEid), ticketId));
    }
    const existingForGuid = loaderReturn?.payloads ?? [];
    if (existingForGuid.length > 0) {
      for (const pid of passengerIds) {
        const rode = await context.BusRodeOftSentLfg.get(pid);
        if (!rode) continue;
        const target = rode.passengerReceiver ? unpadAddress(rode.passengerReceiver) : undefined;
        const match = existingForGuid.find((p: any) => p.app === 'StargateV2-bus-passenger' && p.inboundRecipient && target && unpadAddress(p.inboundRecipient) === target);
        if (!match) continue;
        await context.AppPayload.set({
          id: match.id, // keep buffer id
          app: 'StargateV2-bus-passenger',
          payloadType: 'transfer',
          transportingProtocol: 'layerzero',
          transportingMessageId: tmid,
          crosschainMessage_id: tmid,
          outboundAssetAddress: undefined,
          outboundAmount: rode.amountSentLD ?? rode.fare,
          outboundSender: rode.fromAddress ? unpadAddress(rode.fromAddress) : undefined,
          outboundTargetAddress: rode.passengerReceiver ? unpadAddress(rode.passengerReceiver) : undefined,
          outboundRaw: undefined,
          inboundAssetAddress: match.inboundAssetAddress,
          inboundAmount: match.inboundAmount,
          inboundRecipient: match.inboundRecipient ? unpadAddress(match.inboundRecipient) : undefined,
          inboundRaw: match.inboundRaw,
          matched: Boolean((rode.amountSentLD ?? rode.fare) && match.inboundAmount),
        });
      }
    } else {
      await context.BusDrivenOftReceivedLfg.set({ id: guid, passengerIds });
    }
  }
});

// Inbound using loader for getWhere
StargatePool.OFTReceived.handlerWithLoader({
  loader: async ({ event, context }) => {
    const tmid = `layerzero:${event.params.guid}`;
    const payloads = await context.AppPayload.getWhere.transportingMessageId.eq(tmid);
    return { payloads };
  },
  handler: async ({ event, context, loaderReturn }) => {
    const guid = event.params.guid;
    const tmid = `layerzero:${guid}`;
    // First try: taxi by deterministic id
    const taxiId = taxiPayloadId(guid);
    const existingTaxi = await context.AppPayload.get(taxiId);
    if (existingTaxi) {
      await upsertPayloadInboundTaxi(context, guid, event);
      return;
    }
    const byTmid = loaderReturn?.payloads ?? [];
    const taxiPayloads = byTmid.filter((p: any) => p.app === 'StargateV2-taxi');
    if (taxiPayloads.length > 0) {
      for (const _ of taxiPayloads) {
        await upsertPayloadInboundTaxi(context, guid, event);
      }
      return;
    }
    // Log non-taxi hits but continue with bus matching
    for (const p of byTmid) {
      if (p.app !== 'StargateV2-taxi') {
        console.error('Unexpected non-taxi AppPayload for OFTReceived.getWhere', p.id);
      }
    }
    // Bus path: if BusDriven exists, match by address and fill; else create minimal buffer AppPayload
    const lfg = await context.BusDrivenOftReceivedLfg.get(guid);
    const to = unpadAddress(event.params.toAddress);
    if (lfg) {
      let matched = false;
      for (const pid of lfg.passengerIds) {
        const rode = await context.BusRodeOftSentLfg.get(pid);
        if (!rode) continue;
        const target = rode.passengerReceiver ? unpadAddress(rode.passengerReceiver) : undefined;
        if (to && target && to === target) {
          await context.AppPayload.set({
            id: pid,
            app: 'StargateV2-bus-passenger',
            payloadType: 'transfer',
            transportingProtocol: 'layerzero',
            transportingMessageId: tmid,
            crosschainMessage_id: tmid,
            outboundAssetAddress: undefined,
            outboundAmount: rode.amountSentLD ?? rode.fare,
            outboundSender: rode.fromAddress ? unpadAddress(rode.fromAddress) : undefined,
            outboundTargetAddress: rode.passengerReceiver ? unpadAddress(rode.passengerReceiver) : undefined,
            outboundRaw: undefined,
            inboundAssetAddress: undefined,
            inboundAmount: event.params.amountReceivedLD,
            inboundRecipient: to,
            inboundRaw: undefined,
            matched: Boolean(rode.amountSentLD ?? rode.fare),
          });
          matched = true;
          break;
        }
      }
      if (!matched) {
        console.error('Bus inbound address did not match any passenger', { guid, to });
      }
    } else {
      // Create minimal AppPayload buffer for this inbound
      const bufId = `stargatev2-bus-buffer:${guid}:${event.transaction.hash}:${event.params.amountReceivedLD}`;
      await context.AppPayload.set({
        id: bufId,
        app: 'StargateV2-bus-passenger',
        payloadType: 'transfer',
        transportingProtocol: 'layerzero',
        transportingMessageId: tmid,
        crosschainMessage_id: tmid,
        outboundAssetAddress: undefined,
        outboundAmount: undefined,
        outboundSender: undefined,
        outboundTargetAddress: undefined,
        outboundRaw: undefined,
        inboundAssetAddress: undefined,
        inboundAmount: event.params.amountReceivedLD,
        inboundRecipient: to,
        inboundRaw: undefined,
        matched: false,
      });
    }
  }
});
