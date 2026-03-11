import logging
import json
from pycrescolib.clientlib import clientlib
from pycrescolib.stunnel import StunnelDirect

def main():
    # 1. Setup logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s'
    )
    logger = logging.getLogger(__name__)

    # 2. Connection parameters (Update these to match your environment)
    host = '128.163.202.50'
    port = 8282
    service_key = '6b40d594-2253-4b57-9939-2fbdd39f3923'

    # 3. Initialize the Cresco client
    client = clientlib(host, port, service_key)
    
    if not client.connect():
        logger.error("Failed to connect to Cresco server. Please check your host, port, and service key.")
        return

    try:
        logger.info(f"Successfully connected to Cresco at {host}:{port}")

        # 4. Get global region and agent dynamically
        global_region = client.api.get_global_region()
        global_agent = client.api.get_global_agent()
        logger.info(f"Current Environment -> Region: {global_region}, Agent: {global_agent}")

        # 5. Initialize the StunnelDirect manager
        stunnel_manager = StunnelDirect(client, logger)

        # 6. Locate the Stunnel plugin ID on the current agent
        plugin_id = stunnel_manager.find_existing_stunnel_plugin(global_region, global_agent)
        
        if not plugin_id:
            logger.warning(f"No active Stunnel plugin found on agent {global_region}/{global_agent}.")
            return
            
        logger.info(f"Targeting Stunnel Plugin ID: {plugin_id}")

        # 7. Get the list of all tunnels managed by this plugin
        tunnel_list = stunnel_manager.get_tunnel_list(global_region, global_agent, plugin_id)

        if not tunnel_list:
            logger.info("No tunnels are currently configured on this agent.")
            return

        logger.info(f"Found {len(tunnel_list)} tunnel(s). Fetching details...\n")
        print("-" * 60)

        # 8. Iterate through the tunnels and fetch their status and configurations
        for tunnel in tunnel_list:
            stunnel_id = tunnel.get('stunnel_id')
            basic_status = tunnel.get('status', 'Unknown')
            
            print(f"Tunnel ID: {stunnel_id}")
            print(f"Basic Status: {basic_status}")

            # Fetch detailed status
            detailed_status = stunnel_manager.get_tunnel_status(global_region, global_agent, plugin_id, stunnel_id)
            print(f"Detailed Status: {detailed_status}")

            # Fetch detailed configuration
            tunnel_config = stunnel_manager.get_tunnel_config(global_region, global_agent, plugin_id, stunnel_id)
            print("Configuration Details:")
            print(json.dumps(tunnel_config, indent=4))
            
            print("-" * 60)

    except Exception as e:
        logger.error(f"An error occurred during execution: {e}", exc_info=True)
        
    finally:
        # 9. Always ensure the client connection is closed cleanly
        logger.info("Closing Cresco connection...")
        client.close()
        logger.info("Connection closed.")

if __name__ == "__main__":
    main()