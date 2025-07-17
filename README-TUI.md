# Bridge Monitor TUI 🌱

A comprehensive terminal interface for monitoring cross-chain bridge transactions across EVM chains. This tool provides real-time insights into both CCTP (Circle Cross-Chain Transfer Protocol) v1/v2 and LayerZero v2 bridge activity with advanced analytics, search capabilities, and performance monitoring.

## Supported Protocols

- **CCTP v1 & v2**: USDC bridge transfers with deterministic matching
- **LayerZero v2**: Omnichain packet routing with payload analysis

## Features

### Core Functionality
- **Real-time monitoring** of bridge events with 1-second refresh
- **Multi-protocol support** for CCTP v1/v2 and LayerZero v2
- **Multi-chain support** across 7 EVM chains with live block tracking
- **Advanced matching logic** with protocol-specific deterministic algorithms
- **Multiple view modes**: Dashboard, List, and Search interfaces
- **Performance optimization** with intelligent caching and batch processing
- **Unordered event processing** with eventual consistency guarantees

### Interactive Interface
- **Dashboard mode**: Overview metrics, raw activity feed, and matched transfers
- **List mode**: Filtered transaction lists with chain-specific navigation
- **Search mode**: Transaction hash lookup with database search capabilities
- **Keyboard navigation**: vim-like controls with arrow key support
- **Real-time updates**: Green indicators for recently matched transfers
- **Protocol switching**: Toggle between CCTP and LayerZero monitoring

### Analytics & Metrics
- **CCTP Analytics**: Volume tracking, latency binning by amount, v1/v2 separation
- **LayerZero Analytics**: Packet routing analysis, payload tracking, EID-based metrics
- **Cross-chain timing**: Latency distribution analysis across all supported chains
- **Match rate monitoring**: Bridge completion rates and failure detection
- **Block synchronization**: Real-time sync status across all indexed chains

## Supported Chains

### Complete Chain Coverage
| Chain | Chain ID | CCTP Domain | LayerZero EID | Protocols |
|-------|----------|-------------|---------------|-----------|
| **Ethereum** | 1 | 0 | 30101 | CCTP v1/v2, LayerZero v2 |
| **OP Mainnet** | 10 | 2 | 30111 | CCTP v1/v2, LayerZero v2 |
| **Arbitrum** | 42161 | 3 | 30110 | CCTP v1/v2, LayerZero v2 |
| **Base** | 8453 | 6 | 30184 | CCTP v1/v2, LayerZero v2 |
| **Unichain** | 130 | 10 | - | CCTP v1/v2 |
| **Linea** | 59144 | 11 | - | CCTP v2 only |
| **World Chain** | 480 | 14 | - | CCTP v2 only |

### Protocol-Specific Features
- **CCTP**: Domain-based routing with USDC-specific analytics
- **LayerZero**: EID-based routing with generic packet analysis
- **Multi-chain**: Parallel indexing with reorg protection

## Usage

### Starting the TUI
```bash
# Install dependencies
pnpm install

# Start the indexer (required for both TUIs)
pnpm dev

# Start CCTP Bridge Monitor (requires Node.js 18+)
pnpm tui
# or
node tui.ts

# Start LayerZero Bridge Monitor 
node lzTui.ts
```

### Navigation Controls
- **Dashboard mode**: 
  - `[l]` - Switch to list view
  - `[s]` - Switch to search mode
  - `Ctrl+C` - Exit
- **List mode**:
  - `[f]` - Filter by "from" chain
  - `[t]` - Filter by "to" chain
  - `[1-7]` - Select specific chains
  - `[j/k]` or `↑/↓` - Navigate items
  - `[q/ESC]` - Return to dashboard
- **Search mode**:
  - Type transaction hash to search
  - `[Enter]` - Execute search
  - `[Backspace]` - Edit query
  - `[q/ESC]` - Return to dashboard

## Requirements

- **Node.js 18+** (for built-in fetch support)
- **Running Envio indexer** with GraphQL API at `http://localhost:8080/v1/graphql`
- **Docker** (for running the indexer backend)

## Architecture

### Backend Infrastructure
- **Envio Hyperindex**: High-performance blockchain indexer with hypersync
- **GraphQL API**: Real-time data access with intelligent caching
- **PostgreSQL**: Event storage with optimized indexing
- **Multi-chain synchronization**: Parallel indexing with unordered processing
- **Performance optimizations**: Query batching, connection pooling, incremental updates

