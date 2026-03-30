# PyCrescoLib Documentation

## Introduction

PyCrescoLib is a Python client library for interacting with the Cresco Edge Computing platform. Cresco (Converged Computing Real-time Edge Synchronized Control Operations) is a distributed edge computing platform designed to monitor and control operations across distributed systems. This client library provides a comprehensive API to interact with Cresco controllers, agents, and plugins.

## Installation

```bash
# Installation details to be provided
# Typically would be:
# pip install pycrescolib
```

## Core Concepts

### Cresco Architecture

Cresco is built on a hierarchical architecture consisting of:

- **Regions**: Logical groupings of resources, typically representing geographical or functional boundaries
- **Agents**: Individual compute resources within regions
- **Plugins**: Modular components that extend agent functionality
- **Global Controller**: Central management entity for the Cresco environment
- **Pipelines**: Workflows connecting plugins for data processing

### Client Library Structure

The library is organized into several modules:

- `clientlib`: Main client interface integrating all other modules
- `admin`: Administrative operations for controllers
- `agents`: Agent management operations
- `api`: API information and utilities
- `dataplane`: Data streaming capabilities
- `globalcontroller`: Global controller operations
- `logstreamer`: Log streaming from agents
- `messaging`: Communication between components
- `utils`: Utility functions for data handling

## Getting Started

### Basic Connection

```python
from pycrescolib.clientlib import clientlib

# Connect to a Cresco environment
host = 'localhost'          # Hostname of the agent global controller with the wsapi plugin
port = 8282                 # Default port for wsapi
service_key = 'your-service-key'  # Service key for authentication

# Initialize the client
client = clientlib(host, port, service_key)

# Connect to the wsapi plugin
if client.connect():
    print("Connected to Cresco")
    
    # Perform operations...
    
    # Close connection when done
    client.close()
else:
    print("Failed to connect")
```

## API Reference

### Client Interface (clientlib)

The main interface providing access to all Cresco operations.

```python
# Initialize
client = clientlib(host, port, service_key)

# Connect to Cresco
client.connect()

# Check connection status
is_connected = client.connected()

# Close connection
client.close()

# Access other interfaces
client.agents           # Agent operations
client.admin            # Administrative operations
client.api              # API information
client.globalcontroller # Global controller operations

# Get data plane for streaming data
dataplane = client.get_dataplane(stream_name, callback=None)

# Get log streamer for log data
logstreamer = client.get_logstreamer(callback=None)
```

### Admin Operations (admin)

```python
# Stop a controller
client.admin.stopcontroller(region, agent)

# Restart a controller
client.admin.restartcontroller(region, agent)

# Restart the framework
client.admin.restartframework(region, agent)

# Forcefully kill the JVM
client.admin.killjvm(region, agent)
```

### Agent Operations (agents)

```python
# Check if controller is active
is_active = client.agents.is_controller_active(region, agent)

# Get controller status
status = client.agents.get_controller_status(region, agent)

# Add a plugin to an agent
response = client.agents.add_plugin_agent(region, agent, configparams, edges)

# Remove a plugin from an agent
response = client.agents.remove_plugin_agent(region, agent, plugin_id)

# List plugins on an agent
plugins = client.agents.list_plugin_agent(region, agent)

# Get status of a plugin
status = client.agents.status_plugin_agent(region, agent, plugin_id)

# Get agent information
info = client.agents.get_agent_info(region, agent)

# Get agent logs
logs = client.agents.get_agent_log(region, agent)

# Pull a plugin from the repository
response = client.agents.repo_pull_plugin_agent(region, agent, jar_file_path)

# Upload a plugin to an agent
response = client.agents.upload_plugin_agent(region, agent, jar_file_path)

# Update a plugin on an agent
response = client.agents.update_plugin_agent(region, agent, jar_file_path)

# Get broadcast discovery information
discovery = client.agents.get_broadcast_discovery(region, agent)

# Add a CEP (Complex Event Processing) operation
response = client.agents.cepadd(input_stream, input_stream_desc, output_stream, output_stream_desc, query, region, agent)
```

### Global Controller Operations (globalcontroller)

