#!/usr/bin/env node

/**
 * LayerZero v1 Event Feed
 * 
 * Real-time terminal feed showing:
 * - Raw decoded LayerZero v1 events as they're indexed
 * - Newly matched packet pairs
 * - Event statistics
 */

const { GraphQLClient } = require('graphql-request');
const chalk = require('chalk');

const HASURA_ENDPOINT = 'http://localhost:8080/v1/graphql';
const POLL_INTERVAL = 2000; // 2 seconds

const client = new GraphQLClient(HASURA_ENDPOINT);

// Track last seen events to detect new ones
let lastSeen = {
  ultraLightPacket: null,
  ultraLightReceived: null,
  sendUln301: null,
  receiveUln301: null,
  v1Packets: null,
  v1DecodedPackets: null
};

// Statistics
let stats = {
  totalEvents: 0,
  matchedPackets: 0,
  ultraLightEvents: 0,
  sendUlnEvents: 0,
  sessionsMatched: 0
};

function formatTimestamp(timestamp) {
  return new Date(parseInt(timestamp) * 1000).toLocaleTimeString();
}

function formatChainId(chainId) {
  const chains = {
    1: 'ETH',
    42161: 'ARB',
    8453: 'BASE',
    10: 'OP',
    56: 'BSC',
    137: 'POLY',
    250: 'FTM',
    43114: 'AVAX'
  };
  return chains[chainId] || `Chain${chainId}`;
}

function formatAddress(address) {
  return address; // Return full address for debugging
}

function formatAmount(amount) {
  if (!amount) return 'N/A';
  return (parseInt(amount) / 1e18).toFixed(4);
}

function printHeader() {
  console.clear();
  console.log(chalk.cyan.bold('🌉 LayerZero v1 Event Feed'));
  console.log(chalk.gray('─'.repeat(80)));
  console.log(chalk.yellow(`📊 Session Stats: ${stats.totalEvents} events | ${stats.matchedPackets} matched packets | ${stats.sessionsMatched} new matches`));
  console.log(chalk.gray('─'.repeat(80)));
}

function printRawEvent(event, type, protocol) {
  const timestamp = formatTimestamp(event.blockTimestamp);
  const chain = formatChainId(parseInt(event.chainId));
  
  let eventIcon = '📤'; // sent
  let eventColor = chalk.green;
  
  if (type.includes('Received') || type.includes('Delivered')) {
    eventIcon = '📥'; // received
    eventColor = chalk.blue;
  }
  
  console.log(eventColor(`${eventIcon} ${protocol} ${type}`));
  console.log(chalk.gray(`   ${timestamp} | ${chain} | Block ${event.blockNumber}`));
  console.log(chalk.gray(`   TX Hash: ${event.txHash}`));
  console.log(chalk.gray(`   Event ID: ${event.id}`));
  
  // Show ALL available fields for debugging
  if (type === 'Packet') {
    console.log(chalk.cyan(`   📦 Packet Data:`));
    console.log(chalk.gray(`     Payload: ${event.payload}`));
    console.log(chalk.gray(`     Payload Length: ${event.payload.length} chars`));
  } else if (type === 'PacketReceived') {
    console.log(chalk.cyan(`   📥 PacketReceived Data:`));
    console.log(chalk.gray(`     Source Chain ID: ${event.srcChainId} (${formatChainId(parseInt(event.srcChainId))})`));
    console.log(chalk.gray(`     Source Address: ${event.srcAddress}`));
    console.log(chalk.gray(`     Destination Address: ${event.dstAddress}`));
    console.log(chalk.gray(`     Nonce: ${event.nonce}`));
    console.log(chalk.gray(`     Payload Hash: ${event.payloadHash}`));
  } else if (type === 'PacketSent') {
    console.log(chalk.cyan(`   📤 PacketSent Data:`));
    console.log(chalk.gray(`     Encoded Payload: ${event.encodedPayload}`));
    console.log(chalk.gray(`     Encoded Payload Length: ${event.encodedPayload.length} chars`));
    console.log(chalk.gray(`     Options: ${event.options}`));
    console.log(chalk.gray(`     Native Fee: ${event.nativeFee} wei (${formatAmount(event.nativeFee)} ETH)`));
    console.log(chalk.gray(`     LZ Token Fee: ${event.lzTokenFee} wei (${formatAmount(event.lzTokenFee)} ETH)`));
  } else if (type === 'PacketDelivered') {
    console.log(chalk.cyan(`   📥 PacketDelivered Data:`));
    console.log(chalk.gray(`     Origin Source EID: ${event.originSrcEid}`));
    console.log(chalk.gray(`     Origin Sender: ${event.originSender}`));
    console.log(chalk.gray(`     Origin Nonce: ${event.originNonce}`));
    console.log(chalk.gray(`     Receiver: ${event.receiver}`));
  }
  
  console.log('');
}

