from pycrescolib.clientlib import clientlib
from pycrescolib.haproxy import HAProxyDeployer
from pycrescolib.stunnel import StunnelDirect
from pycrescolib.globalcontroller import globalcontroller

cl = clientlib("128.163.202.61", 8282, "6b40d594-2253-4b57-9939-2fbdd39f3923")
cl.connect()

stunnel_manager = StunnelDirect(cl)

if cl.connected():
    print("Connected to Cresco")
else:
    print("Not connected to Cresco")

agent_list = cl.globalcontroller.get_agent_list()
pipeline_info = cl.globalcontroller.get_pipeline_list()

for agent in agent_list:
    print(agent)

    plugin_id = stunnel_manager.find_existing_stunnel_plugin(agent["region_id"], agent["agent_id"])
    if plugin_id:
        tunnel_list = stunnel_manager.get_tunnel_list(agent["region_id"], agent["agent_id"], plugin_id)
        for tunnel in tunnel_list:
            print(f'TUNNEL LIST: {tunnel}')
            response = cl.globalcontroller.remove_pipeline(tunnel["stunnel_id"])
            print(f'REMOVE PIPELINE RESPONSE: {response}')