```python
# Submit a pipeline
response = client.globalcontroller.submit_pipeline(cadl)

# Remove a pipeline
response = client.globalcontroller.remove_pipeline(pipeline_id)

# Get list of pipelines
pipelines = client.globalcontroller.get_pipeline_list()

# Get information about a pipeline
info = client.globalcontroller.get_pipeline_info(pipeline_id)

# Get status of a pipeline
status = client.globalcontroller.get_pipeline_status(pipeline_id)

# Get list of agents
agents = client.globalcontroller.get_agent_list(region=None)

# Get agent resources
resources = client.globalcontroller.get_agent_resources(region, agent)

# Get list of plugins
plugins = client.globalcontroller.get_plugin_list()

# Upload a plugin to the global repository
response = client.globalcontroller.upload_plugin_global(jar_file_path)

# Get region resources
resources = client.globalcontroller.get_region_resources(region)

# Get list of regions
regions = client.globalcontroller.get_region_list()
```

### API Information (api)

```python
# Get API region name
region = client.api.get_api_region_name()

# Get API agent name
agent = client.api.get_api_agent_name()

# Get API plugin name
plugin = client.api.get_api_plugin_name()

# Get global region
global_region = client.api.get_global_region()

# Get global agent
global_agent = client.api.get_global_agent()

# Get global information
client.api.get_global_info()
```

### Data Plane Operations (dataplane)

The data plane provides real-time data streaming capabilities.

```python
# Get a data plane connection
dp = client.get_dataplane(stream_name, callback=None)

# Connect to the data stream
dp.connect()

# Check if data plane is active
is_active = dp.is_active()

# Send data
dp.send(data)

# Close the connection
dp.close()
```

### Log Streaming (logstreamer)

```python
# Get a log streamer
log = client.get_logstreamer(callback=None)

# Connect to the log stream
log.connect()

# Update log configuration
log.update_config(region, agent)

# Update log configuration for a specific class
log.update_config_class(region, agent, loglevel, baseclass)

# Close the connection
log.close()
```

### Utilities (utils)

```python
from pycrescolib.utils import compress_param, decompress_param, get_jar_info, compress_data, encode_data

# Compress parameters
compressed = compress_param(params_string)

# Decompress parameters
decompressed = decompress_param(compressed_string)

# Get information from a JAR file
jar_info = get_jar_info(jar_file_path)

# Compress binary data
compressed_data = compress_data(binary_data)

# Base64 encode binary data
encoded_data = encode_data(binary_data)
```

## Examples

### Basic Agent Operations

```python
from pycrescolib.clientlib import clientlib

# Initialize and connect
client = clientlib('localhost', 8282, 'your-service-key')
client.connect()

# Get region and agent
dst_region = 'global-region'
dst_agent = 'global-controller'

# Check controller status
print('Global Controller Status:', client.agents.get_controller_status(dst_region, dst_agent))

# If controller is active, get agent list
if client.agents.is_controller_active(dst_region, dst_agent):
    agents = client.globalcontroller.get_agent_list()
    print('Agent list:', agents)

# Close connection
client.close()
```

### File Repository Example

```python
from pycrescolib.clientlib import clientlib
import os
import uuid
from pathlib import Path

# Initialize and connect
client = clientlib('localhost', 8282, 'your-service-key')
client.connect()

# Define region and agent
dst_region = 'global-region'
dst_agent = 'global-controller'

if client.agents.is_controller_active(dst_region, dst_agent):
    # Optional logger callback
    def logger_callback(message):
        print("Log message:", message)
    
    # Connect to log stream
    log = client.get_logstreamer(logger_callback)
    log.connect()
    log.update_config(dst_region, dst_agent)
    
    # Upload filerepo plugin from URL
    jar_file_path = "filerepo-1.1-SNAPSHOT.jar"
    reply = client.globalcontroller.upload_plugin_global(jar_file_path)
    
    # Create unique file repo name and paths
    filerepo_name = str(uuid.uuid1())
    src_repo_path = os.path.abspath('test_data/' + str(uuid.uuid1()))
    dst_repo_path = os.path.abspath('test_data/' + str(uuid.uuid1()))
    
    # Create directories
    os.makedirs(src_repo_path)
    os.makedirs(dst_repo_path)
    
    # Create pycrescolib_test files
    for i in range(20):
        Path(src_repo_path + '/' + str(i)).touch()
    
    # Set up data plane listener for file repo communications
    stream_query = f"filerepo_name='{filerepo_name}' AND broadcast"
    
    def dp_callback(message):
        print("Data plane message:", message)
    
    dp = client.get_dataplane(stream_query, dp_callback)
    dp.connect()
    
    # Prepare pipeline configuration
    # ... [Configuration details omitted for brevity]
    
    # Close connections when done
    client.close()
```

