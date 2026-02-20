import logging

from pycrescolib.clientlib import clientlib
import configparser

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger()

# Connection parameters
config = configparser.ConfigParser()
config.read('config.ini')
host = config.get('general', 'host')
port = config.get('general', 'port')
service_key = config.get('general', 'service_key')
# Connect to Cresco
client = clientlib(host, port, service_key)
if client.connect():

    try:
        logger.info(f"Connected to Cresco at {host}:{port}")
        import json
        # Get global region and agent
        global_region = client.api.get_global_region()
        global_agent = client.api.get_global_agent()
        logger.info(f"Global region: {global_region}, Global agent: {global_agent}")
        logger.info(f"global info: {client.api.get_global_info()}")
        agents = client.globalcontroller.get_agent_list()
        for agent in agents:
            status_desc = agent['status_desc']
            if status_desc == '{"mode":"GLOBAL"}':
                continue
            agent_id = agent['agent_id']
            region_id = agent['region_id']
            client.admin.restartcontroller(region_id, agent_id)

        
    except Exception as e:
        logger.error(f"Error: {e}")
    finally:
        # Always close the client when done
        logger.info("Closing Cresco connection")
        client.close()
else:
    logger.error("Failed to connect to Cresco server")