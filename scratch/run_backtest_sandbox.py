import os
import sys
from pathlib import Path

# Add project root to python path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from kotak_algo.core.backtest_sandbox import BacktestSandbox

def main():
    print("==================================================")
    print("   KOTAKALGO HISTORICAL BACKTESTING SANDBOX")
    print("==================================================\n")
    
    sandbox = BacktestSandbox()
    
    print("Starting NIFTY Straddle Backtest simulation for 2026-06-08...")
    print("Driving simulation minute-by-minute (09:15 to 15:30)...")
    
    report = sandbox.run_simulation(date_str="2026-06-08")
    
    if "error" in report:
        print(f"\n❌ Backtest failed: {report['error']}")
        return
        
    print("\n==================================================")
    print("              SIMULATION REPORT SUMMARY")
    print("==================================================")
    print(f"Target Date         : {report['date']}")
    print(f"Final Profit/Loss   : Rs. {report['final_pnl']}")
    print(f"Executed Orders Qty : {report['executed_orders_count']}")
    
    print("\n[Strategy Events]:")
    for ev in report["sim_events"]:
        print(f" - [{ev['timestamp']}] {ev['event'].upper()}:")
        for key, val in ev["details"].items():
            print(f"      {key:8s}: {val}")
            
    print("\n[Executed Orders Audit Trail]:")
    for idx, order in enumerate(report["orders"]):
        print(f" {idx+1:2d}. Order ID: {order['order_id']}")
        print(f"     Symbol  : {order['trading_symbol']}")
        print(f"     Action  : {order['transaction_type']} | Qty: {order['quantity']}")
        print(f"     Fill Px : Rs. {order['fill_price']}")
        
    print("\n==================================================")
    print("         LOCAL BACKTEST COMPLETED SUCCESSFULLY")
    print("==================================================")

if __name__ == "__main__":
    main()
