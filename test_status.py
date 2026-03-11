import configparser
from pycrescolib.clientlib import clientlib
from stunnel_direct import StunnelDirect
import json

config = configparser.ConfigParser()
config.read('config.ini')
host = '128.163.202.61'
port = 8282
service_key = config.get('general', 'service_key')

client = clientlib(host, port, service_key)
if client.connect():
    print("Connected")
    stunnel_manager = StunnelDirect(client)
    
    # Get any active tunnel to test
    tunnels = None
    agents = client.globalcontroller.get_agent_list()
    for agent in agents:
        r = agent.get('region') or agent.get('region_id')
        a = agent.get('agent') or agent.get('agent_id')
        p = stunnel_manager.find_existing_stunnel_plugin(r, a)
        if p:
            print(f"Checking {r}/{a}/{p}")
            tunnels = stunnel_manager.get_tunnel_list(r, a, p)
            if tunnels:
                print(f"Found tunnels: {json.dumps(tunnels, indent=2)}")
                for t_info in tunnels:
                    t_id = t_info['stunnel_id']
                    print(f"Trying to get config for {t_id}")
                    # get_tunnel_config(src_region, src_agent, src_plugin_id, stunnel_id)
                    config_data = stunnel_manager.get_tunnel_config(r, a, p, t_id)
                    print(f"CONFIG: {json.dumps(config_data, indent=2)}")
                break

    client.close()
else:
    print("Failed")
