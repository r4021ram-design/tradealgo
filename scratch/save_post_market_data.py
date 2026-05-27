import os
import sys
import time
import json
import csv
from datetime import datetime
from pathlib import Path

# Add project root to python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kotak_algo.utils.config_loader import load_config
from kotak_algo.broker.neo_client import NeoBrokerClient

def main():
    # Calculate sleep time until 15:30:30
    now = datetime.now()
    target = now.replace(hour=15, minute=30, second=30, microsecond=0)
    
    if now < target:
        sleep_seconds = (target - now).total_seconds()
        print(f"Current time: {now.strftime('%H:%M:%S')}. Target time: {target.strftime('%H:%M:%S')}.")
        print(f"Sleeping for {sleep_seconds:.1f} seconds (~{sleep_seconds/60:.1f} minutes) until market closes...")
        time.sleep(sleep_seconds)
    else:
        print(f"Current time is {now.strftime('%H:%M:%S')}, which is after market close ({target.strftime('%H:%M:%S')}). Running immediately.")

    print("\nInitializing Neo broker client and authenticating...")
    config_path = Path("kotak_algo/config.yaml")
    config = load_config(config_path)
    broker = NeoBrokerClient(config["broker"])
    broker.authenticate()
    
    date_str = datetime.now().strftime("%Y-%m-%d")
    output_dir = Path("data/post_market_data") / date_str
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"Saving data to directory: {output_dir.resolve()}")
    
    # 1. Fetch and save positions
    print("\nFetching positions...")
    try:
        positions = broker.positions()
        # Save JSON
        with open(output_dir / "positions.json", "w", encoding="utf-8") as f:
            json.dump(positions, f, indent=2)
        print("Saved positions.json")
        
        # Save CSV
        if isinstance(positions, dict) and "data" in positions:
            pos_list = positions["data"]
        elif isinstance(positions, list):
            pos_list = positions
        else:
            pos_list = []
            
        if pos_list:
            keys = pos_list[0].keys()
            with open(output_dir / "positions.csv", "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=keys)
                writer.writeheader()
                writer.writerows(pos_list)
            print(f"Saved {len(pos_list)} positions to positions.csv")
    except Exception as e:
        print(f"Failed to fetch/save positions: {e}")

    # 2. Fetch and save trades
    print("\nFetching trades...")
    try:
        trades = broker.trade_report()
        with open(output_dir / "trades.json", "w", encoding="utf-8") as f:
            json.dump(trades, f, indent=2)
        print("Saved trades.json")
        
        if isinstance(trades, dict) and "data" in trades:
            trade_list = trades["data"]
        elif isinstance(trades, list):
            trade_list = trades
        else:
            trade_list = []
            
        if trade_list:
            keys = trade_list[0].keys()
            with open(output_dir / "trades.csv", "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=keys)
                writer.writeheader()
                writer.writerows(trade_list)
            print(f"Saved {len(trade_list)} trades to trades.csv")
        else:
            print("No trades executed today.")
    except Exception as e:
        print(f"Failed to fetch/save trades: {e}")

    # 3. Fetch and save orders
    print("\nFetching orders...")
    try:
        orders = broker.order_report()
        with open(output_dir / "orders.json", "w", encoding="utf-8") as f:
            json.dump(orders, f, indent=2)
        print("Saved orders.json")
        
        if isinstance(orders, dict) and "data" in orders:
            order_list = orders["data"]
        elif isinstance(orders, list):
            order_list = orders
        else:
            order_list = []
            
        if order_list:
            keys = order_list[0].keys()
            with open(output_dir / "orders.csv", "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=keys)
                writer.writeheader()
                writer.writerows(order_list)
            print(f"Saved {len(order_list)} orders to orders.csv")
    except Exception as e:
        print(f"Failed to fetch/save orders: {e}")

    # 4. Fetch and save limits / margin
    print("\nFetching limits...")
    try:
        limits = broker.limits()
        with open(output_dir / "limits.json", "w", encoding="utf-8") as f:
            json.dump(limits, f, indent=2)
        print("Saved limits.json")
        
        # Format limits to CSV if dict
        if isinstance(limits, dict):
            # Check if there is data
            lim_data = limits.get("data", [limits])
            if isinstance(lim_data, dict):
                lim_data = [lim_data]
            if lim_data:
                keys = lim_data[0].keys()
                with open(output_dir / "limits.csv", "w", newline="", encoding="utf-8") as f:
                    writer = csv.DictWriter(f, fieldnames=keys)
                    writer.writeheader()
                    writer.writerows(lim_data)
                print("Saved limits.csv")
    except Exception as e:
        print(f"Failed to fetch/save limits: {e}")

    print("\nAll post-market data successfully saved!")

if __name__ == "__main__":
    main()