### Protocol Understanding

#### CCTP v1 (Legacy)
- **Nonce-based matching**: Direct nonce correlation between deposit and receive events
- **Simple event structure**: Standard TokenMessenger/MessageTransmitter contracts
- **Supported chains**: Ethereum, OP, Arbitrum, Base, Unichain

#### CCTP v2 (Current)
- **Message body decoding**: Complex messageBody parsing for transfer details
- **Deterministic nonce computation**: SHA-256 hash of message components
- **Enhanced features**: Finality thresholds, hook data, dynamic fees
- **Broader adoption**: All chains support v2, some are v2-only

#### LayerZero v2
- **Packet header decoding**: 81-byte header with routing information
- **GUID-based matching**: Deterministic packet matching via keccak256
- **Omnichain routing**: EID-based cross-chain packet delivery
- **Payload analysis**: Generic message payload processing

### Data Flow Architecture

```
                    Multi-Chain Event Processing
┌─────────────────┬─────────────────┬─────────────────┐
│   Ethereum      │   Arbitrum      │   Base/OP/etc   │
│   Events        │   Events        │   Events        │
└─────────────────┴─────────────────┴─────────────────┘
                           │
                           ▼
           ┌─────────────────────────────────────┐
           │        Envio Hyperindex             │
           │    (Unordered Multichain Mode)     │
           └─────────────────────────────────────┘
                           │
                           ▼
    ┌─────────────────────────────────────────────────────────┐
    │              Event Handlers (TypeScript)               │
    │  ┌─────────────────┐  ┌─────────────────────────────┐  │
    │  │ CCTP v1/v2      │  │ LayerZero v2                │  │
    │  │ • Nonce matching│  │ • Packet header decoding   │  │
    │  │ • Message decode│  │ • GUID-based matching      │  │
    │  └─────────────────┘  └─────────────────────────────┘  │
    └─────────────────────────────────────────────────────────┘
                           │
                           ▼
    ┌─────────────────────────────────────────────────────────┐
    │              PostgreSQL Database                        │
    │  ┌─────────────────┐  ┌─────────────────────────────┐  │
    │  │ Raw Events      │  │ Aggregated Entities         │  │
    │  │ • Deposits      │  │ • CCTPTransfer              │  │
    │  │ • Receipts      │  │ • LayerZeroPacket           │  │
    │  │ • Packets       │  │ • Computed metrics          │  │
    │  └─────────────────┘  └─────────────────────────────┘  │
    └─────────────────────────────────────────────────────────┘
                           │
                           ▼
    ┌─────────────────────────────────────────────────────────┐
    │              GraphQL API (Auto-generated)              │
    │  ┌─────────────────┐  ┌─────────────────────────────┐  │
    │  │ Real-time       │  │ Optimized Queries           │  │
    │  │ Subscriptions   │  │ • Caching layer             │  │
    │  │ • Live updates  │  │ • Batch processing          │  │
    │  └─────────────────┘  └─────────────────────────────┘  │
    └─────────────────────────────────────────────────────────┘
                           │
                           ▼
    ┌─────────────────────────────────────────────────────────┐
    │                Terminal UIs                             │
    │  ┌─────────────────┐  ┌─────────────────────────────┐  │
    │  │ CCTP Monitor    │  │ LayerZero Monitor           │  │
    │  │ (tui.ts)        │  │ (lzTui.ts)                  │  │
    │  │ • USDC analytics│  │ • Packet routing analytics  │  │
    │  │ • Volume tracking│  │ • Payload analysis         │  │
    │  └─────────────────┘  └─────────────────────────────┘  │
    └─────────────────────────────────────────────────────────┘
```

### Core Components

#### 1. Event Handlers (`src/EventHandlers.ts`)
- **Multi-protocol support**: Handles CCTP v1/v2 and LayerZero v2 events
- **Unordered processing**: Supports out-of-order event delivery
- **Deterministic matching**: Protocol-specific matching algorithms
- **Data enrichment**: Adds computed fields and metadata

#### 2. Protocol Decoders
- **CCTP v2 (`src/utils/messageDecoder.ts`)**: Decodes 228-byte message bodies
- **LayerZero v2 (`src/utils/layerzeroDecoder.ts`)**: Decodes 81-byte packet headers
- **Deterministic ID generation**: Ensures consistent cross-chain matching

