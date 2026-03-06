from pycrescolib.clientlib import clientlib
from stunnel_cadl import StunnelCADL
from stunnel_direct import StunnelDirect
import logging

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger()

# Connection parameters
host = '128.163.202.61'
port = 8282
service_key = '6b40d594-2253-4b57-9939-2fbdd39f3923'

# Connect to Cresco
client = clientlib(host, port, service_key)
if client.connect():
    client.agents.remove_plugin_agent('model-tunnel-region', 'model-tunnel-global-controller', "system-27ca9025-dcb9-412d-a832-90b02361cf66")