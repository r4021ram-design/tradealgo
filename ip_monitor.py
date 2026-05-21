import requests
import time
import os

# File to store the last known IP
IP_FILE = "last_known_ip.txt"
ENV_PATH = "kotak_algo/.env"

def load_env():
    """Manually loads telegram credentials from .env file with better parsing."""
    env_vars = {}
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH, 'r') as f:
            for line in f:
                line = line.strip()
                if '=' in line and not line.startswith('#'):
                    key, value = line.split('=', 1)
                    # Remove potential quotes or spaces
                    env_vars[key.strip()] = value.strip().strip('"').strip("'")
    return env_vars

def send_telegram_msg(message):
    """Sends a message to the Telegram bot and prints status."""
    env = load_env()
    token = env.get("TELEGRAM_BOT_TOKEN")
    chat_id = env.get("TELEGRAM_CHAT_ID")
    
    if not token or not chat_id:
        print("⚠️ Warning: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing in .env")
        return

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {"chat_id": chat_id, "text": message, "parse_mode": "HTML"}
    
    try:
        response = requests.post(url, json=payload, timeout=10)
        if response.status_code == 200:
            print(f"[{time.strftime('%H:%M:%S')}] Telegram alert sent successfully.")
        else:
            print(f"[{time.strftime('%H:%M:%S')}] Telegram Error: {response.text}")
    except Exception as e:
        print(f"Failed to send Telegram alert: {e}")

def get_current_public_ip():
    """Fetches the current public IP address."""
    try:
        response = requests.get('https://api.ipify.org', timeout=10)
        return response.text.strip()
    except Exception as e:
        return f"Error: {e}"

def load_last_ip():
    """Loads the last recorded IP from the file."""
    if os.path.exists(IP_FILE):
        with open(IP_FILE, 'r') as f:
            return f.read().strip()
    return None

def save_current_ip(ip):
    """Saves the current IP to the file."""
    with open(IP_FILE, 'w') as f:
        f.write(ip)

def monitor():
    print("--- IP Monitor with Telegram Started ---")
    
    # Initialize
    last_ip = load_last_ip()
    current_ip = get_current_public_ip()
    
    # Always send a startup message to confirm it's working
    status_msg = "✅" if current_ip == last_ip else "⚠️"
    msg = (f"🚀 <b>IP Monitor Active</b>\n"
           f"Status: {'IP is same' if current_ip == last_ip else 'IP CHANGED'}\n"
           f"Current IP: <code>{current_ip}</code>")
    
    if last_ip is None:
        print(f"First run. Current IP is: {current_ip}")
        save_current_ip(current_ip)
    elif current_ip != last_ip:
        msg = (f"⚠️ <b>IP ADDRESS CHANGED!</b>\n\n"
               f"<b>Old IP:</b> <code>{last_ip}</code>\n"
               f"<b>New IP:</b> <code>{current_ip}</code>\n\n"
               f"Update whitelist immediately!")
        print(f"⚠️ IP CHANGED: {last_ip} -> {current_ip}")
        save_current_ip(current_ip)
    else:
        print(f"Current IP matches last known: {current_ip}")

    # Send the confirmation message
    send_telegram_msg(msg)

    print("\nMonitoring for changes every 5 minutes...")
    print("Press Ctrl+C to stop.")

    try:
        while True:
            time.sleep(300) # Wait 5 minutes
            new_check = get_current_public_ip()
            
            if "Error" in new_check:
                print(f"[{time.strftime('%H:%M:%S')}] Connection Error. Retrying...")
                continue

            if new_check != current_ip:
                print("\n" + "!"*40)
                print(f"⚠️ ALERT: IP ADDRESS CHANGED!")
                print(f"LAST IP: {current_ip}")
                print(f"NEW IP:  {new_check}")
                print("!"*40 + "\n")
                
                msg = (f"⚠️ <b>IP ADDRESS CHANGED!</b>\n\n"
                       f"<b>TIME:</b> {time.strftime('%Y-%m-%d %H:%M:%S')}\n"
                       f"<b>LAST IP:</b> <code>{current_ip}</code>\n"
                       f"<b>NEW IP:</b>  <code>{new_check}</code>\n\n"
                       f"Update whitelist immediately!")
                send_telegram_msg(msg)
                
                # Update records
                current_ip = new_check
                save_current_ip(new_check)
            else:
                print(f"[{time.strftime('%H:%M:%S')}] No change. IP is still {current_ip}")

                
    except KeyboardInterrupt:
        print("\nMonitor stopped by user.")

if __name__ == "__main__":
    monitor()