#### 3. GraphQL Interface Layer
- **CCTP Queries (`src/utils/graphql.ts`)**: Standard parallel queries
- **LayerZero Queries (`src/utils/layerzeroGraphql.ts`)**: Optimized with caching
- **Performance optimization**: Query batching, connection pooling, TTL caching

#### 4. Terminal UI Systems
- **CCTP Monitor (`tui.ts`)**: USDC-focused bridge monitoring
- **LayerZero Monitor (`lzTui.ts`)**: Packet routing analytics
- **Shared UI patterns**: Common keyboard handling and rendering

#### 5. Formatting Utilities
- **Common (`src/utils/formatters.ts`)**: Shared formatting functions
- **CCTP-specific**: USDC amounts, domain-based routing
- **LayerZero-specific (`src/utils/layerzeroFormatters.ts`)**: EID-based routing

#### 6. Configuration (`src/constants.ts`)
- **Multi-protocol mappings**: Chain ID, CCTP domain, LayerZero EID correlations
- **Explorer integration**: Protocol-specific transaction URLs
- **Performance tuning**: Cache TTL, batch sizes, refresh intervals

### Matching Algorithms

#### CCTP v1 Matching (Nonce-based)
```typescript
// Direct nonce correlation between deposit and receipt
const transferId = createTransferId(sourceDomain, nonce);
const existingTransfer = await context.CCTPTransfer.get(transferId);
```

#### CCTP v2 Matching (Deterministic)
```typescript
// Compute deterministic nonce from message components
const deterministicNonce = computeV2DeterministicNonce(
  sourceDomain, destinationDomain, burnToken, mintRecipient,
  amount, messageSender, maxFee, hookData
);
const transferId = createTransferId(sourceDomain, deterministicNonce);
```

#### LayerZero v2 Matching (GUID-based)
```typescript
// Generate deterministic GUID from packet header
const guid = createLayerZeroGuid(
  nonce, srcEid, sender, dstEid, receiver
);
const existingPacket = await context.LayerZeroPacket.get(guid);
```

### Performance Optimizations

#### Multi-Level Caching
- **Query-level caching**: 5-second TTL for repeated GraphQL queries
- **Component caching**: Rendered UI components cached until data changes
- **Format caching**: Expensive formatting operations cached with Map structures
- **Chain lookup caching**: Repeated chain name/color lookups cached

#### Efficient Data Processing
- **Batch processing**: Events processed in configurable batches
- **Incremental updates**: Time-based filtering for reduced data transfer
- **Connection pooling**: HTTP keep-alive for persistent GraphQL connections
- **Render throttling**: Prevents excessive re-renders with 50ms throttling

#### Database Optimizations
- **Indexed queries**: Optimized database queries with proper indexing
- **Parallel queries**: All GraphQL requests executed simultaneously
- **Unordered processing**: Parallel chain indexing for maximum throughput
- **Memory cleanup**: Automatic cache cleanup and bounded arrays

## Customization

### Visual Themes
```typescript
// Modify colors in src/constants.ts
export const COLORS = {
  ethereum: '\x1b[95m',  // Purple
  base: '\x1b[34m',      // Blue
  arbitrum: '\x1b[36m',  // Cyan
  // Add custom chain colors
};
```

### Refresh Intervals
```typescript
// Adjust in src/constants.ts
export const TUI_CONFIG = {
  REFRESH_INTERVAL: 1000,  // 1 second
  MAX_RAW_EVENTS: 12,      // Events in feed
  MAX_MATCHED_TRANSFERS: 6, // Matched transfers shown
};
```

### Amount Binning
```typescript
// Customize latency analysis bins
export const TRANSFER_AMOUNT_BINS = {
  micro: { min: 0, max: 10, label: '0-10' },
  small: { min: 10, max: 100, label: '>10-100' },
  // Add custom bins
};
```

## Development

### Adding New Bridge Protocols
1. **Update config**: Add contract definitions to `config.yaml`
2. **Schema updates**: Define new entity types in `schema.graphql`
3. **Event handlers**: Create protocol-specific matching logic in `EventHandlers.ts`
4. **Decoder functions**: Implement message format parsing in `src/utils/`
5. **TUI integration**: Add protocol-specific formatters and queries

