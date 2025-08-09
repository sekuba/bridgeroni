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
    # 1. Raw event counts for StargateV2 and LayerZero events
    event_types = [
        "StargatePool_OFTSent",
        "StargatePool_OFTReceived", 
        "EndpointV2_PacketSent",
        "EndpointV2_PacketDelivered"
    ]
    print("Raw event counts:")
    for et in event_types:
        query = f"query {{ {et} {{ id }} }}"
        try:
            rows = run_query(query)[et]
            print(f"  {et}: {len(rows)}")
        except Exception as e:
            print(f"  {et}: Error - {e}")

    # 2. CrosschainMessage analysis for LayerZero protocol
    query = """
    query {
      CrosschainMessage(where: {protocol: {_eq: "layerzero"}}) {
        id
        chainIdOutbound
        chainIdInbound
        fromOutbound
        toInbound
        matched
        latency
      }
    }
    """
    layerzero_msgs = run_query(query)["CrosschainMessage"]
    matched_msgs = [msg for msg in layerzero_msgs if msg["matched"]]
    print(f"\nLayerZero CrosschainMessages: {len(layerzero_msgs)}")
    print(f"Matched LayerZero CrosschainMessages: {len(matched_msgs)}")

    # 3. StargateV2 AppPayload analysis
    query = """
    query {
      AppPayload(where: {appName: {_eq: "StargateV2"}}) {
        id
        sender
        recipient
        amountOutbound
        amountInbound
        transportingMsgId
      }
    }
    """
    try:
        stargate_payloads = run_query(query)["AppPayload"]
        print(f"\nStargateV2 AppPayloads: {len(stargate_payloads)}")
        
        # Calculate volume statistics
        outbound_amounts = [int(p["amountOutbound"]) for p in stargate_payloads if p["amountOutbound"] is not None]
        inbound_amounts = [int(p["amountInbound"]) for p in stargate_payloads if p["amountInbound"] is not None]
        
        if outbound_amounts:
            print(f"\nOutbound Volume Statistics:")
            print(f"  Count: {len(outbound_amounts)}")
            print(f"  Total: {sum(outbound_amounts)}")
            print(f"  Average: {statistics.mean(outbound_amounts):.2f}")
            print(f"  Median: {statistics.median(outbound_amounts):.2f}")
            
        if inbound_amounts:
            print(f"\nInbound Volume Statistics:")
            print(f"  Count: {len(inbound_amounts)}")
            print(f"  Total: {sum(inbound_amounts)}")
            print(f"  Average: {statistics.mean(inbound_amounts):.2f}")
            print(f"  Median: {statistics.median(inbound_amounts):.2f}")
            
    except Exception as e:
        print(f"\nStargateV2 AppPayload analysis error: {e}")

    # 4. EID (Endpoint ID) to EID routing statistics
    eid_combos = {}
    stargate_sent_query = """
    query {
      StargatePool_OFTSent {
        chainId
        dstEid
        amountSentLD
      }
    }
    """
    try:
        sent_events = run_query(stargate_sent_query)["StargatePool_OFTSent"]
        for event in sent_events:
            src_eid = str(event["chainId"])
            dst_eid = str(event["dstEid"])
            key = f"{src_eid}->{dst_eid}"
            if key not in eid_combos:
                eid_combos[key] = {"count": 0, "volume": 0}
            eid_combos[key]["count"] += 1
            eid_combos[key]["volume"] += int(event["amountSentLD"])
        
        print("\nSource EID -> Destination EID ranking:")
        for combo, stats in sorted(eid_combos.items(), key=lambda x: -x[1]["count"]):
            print(f"  {combo}: {stats['count']} transfers, volume: {stats['volume']}")
            
    except Exception as e:
        print(f"\nEID routing analysis error: {e}")

    # 5. Latency statistics for matched LayerZero messages
    latencies = [int(msg["latency"]) for msg in matched_msgs if msg["latency"] is not None]
    if latencies:
        print("\nLayerZero Latency statistics (seconds):")
        print(f"  Count: {len(latencies)}")
        print(f"  Average: {statistics.mean(latencies):.2f}")
        print(f"  Median: {statistics.median(latencies):.2f}")
        print(f"  Min: {min(latencies)}")
        print(f"  Max: {max(latencies)}")
        print(f"  Std Dev: {statistics.stdev(latencies):.2f}" if len(latencies) > 1 else "  Std Dev: N/A")
    else:
        print("\nNo LayerZero latency data available.")

    # 6. GUID matching analysis
    query = """
    query {
      StargatePool_OFTSent {
        guid
        chainId
        dstEid
      }
    }
    """
    try:
        sent_guids = {event["guid"]: f"{event['chainId']}->{event['dstEid']}" 
                     for event in run_query(query)["StargatePool_OFTSent"]}
        
        query = """
        query {
          StargatePool_OFTReceived {
            guid
            chainId
            srcEid
          }
        }
        """
        received_guids = {event["guid"]: f"{event['srcEid']}->{event['chainId']}" 
                         for event in run_query(query)["StargatePool_OFTReceived"]}
        
        matched_guids = set(sent_guids.keys()) & set(received_guids.keys())
        print(f"\nGUID Matching Analysis:")
        print(f"  OFTSent GUIDs: {len(sent_guids)}")
        print(f"  OFTReceived GUIDs: {len(received_guids)}")
        print(f"  Matched GUIDs: {len(matched_guids)}")
        print(f"  Match rate: {len(matched_guids)/max(len(sent_guids), 1)*100:.1f}%")
        
    except Exception as e:
        print(f"\nGUID matching analysis error: {e}")

if __name__ == "__main__":
    main()