import asyncio
import configparser
import logging
import json
from pycrescolib.clientlib import clientlib

logging.basicConfig(level=logging.INFO)

config = configparser.ConfigParser()
config.read('config.ini')
host = '128.163.202.61'
port = 8282
service_key = config.get('general', 'service_key')

client = clientlib(host, port, service_key)

def log_callback(message):
    try:
        lower_msg = message.lower()
        if "stunnel" in lower_msg or "byte" in lower_msg or "traffic" in lower_msg or "perf" in lower_msg:
            with open("traffic_logs.txt", "a") as f:
                f.write(message + "\n")
    except Exception as e:
        print(f"Error logging: {e}")

async def main():
    if not client.connect():
        print("Failed to connect to Cresco")
        return
        
    print("Connected to Cresco. Starting logstreamer...")
    
    # We need to initialize the logstreamer manually assuming clientlib doesn't auto-start it
    # or get the existing one.
    logstream = client.get_logstreamer(callback=log_callback)
    logstream.connect()
    
    # Subscribe to all active agents' logs
    try:
        agents = client.globalcontroller.get_agent_list()
        print(f"Subscribing to {len(agents)} agents...")
        for agent in agents:
            r = agent.get('region') or agent.get('region_id')
            a = agent.get('agent') or agent.get('agent_id')
            if r and a:
                print(f"Subscribing to {r}/{a}")
                logstream.update_config(r, a)
    except Exception as e:
        print(f"Error subscribing: {e}")
        
    print("Waiting for logs (press Ctrl+C to stop)...")
    try:
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        logstream.close()
        client.close()

if __name__ == "__main__":
    asyncio.run(main())
