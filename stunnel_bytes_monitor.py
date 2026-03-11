import json
import time
import logging
from pycrescolib.clientlib import clientlib

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class ThroughputMonitor:
    def __init__(self, sample_interval=1.0):
        """
        Initialize throughput monitor
        
        Args:
            sample_interval: Interval in seconds between throughput reports
        """
        self.bytes_received = 0
        self.last_report_time = time.time()
        self.sample_interval = sample_interval
        self.total_bytes = 0
        
    def binary_callback(self, data):
        """Track received binary data and calculate bytes per second"""
        self.bytes_received += len(data)
        self.total_bytes += len(data)
        
        current_time = time.time()
        elapsed = current_time - self.last_report_time
        
        # Report throughput every sample_interval seconds
        if elapsed >= self.sample_interval:
            bytes_per_second = self.bytes_received / elapsed
            logger.info(f"Throughput: {bytes_per_second:.2f} bytes/sec | "
                       f"Total: {self.total_bytes} bytes | "
                       f"Messages: {self.bytes_received} bytes in {elapsed:.2f}s")
            
            self.bytes_received = 0
            self.last_report_time = current_time
    
    def text_callback(self, message):
        """Handle text messages"""
        try:
            json_msg = json.loads(message)
            logger.debug(f"Text message: {json.dumps(json_msg, indent=2)}")
        except json.JSONDecodeError:
            logger.debug(f"Text message: {message}")

# Connect to Cresco and monitor throughput
if __name__ == "__main__":
    # Create monitor
    monitor = ThroughputMonitor(sample_interval=1.0)
    
    # Connect to your Cresco server through stunnel
    client = clientlib("128.163.202.61", 8282, "6b40d594-2253-4b57-9939-2fbdd39f3923")  # Adjust host/port for stunnel
    
    if client.connect():
        logger.info("Connected to Cresco server")
        
        # Configure dataplane stream
        dp_config = {
            'ident_key': 'stream_name',
            'ident_id': '1234',
            'io_type_key': 'type',
            'output_id': 'output',
            'input_id': 'output'
        }
        stream_name = json.dumps(dp_config)
        
        # Create dataplane with monitoring callbacks
        dp = client.get_dataplane(
            stream_name,
            monitor.text_callback,
            monitor.binary_callback
        )
        
        if dp.connect():
            logger.info(f"Dataplane connected: {stream_name}")
            
            try:
                # Keep monitoring until interrupted
                while True:
                    time.sleep(0.1)
            except KeyboardInterrupt:
                logger.info("Monitoring stopped by user")
        
        dp.close()
        client.close()
    else:
        logger.error("Failed to connect to Cresco server")