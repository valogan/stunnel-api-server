import logging
import configparser
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel
from fastapi import Request
import time
import uuid

from pycrescolib.clientlib import clientlib
from stunnel_direct import StunnelDirect

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("api_server")

# Global instances
cresco_client = None
stunnel_manager = None

# --- Lifespan & Initialization ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    global cresco_client, stunnel_manager
    
    # 1. Read config
    config = configparser.ConfigParser()
    config.read('config.ini')
    
    try:
        host = config.get('general', 'host')
        port = config.get('general', 'port')
        service_key = config.get('general', 'service_key')
    except configparser.NoSectionError as e:
        logger.error("config.ini missing 'general' section or required keys. Ensure config.ini is present.")
        raise
    
    # 2. Connect to Cresco
    cresco_client = clientlib(host, port, service_key)
    logger.info(f"Connecting to Cresco Server at {host}:{port}...")
    
    if cresco_client.connect():
        logger.info("Successfully connected to Cresco Server.")
        # 3. Initialize StunnelManager
        stunnel_manager = StunnelDirect(cresco_client, logger=logger)
    else:
        logger.error("Failed to connect to Cresco server!")
        # We don't strictly crash the app so you can see errors, but you could raise an exception here.
    # --- ADD THIS DEBUG BLOCK ---
    logger.info("=== REGISTERED FASTAPI ROUTES ===")
    for route in app.routes:
        methods = getattr(route, "methods", set())
        path = getattr(route, "path", route.name)
        logger.info(f"{methods} {path}")
    logger.info("=================================")

    yield # The app runs while yielded
    
    # 4. Cleanup on shutdown
    logger.info("Shutting down API server, closing Cresco connection...")
    if cresco_client:
        cresco_client.close()

# Initialize FastAPI App
app = FastAPI(
    title="Cresco Tunnel Manager API",
    description="An API to launch and manage Cresco stunnel pipelines.",
    version="1.0.0",
    lifespan=lifespan
)

# --- Define Pydantic Models for Input ---
class TunnelCreateRequest(BaseModel):
    src_region: str
    src_agent: str
    src_port: str
    dst_region: str
    dst_agent: str
    dst_host: str
    dst_port: str
    buffer_size: str = "1024"

# --- Endpoints ---

@app.get("/")
def read_root():
    return {"message": "Welcome to the Cresco Tunnel Manager API. Visit /docs for documentation."}

@app.post("/tunnels")
def create_tunnel(req: TunnelCreateRequest):
    """
    Launch a new tunnel between a source node and a destination node.
    """
    if not stunnel_manager:
         raise HTTPException(status_code=500, detail="Stunnel manager not initialized (Check Cresco connection).")
         
    stunnel_id = str(uuid.uuid1())
    response = stunnel_manager.create_tunnel(
        stunnel_id=stunnel_id,
        src_region=req.src_region,
        src_agent=req.src_agent,
        src_port=req.src_port,
        dst_region=req.dst_region,
        dst_agent=req.dst_agent,
        dst_host=req.dst_host,
        dst_port=req.dst_port,
        buffer_size=req.buffer_size
    )

    stunnel_plugin_id = stunnel_manager.find_existing_stunnel_plugin(req.src_region, req.src_agent)
    
    # get list of tunnels
    tunnel_list = stunnel_manager.get_tunnel_list(req.src_region, req.src_agent, stunnel_plugin_id)

    # iterate tunnels
    for stunnel in tunnel_list:
        # get id from list
        stunnel_id = stunnel['stunnel_id']
        # get status from list
        stunnel_status = stunnel['status']
        logger.info(stunnel_id)
        logger.info(stunnel_status)

        # get status
        returned_tunnel_status = stunnel_manager.get_tunnel_status(req.src_region, req.src_agent, stunnel_plugin_id, stunnel_id)
        logger.info(returned_tunnel_status)

        #get the original config that should match saved_stunnel_config
        returned_stunnel_config = stunnel_manager.get_tunnel_config(req.src_region, req.src_agent, stunnel_plugin_id, stunnel_id)
        logger.info(returned_stunnel_config)
        
    
    if response is None:
        raise HTTPException(status_code=400, detail="Failed to create tunnel. Verify agents and plugins.")
        
    return {"message": f"Tunnel {stunnel_id} created successfully.", "data": response}


@app.get("/tunnels")
def get_tunnels(
    src_region: str = Query(..., description="The source region of the stunnel plugin"),
    src_agent: str = Query(..., description="The source agent of the stunnel plugin"),
    src_plugin_id: str = Query(..., description="The ID of the source stunnel plugin (e.g. system-io.cresco.stunnel...)")
):
    """
    Retrieve a list of active tunnels.
    Requires specifying the source node and plugin ID holding the tunnels.
    """
    if not stunnel_manager:
         raise HTTPException(status_code=500, detail="Stunnel manager not initialized.")
         
    tunnels = stunnel_manager.get_tunnel_list(
        src_region=src_region,
        src_agent=src_agent,
        src_plugin_id=src_plugin_id
    )
    
    if tunnels is None:
        raise HTTPException(status_code=404, detail="Could not retrieve tunnels or plugin not found.")
        
    return {"tunnels": tunnels}

@app.get("/tunnels/{stunnel_id}/status")
def get_tunnel_status(
    stunnel_id: str,
    src_region: str = Query(..., description="The source region of the stunnel plugin"),
    src_agent: str = Query(..., description="The source agent of the stunnel plugin"),
    src_plugin_id: str = Query(..., description="The ID of the source stunnel plugin (e.g. system-io.cresco.stunnel...)")
):
    """
    Retrieve the status of a specific tunnel by its ID.
    Requires specifying the overarching source node and plugin ID.
    """
    if not stunnel_manager:
         raise HTTPException(status_code=500, detail="Stunnel manager not initialized.")
         
    status = stunnel_manager.get_tunnel_status(
        src_region=src_region,
        src_agent=src_agent,
        src_plugin_id=src_plugin_id,
        stunnel_id=stunnel_id
    )
    
    if status is None:
        raise HTTPException(status_code=404, detail=f"No status found for tunnel {stunnel_id}.")
        
    return {"stunnel_id": stunnel_id, "status": status}

if __name__ == "__main__":
    import uvicorn
    # Running programmatically if file is executed directly
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)