### Adding New Chains
1. **Update constants**: Add chain ID and protocol-specific mappings
2. **Configure indexer**: Add network configuration to `config.yaml`
3. **Deploy contracts**: Ensure protocol contracts are deployed
4. **Update formatters**: Add chain-specific colors and explorers

### Extending Analytics
- **Custom metrics**: Add new calculations to protocol-specific metrics functions
- **Additional queries**: Extend GraphQL queries for new data sources
- **Enhanced visualizations**: Create new render methods for data display

### Testing
```bash
# Run the indexer
pnpm dev

# Test CCTP TUI
node tui.ts

# Test LayerZero TUI
node lzTui.ts
```

## Technical Details

### CCTP v2 Message Body Structure (228 bytes)
```
┌─────────────────┬──────────────────┐
│     Field       │      Size        │
├─────────────────┼──────────────────┤
│ Version         │ 4 bytes          │
│ Burn Token      │ 32 bytes         │
│ Mint Recipient  │ 32 bytes         │
│ Amount          │ 32 bytes         │
│ Message Sender  │ 32 bytes         │
│ Max Fee         │ 32 bytes         │
│ Fee Executed    │ 32 bytes         │
│ Expiration Block│ 32 bytes         │
│ Hook Data       │ Dynamic          │
└─────────────────┴──────────────────┘
```

### LayerZero v2 Packet Header Structure (81 bytes)
```
┌─────────────────┬──────────────────┐
│     Field       │      Size        │
├─────────────────┼──────────────────┤
│ Version         │ 1 byte           │
│ Nonce           │ 8 bytes          │
│ Source EID      │ 4 bytes          │
│ Sender          │ 32 bytes         │
│ Destination EID │ 4 bytes          │
│ Receiver        │ 32 bytes         │
│ Payload         │ Variable         │
└─────────────────┴──────────────────┘
```

### Database Schema

#### CCTP Tables
- **CCTPTransfer**: Matched transfer records with latency metrics
- **TokenMessenger_DepositForBurn**: Raw v1 deposit events
- **TokenMessenger_DepositForBurnV2**: Raw v2 deposit events
- **MessageTransmitter_MessageReceived**: Raw v1 receipt events
- **MessageTransmitter_MessageReceivedV2**: Raw v2 receipt events

#### LayerZero Tables
- **LayerZeroPacket**: Matched packet records with routing information
- **EndpointV2_PacketSent**: Raw packet sent events
- **EndpointV2_PacketDelivered**: Raw packet delivered events

### Error Handling
- **Graceful degradation**: Continues operation with partial data
- **Retry logic**: Built-in error recovery for network issues
- **Data validation**: Comprehensive input validation and sanitization

## Troubleshooting

### Common Issues
1. **No data displayed**: Ensure indexer is running and synced
2. **Slow performance**: Check database connection and query efficiency
3. **Missing events**: Verify contract addresses and start blocks
4. **Matching failures**: Check nonce computation and message decoding

### Debug Mode
```bash
# Enable debug logging
DEBUG=cctp:* node tui.ts
```

## Future Enhancements

### Planned Features
- **Historical analysis**: Time-series charts and trend analysis
- **Alert system**: Notifications for failed transfers or anomalies
- **Export functionality**: CSV/JSON export of transfer data
- **Multi-indexer support**: Federation across multiple indexer instances
- **RPC fallback**: Direct RPC queries when indexer is unavailable

### Protocol Extensions
- **Additional bridges**: Support for other cross-chain protocols
- **Unified metrics**: Cross-protocol bridge comparison
- **Advanced analytics**: MEV analysis, arbitrage detection
- **Custom hooks**: Plugin system for additional processing

## Philosophy

This tool embodies **solarpunk** principles:
- **Decentralized**: Monitors decentralized bridge infrastructure
- **Sustainable**: Minimal resource usage, efficient algorithms
- **Accessible**: Terminal-based, works on any system
- **Hackable**: Open source, modular, extensively documented
- **Aesthetic**: Clean interface celebrating technological harmony

(lmao @this)

The CCTP Bridge Monitor represents the intersection of robust engineering and sustainable design, providing essential infrastructure monitoring while maintaining environmental and social responsibility.

Keep scaling Ethereum! 🌱