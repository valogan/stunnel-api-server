import requests

base_url = "http://128.163.202.61:8000"
tunnel_id = "797f34e8-196a-11f1-b6c2-4efea2581352" # Using the one from test_config
plugin_id = "system-27ca9025-dcb9-412d-a832-90b02361cf66"
region = "model-tunnel-region"
agent = "model-tunnel-global-controller"

params = {
    "src_region": region,
    "src_agent": agent,
    "src_plugin_id": plugin_id
}

print("Testing Status endpoint...")
try:
    r_status = requests.get(f"{base_url}/tunnels/{tunnel_id}/status", params=params, timeout=5)
    print("STATUS CODE:", r_status.status_code)
    print("RESPONSE:", r_status.text)
except Exception as e:
    print("STATUS ERROR:", e)

print("\nTesting Config endpoint...")
try:
    r_config = requests.get(f"{base_url}/tunnels/{tunnel_id}/config", params=params, timeout=5)
    print("CONFIG CODE:", r_config.status_code)
    print("RESPONSE:", r_config.text)
except Exception as e:
    print("CONFIG ERROR:", e)
    
print("\nTesting get tunnels endpoint...")
try:
    r_tunnels = requests.get(f"{base_url}/tunnels", timeout=5)
    print("TUNNELS CODE:", r_tunnels.status_code)
except Exception as e:
    print("TUNNELS ERROR:", e)

