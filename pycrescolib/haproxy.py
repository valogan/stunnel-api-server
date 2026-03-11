import json
import logging
import os
import time
import uuid
from typing import Dict, Any
from urllib import request

from .utils import decompress_param


class HAProxyDeployer:
    def __init__(self, client, logger=None):
        self.client = client
        if logger:
            self.logger = logger
        else:
            logging.basicConfig(level=logging.INFO)
            self.logger = logging.getLogger(__name__)

    def get_plugin_from_git(self, src_url: str, force: bool = False) -> str:
        dst_file = src_url.rsplit('/', 1)[1]
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
        self.logger.info(f"Uploading plugin {jar_path} to global controller")
        try:
            reply = self.client.globalcontroller.upload_plugin_global(jar_path)
            self.logger.info(f"Upload status: {reply.get('status_code', 'unknown')}")
            return reply
        except Exception as e:
            self.logger.error(f"Error uploading plugin: {e}")
            raise

    def wait_for_pipeline(self, pipeline_id: str, target_status: int = 10, timeout: int = 60) -> bool:
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
        self.logger.info(f"Deploying HAProxy plugin to {target_region}/{target_agent}")

        try:
            jar_file_path = self.get_plugin_from_git(jar_url)
            reply = self.upload_plugin(jar_file_path)

            config_str = decompress_param(reply['configparams'])
            self.logger.info(f"Plugin config: {config_str}")
            configparams = json.loads(config_str)

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

            reply = self.client.globalcontroller.submit_pipeline(cadl)
            pipeline_id = reply['gpipeline_id']

            self.logger.info(f"Pipeline submitted: {pipeline_id}. Waiting for it to come online...")

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
