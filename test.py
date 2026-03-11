from pycrescolib.clientlib import clientlib
import json

# Connect to a Cresco environment
host = '128.163.202.61'          # Hostname of the agent global controller with the wsapi plugin
port = 8282                 # Default port for wsapi
service_key = '6b40d594-2253-4b57-9939-2fbdd39f3923'  # Service key for authentication

def custom_dp_callback(message):
    # Process data plane messages
    try:
        data = json.loads(message)
        print("Received data:", data)
        # Perform custom processing
    except:
        print("Raw message:", message)


# Initialize the client
client = clientlib(host, port, service_key)

# Connect to the wsapi plugin
if client.connect():
    print("Connected to Cresco")
    
    # plugins = client.agents.list_plugin_agent("model-tunnel-region", 'model-tunnel-global-controller')
    # print(json.dumps(plugins, indent=4))


    dp = client.get_dataplane('bandwidth', custom_dp_callback)
    dp.connect()

    
    # Close connection when done
    client.close()
else:
    print("Failed to connect")