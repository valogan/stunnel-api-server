import json
import logging
from pycrescolib.clientlib import clientlib
from pycrescolib.utils import decompress_param

logging.basicConfig(level=logging.INFO)

host = '128.163.202.61' 
port = 8282
service_key = '6b40d594-2253-4b57-9939-2fbdd39f3923' 

client = clientlib(host, port, service_key)
if client.connect():
    try:
        global_region = client.api.get_global_region()
        global_agent = client.api.get_global_agent()
        
        plugins = client.agents.list_plugin_agent(global_region, global_agent)
        stunnel_plugin_id = None
        for p in plugins:
            if p.get("pluginname") == "io.cresco.stunnel":
                stunnel_plugin_id = p.get("plugin_id")
                break
        
        if stunnel_plugin_id:
            msg_payload = {'action': 'listtunnels'}
            result = client.messaging.global_plugin_msgevent(True, 'EXEC', msg_payload, global_region, global_agent, stunnel_plugin_id)
            if 'tunnels' in result:
                tunnels = json.loads(result['tunnels'])
                if tunnels:
                    tunnel_id = tunnels[0]['stunnel_id']
                    print(f"Testing tunnel_id {tunnel_id}")
                    
                    # Test gettunnelconfig
                    msg_payload = {'action': 'gettunnelconfig', 'action_stunnel_id': tunnel_id}
                    r2 = client.messaging.global_plugin_msgevent(True, 'EXEC', msg_payload, global_region, global_agent, stunnel_plugin_id)
                    
                    if 'tunnel_config' in r2:
                        raw_config = r2['tunnel_config']
                        print("RAW CONFIG:", raw_config)
                        try:
                            parsed = json.loads(raw_config)
                            print("PARSED:", parsed)
                        except Exception as e:
                            print("JSON LOADS FAILED:", type(e), e)
    finally:
        client.close()
else:
    print("Failed to connect")
