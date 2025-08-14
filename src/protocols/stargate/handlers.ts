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

// TokenMessaging.BusDriven — may happen before or after inbound
TokenMessaging.BusDriven.handler(async ({ event, context }) => {
  const guid: string = event.params.guid;
  const tmid = `layerzero:${guid}`;

  const srcEid = getEidForChain(event.chainId);
  const passengerIds: string[] = [];
  for (let i = 0n; i < event.params.numPassengers; i++) {
    const ticketId = event.params.startTicketId + i;
    const passengerId = busPassengerEntityId(srcEid, Number(event.params.dstEid), ticketId);
    passengerIds.push(passengerId);
  }
  // Decide path: if any inbound AppPayload already exists for these passengerIds, enrich; else, store LFG
  const anyInboundExists = await (async () => {
    for (const pid of passengerIds) {
      const maybe = await context.AppPayload.get(pid);
      if (maybe && maybe.inboundRecipient) return true;
    }
    return false;
  })();

  if (anyInboundExists) {
    for (const pid of passengerIds) {
      const rodeEntity = await context.BusRodeOftSentLfg.get(pid);
      const inbound = await context.AppPayload.get(pid);
      if (!rodeEntity || !inbound) continue;
      await context.AppPayload.set({
        id: pid,
        app: 'StargateV2-bus-passenger',
        payloadType: 'transfer',
        transportingProtocol: 'layerzero',
        transportingMessageId: tmid,
        crosschainMessage_id: tmid,
        outboundAssetAddress: undefined,
        outboundAmount: rodeEntity.amountSentLD ?? rodeEntity.fare,
        outboundSender: rodeEntity.fromAddress ? unpadAddress(rodeEntity.fromAddress) : undefined,
        outboundTargetAddress: rodeEntity.passengerReceiver ? unpadAddress(rodeEntity.passengerReceiver) : undefined,
        outboundRaw: undefined,
        inboundAssetAddress: inbound.inboundAssetAddress,
        inboundAmount: inbound.inboundAmount,
        inboundRecipient: inbound.inboundRecipient ? unpadAddress(inbound.inboundRecipient) : undefined,
        inboundRaw: inbound.inboundRaw,
        matched: Boolean((rodeEntity.amountSentLD ?? rodeEntity.fare) && inbound.inboundAmount),
      });
    }
  } else {
    await context.BusDrivenOftReceivedLfg.set({ id: guid, passengerIds });
  }
});

// Inbound
StargatePool.OFTReceived.handler(async ({ event, context }) => {
  const guid = event.params.guid;
  const tmid = `layerzero:${guid}`;
  // First try: taxi by its deterministic id
  const taxiId = taxiPayloadId(guid);
  const existingTaxi = await context.AppPayload.get(taxiId);
  if (existingTaxi) {
    await upsertPayloadInboundTaxi(context, guid, event);
    return;
  }

  // Bus path
  const lfg = await context.BusDrivenOftReceivedLfg.get(guid);
  if (!lfg) return; // Not enough info yet; will be handled once BusDriven arrives
  // Try to match by recipient address (normalize). Amount matching TBD.
  const to = unpadAddress(event.params.toAddress);
  for (const pid of lfg.passengerIds) {
    const passenger = await context.BusRodeOftSentLfg.get(pid);
    if (!passenger) continue;
    if ((passenger.passengerReceiver && to && unpadAddress(passenger.passengerReceiver) === to)) {
      await context.AppPayload.set({
        id: pid,
        app: 'StargateV2-bus-passenger',
        payloadType: 'transfer',
        transportingProtocol: 'layerzero',
        transportingMessageId: tmid,
        crosschainMessage_id: tmid,
        outboundAssetAddress: undefined,
        outboundAmount: passenger.amountSentLD ?? passenger.fare,
        outboundSender: passenger.fromAddress ? unpadAddress(passenger.fromAddress) : undefined,
        outboundTargetAddress: passenger.passengerReceiver ? unpadAddress(passenger.passengerReceiver) : undefined,
        outboundRaw: undefined,
        inboundAssetAddress: undefined,
        inboundAmount: event.params.amountReceivedLD,
        inboundRecipient: to,
        inboundRaw: undefined,
        matched: Boolean(passenger.amountSentLD ?? passenger.fare),
      });
      // Do not break; in rare cases multiple passengers may share addr — amounts would help disambiguate
    }
  }
});
