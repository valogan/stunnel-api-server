import json
import logging
import os
import time
import uuid
from typing import Dict, Any
from urllib import request

from pycrescolib.clientlib import clientlib
from pycrescolib.utils import decompress_param

class HAProxyDeployer:
    def __init__(self, client, logger=None):
        """
        Initialize the HAProxyDeployer class with a Cresco client
        """
        self.client = client
        if logger:
            self.logger = logger
        else:
            logging.basicConfig(level=logging.INFO)
            self.logger = logging.getLogger(__name__)

    def get_plugin_from_git(self, src_url: str, force: bool = False) -> str:
        """Download plugin JAR file from GitHub."""
        dst_file = src_url.rsplit('/', 1)[1]
        
        # Ensure plugins directory exists
        os.makedirs("plugins", exist_ok=True)
        dst_path = os.path.join("plugins", dst_file)

        if force or not os.path.exists(dst_path):
            self.logger.info(f"Downloading {dst_file} plugin from {src_url}")
            try:
                request.urlretrieve(src_url, dst_path)
                self.logger.info(f"Downloaded {dst_file} successfully")
            except Exception as e:
                self.logger.error(f"Failed to download {dst_file}: {e}")
                raise
        else:
            self.logger.info(f"Using existing plugin file: {dst_path}")

        return dst_path

    def upload_plugin(self, jar_path: str) -> Dict[str, Any]:
        """Upload a plugin to the global controller."""
        self.logger.info(f"Uploading plugin {jar_path} to global controller")
        try:
            reply = self.client.globalcontroller.upload_plugin_global(jar_path)
            self.logger.info(f"Upload status: {reply.get('status_code', 'unknown')}")
            return reply
        except Exception as e:
            self.logger.error(f"Error uploading plugin: {e}")
            raise

    def wait_for_pipeline(self, pipeline_id: str, target_status: int = 10, timeout: int = 60) -> bool:
        """Wait for pipeline to reach desired status."""
        start_time = time.time()
        while time.time() - start_time < timeout:
            try:
                status = self.client.globalcontroller.get_pipeline_status(pipeline_id)
                if status == target_status:
                    self.logger.info(f"Pipeline {pipeline_id} reached status {target_status}")
                    return True

                self.logger.info(f"Waiting for pipeline {pipeline_id} to reach status {target_status}, current: {status}")
                time.sleep(2)
            except Exception as e:
                self.logger.error(f"Error checking pipeline status: {e}")
                time.sleep(2)

        self.logger.error(f"Timeout waiting for pipeline {pipeline_id} to reach status {target_status}")
        return False

    def deploy_haproxy_plugin(self, target_region: str, target_agent: str, jar_url: str) -> str:
        """Downloads, uploads, and deploys the HAProxy plugin to a target agent."""
        self.logger.info(f"Deploying HAProxy plugin to {target_region}/{target_agent}")

        try:
            # 1. Download and upload plugin
            jar_file_path = self.get_plugin_from_git(jar_url)
            reply = self.upload_plugin(jar_file_path)

            # Get plugin configuration
            config_str = decompress_param(reply['configparams'])
            self.logger.info(f"Plugin config: {config_str}")
            configparams = json.loads(config_str)

            # 2. Deploy the plugin to the agent
            
            pipeline_name = f"haproxy-deploy-{uuid.uuid4().hex[:8]}"

            cadl = {
                'pipeline_id': '0',
                'pipeline_name': pipeline_name,
                'nodes': [],
                'edges': []
            }

            params = {
                'pluginname': configparams['pluginname'],
                'md5': configparams['md5'],
                'version': configparams['version'],
                'location_region': target_region,
                'location_agent': target_agent,
            }

            node = {
                'type': 'dummy',
                'node_name': 'HAProxy Plugin',
                'node_id': 0,
                'isSource': False,
                'workloadUtil': 0,
                'params': params
            }

            cadl['nodes'].append(node)

            # Submit pipeline
            reply = self.client.globalcontroller.submit_pipeline(cadl)
            pipeline_id = reply['gpipeline_id']

            self.logger.info(f"Pipeline submitted: {pipeline_id}. Waiting for it to come online...")

            # Wait for pipeline to come online
            is_online = self.wait_for_pipeline(pipeline_id)
            if is_online:
                self.logger.info(f"HAProxy Plugin deployed successfully to {target_region}/{target_agent}")
                return pipeline_id
            else:
                self.logger.error("HAProxy Plugin deployment failed")
                return None

        except Exception as e:
            self.logger.error(f"Error in deploy_haproxy_plugin: {e}", exc_info=True)
            return None


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger()

    # Connection parameters
    host = '128.163.202.61'
    port = 8282
    service_key = '6b40d594-2253-4b57-9939-2fbdd39f3923'

    client = clientlib(host, port, service_key)
    if client.connect():
        try:
            logger.info(f"Connected to Cresco at {host}:{port}")

            # Get global region and agent for local testing
            global_region = client.api.get_global_region()
            global_agent = client.api.get_global_agent()
            logger.info(f"Global region: {global_region}, Global agent: {global_agent}")

            deployer = HAProxyDeployer(client, logger)
            jar_url = "https://github.com/valogan/cresco-haproxy-plugin/releases/download/third/haproxy-1.2-SNAPSHOT.jar"

            # Deploy to the global agent
            pipeline_id = deployer.deploy_haproxy_plugin(global_region, global_agent, jar_url)

            if pipeline_id:
                # Retrieve the plugin ID that was assigned to our deployed HAProxy plugin
                # It will dynamically fetch the correct pipeline config
                pipeline_config = client.globalcontroller.get_pipeline_info(pipeline_id)
                plugin_id = pipeline_config['nodes'][0]['node_id']

            logger.info(f"HAProxy Plugin ID is: {plugin_id}")

            # Example: Configure HAProxy to listen on 8048 and proxy to 8874 on model-tunnel-global-controller
            
            haproxy_config = """
global
    log 127.0.0.1 local0
    maxconn 4096

defaults
    log     global
    mode    tcp
    option  tcplog
    option  dontlognull
    retries 3
    timeout connect 5000
    timeout client  50000
    timeout server  50000

frontend my_proxy
    bind *:8048
    default_backend tunnel_backend

backend tunnel_backend
    server s1 127.0.0.1:8874 check
"""
            logger.info("Sending configuration to HAProxy plugin...")
            
            # Send the configuration payload
            config_result = client.messaging.global_plugin_msgevent(True, 'CONFIG', {
                'action': 'build_config',
                'haproxy_config_data': haproxy_config
            }, global_region, global_agent, plugin_id)
            
            logger.info(f"Config Setup Result: {config_result}")

            # Start the HAProxy service
            logger.info("Starting HAProxy service...")
            start_result = client.messaging.global_plugin_msgevent(True, 'CONFIG', {
                'action': 'start_haproxy'
            }, global_region, global_agent, plugin_id)

            logger.info(f"Start Service Result: {start_result}")

        except Exception as e:
            logger.error(f"Error: {e}")
        finally:
            logger.info("Closing Cresco connection")
            client.close()
    else:
        logger.error("Failed to connect to Cresco server")
