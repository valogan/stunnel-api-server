import json
import logging
import uuid

from pycrescolib.clientlib import clientlib
from stunnel_cadl import StunnelCADL
from stunnel_direct import StunnelDirect

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger()

# Connection parameters
host = 'localhost'
port = 8282
service_key = '6b40d594-2253-4b57-9939-2fbdd39f3923'

# Connect to Cresco
client = clientlib(host, port, service_key)
if client.connect():

    try:
        logger.info(f"Connected to Cresco at {host}:{port}")

        # Get global region and agent
        global_region = client.api.get_global_region()
        global_agent = client.api.get_global_agent()
        logger.info(f"Global region: {global_region}, Global agent: {global_agent}")

        # Initialize the tunnel testers
        stunnel_direct_tester = StunnelDirect(client, logger)
        #stunnel_cadl_tester = StunnelCADL(client, logger)

        # Example 1: Create a tunnel using existing system plugins

        stunnel_id_1 = str(uuid.uuid1())
        saved_stunnel_config = stunnel_direct_tester.create_tunnel(stunnel_id_1, 'model-tunnel-region', 'model-tunnel-global-controller', '8010',
                                     'model-tunnel-region', 'model-tunnel-agent-1', '127.0.0.1', '8005',
                                     '8192')

        # we won't use the saved config, we will just reference the source region/agent and determine the system stunnel plugin
        stunnel_plugin_id = stunnel_direct_tester.find_existing_stunnel_plugin(global_region, global_agent)

        # get list of tunnels
        tunnel_list = stunnel_direct_tester.get_tunnel_list(global_region, global_agent, stunnel_plugin_id)

        # iterate tunnels
        for stunnel in tunnel_list:
            # get id from list
            stunnel_id = stunnel['stunnel_id']
            # get status from list
            stunnel_status = stunnel['status']
            logger.info(stunnel_id)
            logger.info(stunnel_status)

            # get status
            returned_tunnel_status = stunnel_direct_tester.get_tunnel_status(global_region, global_agent, stunnel_plugin_id, stunnel_id)
            logger.info(returned_tunnel_status)

            #get the original config that should match saved_stunnel_config
            returned_stunnel_config = stunnel_direct_tester.get_tunnel_config(global_region, global_agent, stunnel_plugin_id, stunnel_id)
            logger.info(returned_stunnel_config)
        


        '''
        # Example 2: Create a tunnel using CADL deployment
        stunnel_id_2 = str(uuid.uuid1())
        stunnel_cadl_tester.create_tunnel(stunnel_id_2, global_region, global_agent, '3333',
                                     global_region, global_agent, '192.168.4.249', '3331',
                                     '8192')
        '''

    except Exception as e:
        logger.error(f"Error: {e}")
    finally:
        # Always close the client when done
        logger.info("Closing Cresco connection")
        client.close()
else:
    logger.error("Failed to connect to Cresco server")