function printDecodedPacket(packet) {
  const srcChain = formatChainId(parseInt(packet.srcChainId));
  const dstChain = packet.dstChainId ? formatChainId(parseInt(packet.dstChainId)) : '?';
  const timestamp = formatTimestamp(packet.lastUpdated);
  
  console.log(chalk.magenta.bold(`🔍 DECODED PACKET! ${packet.protocol}`));
  console.log(chalk.yellow(`   ${srcChain} → ${dstChain} | ${timestamp}`));
  console.log(chalk.gray(`   Packet ID: ${packet.id}`));
  
  console.log(chalk.cyan(`   🎯 Decoded Data:`));
  console.log(chalk.gray(`     Nonce: ${packet.nonce}`));
  console.log(chalk.gray(`     User Application: ${packet.ua}`));
  console.log(chalk.gray(`     Destination Address: ${packet.dstAddress}`));
  console.log(chalk.gray(`     Source Chain ID: ${packet.srcChainId} (${srcChain})`));
  console.log(chalk.gray(`     Destination Chain ID: ${packet.dstChainId || 'Unknown'} (${dstChain})`));
  
  if (packet.payload && packet.payload !== '0x') {
    console.log(chalk.gray(`     Inner Payload: ${packet.payload.slice(0, 100)}${packet.payload.length > 100 ? '...' : ''}`));
  }
  
  if (packet.sourceTxHash) {
    console.log(chalk.gray(`     Source TX: ${packet.sourceTxHash}`));
  }
  
  console.log('');
}

function printMatchedPacket(packet) {
  const srcChain = formatChainId(parseInt(packet.srcChainId));
  const dstChain = packet.dstChainId ? formatChainId(parseInt(packet.dstChainId)) : '?';
  
  console.log(chalk.green.bold(`🎯 NEW MATCH! ${packet.protocol}`));
  console.log(chalk.yellow(`   ${srcChain} → ${dstChain} | Protocol: ${packet.protocol}`));
  console.log(chalk.gray(`   Packet ID: ${packet.id}`));
  
  console.log(chalk.cyan(`   🔗 Routing Info:`));
  console.log(chalk.gray(`     Source Chain ID: ${packet.srcChainId} (${srcChain})`));
  console.log(chalk.gray(`     Destination Chain ID: ${packet.dstChainId} (${dstChain})`));
  console.log(chalk.gray(`     Nonce: ${packet.nonce}`));
  console.log(chalk.gray(`     User Application: ${packet.ua}`));
  console.log(chalk.gray(`     Destination Address: ${packet.dstAddress}`));
  
  console.log(chalk.cyan(`   ⏰ Timing Info:`));
  if (packet.sentTimestamp && packet.deliveredTimestamp) {
    const latency = packet.latencySeconds ? `${packet.latencySeconds}s` : 'N/A';
    console.log(chalk.gray(`     Sent: ${formatTimestamp(packet.sentTimestamp)} (${packet.sentTimestamp})`));
    console.log(chalk.gray(`     Delivered: ${formatTimestamp(packet.deliveredTimestamp)} (${packet.deliveredTimestamp})`));
    console.log(chalk.gray(`     Latency: ${latency}`));
  } else {
    console.log(chalk.gray(`     Sent: ${packet.sentTimestamp ? formatTimestamp(packet.sentTimestamp) + ' (' + packet.sentTimestamp + ')' : 'N/A'}`));
    console.log(chalk.gray(`     Delivered: ${packet.deliveredTimestamp ? formatTimestamp(packet.deliveredTimestamp) + ' (' + packet.deliveredTimestamp + ')' : 'N/A'}`));
  }
  
  console.log(chalk.cyan(`   📝 Transaction Hashes:`));
  if (packet.sourceTxHash) {
    console.log(chalk.gray(`     Source TX: ${packet.sourceTxHash}`));
  } else {
    console.log(chalk.gray(`     Source TX: N/A`));
  }
  if (packet.destinationTxHash) {
    console.log(chalk.gray(`     Destination TX: ${packet.destinationTxHash}`));
  } else {
    console.log(chalk.gray(`     Destination TX: N/A`));
  }
  
  console.log('');
  stats.sessionsMatched++;
}

