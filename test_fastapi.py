from fastapi.testclient import TestClient
from api import app

client = TestClient(app)

response = client.get("/tunnels/123-456/config?src_region=region1&src_agent=agent1&src_plugin_id=plugin1")
print(response.status_code)
print(response.json())