### Executor Example

```python
from pycrescolib.clientlib import clientlib
import time
import json

# Initialize and connect
client = clientlib('localhost', 8282, 'your-service-key')
client.connect()

# Define region and agent
dst_region = 'global-region'
dst_agent = 'global-controller'

if client.agents.is_controller_active(dst_region, dst_agent):
    # Upload executor plugin
    jar_file_path = "executor-1.1-SNAPSHOT.jar"
    reply = client.globalcontroller.upload_plugin_global(jar_file_path)
    
    # Get plugin configuration
    configparams = json.loads(decompress_param(reply['configparams']))
    
    # Add plugin to agent
    reply = client.agents.add_plugin_agent(dst_region, dst_agent, configparams, None)
    executor_plugin_id = reply['pluginid']
    
    # Wait for plugin to be active
    while client.agents.status_plugin_agent(dst_region, dst_agent, executor_plugin_id)['status_code'] != '10':
        print('Waiting on startup')
        time.sleep(1)
    
    # Configure and execute command
    message_event_type = 'CONFIG'
    message_payload = {
        'action': 'config_process',
        'stream_name': str(uuid.uuid1()),
        'command': 'ls -la'  # Command to execute
    }
    
    result = client.messaging.global_plugin_msgevent(
        True, message_event_type, message_payload, 
        dst_region, dst_agent, executor_plugin_id
    )
    
    # Start the process
    message_payload['action'] = 'start_process'
    result = client.messaging.global_plugin_msgevent(
        True, message_event_type, message_payload, 
        dst_region, dst_agent, executor_plugin_id
    )
    
    # Clean up
    message_payload['action'] = 'end_process'
    result = client.messaging.global_plugin_msgevent(
        True, message_event_type, message_payload, 
        dst_region, dst_agent, executor_plugin_id
    )
    
    # Remove plugin
    client.agents.remove_plugin_agent(dst_region, dst_agent, executor_plugin_id)
    
    # Close connection
    client.close()
```

## Advanced Topics

### Custom Callbacks

Both `dataplane` and `logstreamer` support custom callbacks for handling incoming data:

```python
def custom_dp_callback(message):
    # Process data plane messages
    try:
        data = json.loads(message)
        print("Received data:", data)
        # Perform custom processing
    except:
        print("Raw message:", message)

# Create data plane with custom callback
dp = client.get_dataplane(stream_query, custom_dp_callback)
dp.connect()
```

### Error Handling

```python
try:
    # Attempt to connect
    if client.connect():
        # Perform operations
        pass
    else:
        print("Failed to connect to Cresco environment")
except Exception as e:
    print(f"Error: {str(e)}")
finally:
    # Always close connections when done
    if client.connected():
        client.close()
```

### Pipeline Management

```python
# Define a pipeline
cadl = {
    'pipeline_id': '0',
    'pipeline_name': str(uuid.uuid1()),
    'nodes': [
        {
            'type': 'dummy',
            'node_name': 'Plugin 0',
            'node_id': 0,
            'isSource': False,
            'workloadUtil': 0,
            'params': {
                'pluginname': 'io.cresco.example',
                'md5': 'md5_hash',
                'version': 'version_string',
                'location_region': 'global-region',
                'location_agent': 'global-controller'
            }
        }
    ],
    'edges': []
}

# Submit the pipeline
response = client.globalcontroller.submit_pipeline(cadl)
pipeline_id = response['gpipeline_id']

# Wait for pipeline to come online
while client.globalcontroller.get_pipeline_status(pipeline_id) != 10:
    print('Waiting for pipeline to come online')
    time.sleep(1)

# Get pipeline information
pipeline_info = client.globalcontroller.get_pipeline_info(pipeline_id)

# Remove the pipeline when done
client.globalcontroller.remove_pipeline(pipeline_id)
```

## Use Cases

PyCrescoLib is designed for a variety of distributed computing scenarios:

1. **Edge Computing Management**: Monitor and control edge devices in IoT deployments
2. **File Synchronization**: Transfer files between distributed nodes
3. **Remote Command Execution**: Run commands on remote agents
4. **Data Streaming**: Create real-time data processing pipelines
5. **System Monitoring**: Stream logs and performance metrics from distributed systems
6. **AI/ML Deployment**: Deploy and manage AI/ML models across edge infrastructure