async function fetchNewEvents() {
  try {
    const query = `
      query GetLatestEvents($ultraLightPacketAfter: String, $ultraLightReceivedAfter: String, $sendUln301After: String, $receiveUln301After: String, $v1PacketsAfter: String, $v1DecodedPacketsAfter: String) {
        UltraLightNodeV2_Packet(
          limit: 20
          order_by: {blockTimestamp: desc}
          where: {id: {_gt: $ultraLightPacketAfter}}
        ) {
          id
          payload
          chainId
          blockNumber
          blockTimestamp
          txHash
        }
        
        UltraLightNodeV2_PacketReceived(
          limit: 20
          order_by: {blockTimestamp: desc}
          where: {id: {_gt: $ultraLightReceivedAfter}}
        ) {
          id
          srcChainId
          srcAddress
          dstAddress
          nonce
          payloadHash
          chainId
          blockNumber
          blockTimestamp
          txHash
        }
        
        SendUln301_PacketSent(
          limit: 20
          order_by: {blockTimestamp: desc}
          where: {id: {_gt: $sendUln301After}}
        ) {
          id
          encodedPayload
          options
          nativeFee
          lzTokenFee
          chainId
          blockNumber
          blockTimestamp
          txHash
        }
        
        ReceiveUln301_PacketDelivered(
          limit: 20
          order_by: {blockTimestamp: desc}
          where: {id: {_gt: $receiveUln301After}}
        ) {
          id
          originSrcEid
          originSender
          originNonce
          receiver
          chainId
          blockNumber
          blockTimestamp
          txHash
        }
        
        LayerZeroV1Packet(
          limit: 10
          order_by: {lastUpdated: desc}
          where: {
            matched: {_eq: true}
            id: {_gt: $v1PacketsAfter}
          }
        ) {
          id
          srcChainId
          dstChainId
          nonce
          ua
          dstAddress
          protocol
          matched
          sourceTxHash
          destinationTxHash
          sentTimestamp
          deliveredTimestamp
          latencySeconds
        }
        
        DecodedPackets: LayerZeroV1Packet(
          limit: 20
          order_by: {lastUpdated: desc}
          where: {
            eventType: {_eq: "sent"}
            protocol: {_eq: "UltraLightNodeV2"}
            id: {_gt: $v1DecodedPacketsAfter}
          }
        ) {
          id
          nonce
          ua
          dstAddress
          srcChainId
          dstChainId
          payload
          protocol
          sourceTxHash
          lastUpdated
        }
      }
    `;
    
    const variables = {
      ultraLightPacketAfter: lastSeen.ultraLightPacket || "",
      ultraLightReceivedAfter: lastSeen.ultraLightReceived || "",
      sendUln301After: lastSeen.sendUln301 || "",
      receiveUln301After: lastSeen.receiveUln301 || "",
      v1PacketsAfter: lastSeen.v1Packets || "",
      v1DecodedPacketsAfter: lastSeen.v1DecodedPackets || ""
    };
    
    const data = await client.request(query, variables);
    
    // Process new events in reverse order (oldest first)
    const newEvents = [];
    
    // UltraLightNodeV2 Packet events
    if (data.UltraLightNodeV2_Packet.length > 0) {
      data.UltraLightNodeV2_Packet.reverse().forEach(event => {
        newEvents.push({ event, type: 'Packet', protocol: 'UltraLightNodeV2' });
        stats.ultraLightEvents++;
      });
      lastSeen.ultraLightPacket = data.UltraLightNodeV2_Packet[data.UltraLightNodeV2_Packet.length - 1].id;
    }
    
    // UltraLightNodeV2 PacketReceived events
    if (data.UltraLightNodeV2_PacketReceived.length > 0) {
      data.UltraLightNodeV2_PacketReceived.reverse().forEach(event => {
        newEvents.push({ event, type: 'PacketReceived', protocol: 'UltraLightNodeV2' });
        stats.ultraLightEvents++;
      });
      lastSeen.ultraLightReceived = data.UltraLightNodeV2_PacketReceived[data.UltraLightNodeV2_PacketReceived.length - 1].id;
    }
    
    // SendUln301 PacketSent events
    if (data.SendUln301_PacketSent.length > 0) {
      data.SendUln301_PacketSent.reverse().forEach(event => {
        newEvents.push({ event, type: 'PacketSent', protocol: 'SendUln301' });
        stats.sendUlnEvents++;
      });
      lastSeen.sendUln301 = data.SendUln301_PacketSent[data.SendUln301_PacketSent.length - 1].id;
    }
    
    // ReceiveUln301 PacketDelivered events
    if (data.ReceiveUln301_PacketDelivered.length > 0) {
      data.ReceiveUln301_PacketDelivered.reverse().forEach(event => {
        newEvents.push({ event, type: 'PacketDelivered', protocol: 'ReceiveUln301' });
        stats.sendUlnEvents++;
      });
      lastSeen.receiveUln301 = data.ReceiveUln301_PacketDelivered[data.ReceiveUln301_PacketDelivered.length - 1].id;
    }
    
    // Sort all events by timestamp
    newEvents.sort((a, b) => parseInt(a.event.blockTimestamp) - parseInt(b.event.blockTimestamp));
    
    // Process newly matched packets
    const newMatches = data.LayerZeroV1Packet.reverse();
    
    // Process newly decoded packets (UltraLightNodeV2 sent events)
    const newDecodedPackets = data.DecodedPackets.reverse();
    
    // Update total event count
    stats.totalEvents += newEvents.length;
    
    // Print header
    printHeader();
    
    // Print new events
    newEvents.forEach(({ event, type, protocol }) => {
      printRawEvent(event, type, protocol);
    });
    
    // Print newly decoded packets
    newDecodedPackets.forEach(packet => {
      printDecodedPacket(packet);
    });
    
    // Print new matches
    newMatches.forEach(packet => {
      printMatchedPacket(packet);
      stats.matchedPackets++;
    });
    
    if (newMatches.length > 0) {
      lastSeen.v1Packets = newMatches[newMatches.length - 1].id;
    }
    
    // Update last seen for decoded packets
    if (newDecodedPackets.length > 0) {
      lastSeen.v1DecodedPackets = newDecodedPackets[newDecodedPackets.length - 1].id;
    }
    
    // Show "waiting" message if no new events
    if (newEvents.length === 0 && newMatches.length === 0 && newDecodedPackets.length === 0) {
      console.log(chalk.gray('⏳ Waiting for new events...'));
    }
    
  } catch (error) {
    console.error(chalk.red('Error fetching events:'), error.message);
  }
}

async function main() {
  console.log(chalk.cyan.bold('🚀 Starting LayerZero v1 Event Feed...'));
  console.log(chalk.gray(`Polling every ${POLL_INTERVAL / 1000}s`));
  console.log('');
  
  // Initial fetch
  await fetchNewEvents();
  
  // Set up polling
  setInterval(fetchNewEvents, POLL_INTERVAL);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n');
  console.log(chalk.yellow('📊 Final Stats:'));
  console.log(chalk.gray(`Total Events Processed: ${stats.totalEvents}`));
  console.log(chalk.gray(`Matched Packets: ${stats.matchedPackets}`));
  console.log(chalk.gray(`New Matches This Session: ${stats.sessionsMatched}`));
  console.log(chalk.gray(`UltraLightNodeV2 Events: ${stats.ultraLightEvents}`));
  console.log(chalk.gray(`SendUln301 Events: ${stats.sendUlnEvents}`));
  console.log(chalk.green.bold('👋 Feed stopped'));
  process.exit(0);
});

main().catch(console.error);