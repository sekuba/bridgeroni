# CCTP Bridge Monitor TUI 🌱

A solarpunk terminal interface for monitoring CCTP bridge transactions between Ethereum and Base.

## Features

- **Real-time monitoring** of bridge events with 5-second refresh
- **Minimal dependencies** - uses only Node.js built-ins (requires Node 18+)
- **Solarpunk aesthetic** with green/cyan color scheme
- **Three main sections**:
  - **Metrics**: Total events, matched transfers, average latency, latest blocks
  - **Raw Activity**: Recent deposit events showing chain→destination flow
  - **Matched Bridges**: Complete bridge transfers with source/destination details

## Usage

```bash
# Start the TUI (make sure the indexer is running first)
./tui.js

# Or with node explicitly
node tui.js
```

## Requirements

- Node.js 18+ (for built-in fetch support)
- Running Envio indexer with GraphQL API at `http://localhost:8080/v1/graphql`

## Architecture

**Suckless Design Philosophy:**
- Zero external dependencies beyond Node.js
- Pure terminal rendering with ANSI escape codes
- Minimal memory footprint
- Easy to hack and maintain

**Data Flow:**
1. GraphQL queries fetch data every 5 seconds
2. Data is processed and metrics calculated
3. Terminal is cleared and redrawn with updated information
4. ANSI colors provide visual hierarchy

**Code Structure:**
- `CCTPMonitor` class handles all functionality
- `graphql()` method handles API communication
- `render*()` methods handle terminal output
- `format*()` methods handle data presentation

## Customization

The code is designed to be easily hackable:

- **Colors**: Modify the `COLORS` object for different themes
- **Refresh rate**: Change the `setInterval` timing (currently 5000ms)
- **Layout**: Adjust box sizes in the `drawBox()` calls
- **Data filtering**: Modify the GraphQL queries for different data sets

## Solarpunk Values

This tool embodies solarpunk principles:
- **Decentralized**: Monitors blockchain bridge infrastructure
- **Sustainable**: Minimal resource usage, no bloated dependencies  
- **Accessible**: Terminal-based, works on any system
- **Hackable**: Open source, easy to modify and improve
- **Aesthetic**: Green colors celebrating growth and nature

Keep scaling Ethereum! 🌱