## Best Practices

1. **Resource Management**: Always close connections when done
2. **Error Handling**: Implement proper try/except blocks for robust operation
3. **Async Operations**: Use callbacks for handling streaming data
4. **Security**: Protect service keys and credentials
5. **Connection Management**: Check connection status before operations
6. **Logging**: Implement proper logging for debugging

## Troubleshooting

### Common Issues

1. **Connection Failures**
   - Verify host, port, and service key
   - Check network connectivity
   - Ensure SSL certificates are valid

2. **Plugin Deployment Issues**
   - Verify JAR file integrity
   - Check version compatibility
   - Review agent logs for detailed errors

3. **Pipeline Execution Problems**
   - Validate pipeline configuration (CADL)
   - Check node interconnections
   - Ensure all plugins are active

## License

[License information to be provided]

---

## API Server Authentication

The Cresco Tunnel Manager API server supports dual authentication methods:

### Authentication Methods

1. **API Key Authentication** (for programmatic access)
   - Use the `X-API-Key` header with your API key
   - Best for scripts, CI/CD pipelines, and automated systems

2. **JWT Token Authentication** (for web portal access)
   - Obtain a token via the `/token` endpoint
   - Use the `Authorization: Bearer <token>` header
   - Best for web portal users

### Configuration

Add the following to your `config.ini`:

```ini
[auth]
# Secret key for JWT token signing. Generate a secure random key for production.
# Generate with: python -c "import secrets; print(secrets.token_urlsafe(32))"
secret_key=your-secret-key-change-me-in-production
# JWT token algorithm (default: HS256)
algorithm=HS256
# Token expiration time in minutes (default: 30)
access_token_expire_minutes=30
```

### Default Admin User

On first startup, a default admin user is created:
- **Username**: `admin`
- **Password**: `admin`

**Important**: Change this password immediately in production!

### API Endpoints

#### Authentication Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/token` | POST | Login to obtain JWT token (form-data: username, password) |
| `/users/me` | GET | Get current user info |
| `/users` | GET | List all users (admin only) |
| `/users` | POST | Create a new user (admin only) |
| `/users/{user_id}/deactivate` | PUT | Deactivate a user (admin only) |

#### API Key Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api-keys` | GET | List all API keys |
| `/api-keys` | POST | Create a new API key |
| `/api-keys/{key_id}` | DELETE | Delete an API key |
| `/api-keys/{key_id}/deactivate` | PUT | Deactivate an API key |

### Usage Examples

#### Programmatic Access (API Key)

```bash
# Create an API key first (via web portal or with JWT token)
# Then use it in your requests:

curl -X GET "http://localhost:8000/tunnels" \
  -H "X-API-Key: your-api-key-here"
```

```python
import requests

API_URL = "http://localhost:8000"
API_KEY = "your-api-key-here"

headers = {"X-API-Key": API_KEY}

# Get tunnels
response = requests.get(f"{API_URL}/tunnels", headers=headers)
tunnels = response.json()

# Create a tunnel
payload = {
    "src_region": "region1",
    "src_agent": "agent1",
    "src_port": "8080",
    "dst_region": "region2",
    "dst_agent": "agent2",
    "dst_host": "127.0.0.1",
    "dst_port": "80",
    "buffer_size": "1024"
}
response = requests.post(f"{API_URL}/tunnels", json=payload, headers=headers)
```

#### Web Portal Access (JWT Token)

```python
import requests

API_URL = "http://localhost:8000"

# Login to get token
login_data = {"username": "admin", "password": "admin"}
response = requests.post(f"{API_URL}/token", data=login_data)
token = response.json()["access_token"]

# Use token in subsequent requests
headers = {"Authorization": f"Bearer {token}"}
response = requests.get(f"{API_URL}/tunnels", headers=headers)
```

### Web Portal

The web portal automatically handles authentication:

1. Navigate to the web portal in your browser
2. You'll be redirected to the login page if not authenticated
3. Enter your credentials to log in
4. The token is stored in localStorage and automatically included in API requests

To log out, click the "Logout" button in the navigation bar.

---

## Contributing to PyCrescoLib

[Contribution guidelines to be provided]
