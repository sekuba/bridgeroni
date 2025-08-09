import requests
import statistics

HASURA_URL = "http://localhost:8080/v1/graphql"

def run_query(query, variables=None):
    response = requests.post(
        HASURA_URL,
        json={"query": query, "variables": variables or {}}
    )
    response.raise_for_status()
    resp_json = response.json()
    if "data" not in resp_json:
        print("GraphQL query failed. Response:")
        print(resp_json)
        raise Exception("No 'data' in GraphQL response. Check if the table exists or query is valid.")
    return resp_json["data"]

def main():
    # 1. Raw event counts using correct table names
    event_types = [
        "SpokePool_FilledRelay",
        "SpokePool_FilledV3Relay",
        "SpokePool_FundsDeposited",
        "CrosschainMessage"
    ]
    print("Raw event counts:")
    for et in event_types:
        query = f"query {{ {et} {{ id }} }}"
        try:
            rows = run_query(query)[et]
            print(f"  {et}: {len(rows)}")
        except Exception as e:
            print(f"  {et}: Error - {e}")

    # 2. Matched CrosschainMessages
    query = """
    query {
      CrosschainMessage(where: {matched: {_eq: true}}) {
        id
        chainIdOutbound
        chainIdInbound
        fromOutbound
        toInbound
        latency
      }
    }
    """
    matched_msgs = run_query(query)["CrosschainMessage"]
    print(f"\nMatched CrosschainMessages: {len(matched_msgs)}")

    # 3. Ranking of source->destination combinations
    combo_counts = {}
    for msg in matched_msgs:
        src = str(msg.get("chainIdOutbound"))
        dst = str(msg.get("chainIdInbound"))
        key = f"{src}->{dst}"
        combo_counts[key] = combo_counts.get(key, 0) + 1
    print("\nSource -> Destination ranking:")
    for combo, count in sorted(combo_counts.items(), key=lambda x: -x[1]):
        print(f"  {combo}: {count}")

    # 4. Latency statistics
    latencies = [int(msg["latency"]) for msg in matched_msgs if msg["latency"] is not None]
    if latencies:
        print("\nLatency statistics (seconds):")
        print(f"  Count: {len(latencies)}")
        print(f"  Average: {statistics.mean(latencies):.2f}")
        print(f"  Median: {statistics.median(latencies):.2f}")
        print(f"  Min: {min(latencies)}")
        print(f"  Max: {max(latencies)}")
        print(f"  Std Dev: {statistics.stdev(latencies):.2f}" if len(latencies) > 1 else "  Std Dev: N/A")
    else:
        print("\nNo latency data available.")

if __name__ == "__main__":
    main()
    