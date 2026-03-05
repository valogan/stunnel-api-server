import logging
import configparser
import uuid
from flask import Flask, request, jsonify
from flask_cors import CORS

from pycrescolib.clientlib import clientlib
from stunnel_direct import StunnelDirect
from database import Base, engine, SessionLocal, TunnelRecord

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("api_server")

# Initialize Flask App
app = Flask(__name__)
CORS(app)

# Global instances
cresco_client = None
stunnel_manager = None

def init_app():
    global cresco_client, stunnel_manager
    
    config = configparser.ConfigParser()
    config.read('config.ini')
    
    try:
        host = config.get('general', 'host')
        port = config.get('general', 'port')
        service_key = config.get('general', 'service_key')
    except configparser.NoSectionError as e:
        logger.error("config.ini missing 'general' section or required keys. Ensure config.ini is present.")
        raise
    
    cresco_client = clientlib(host, port, service_key)
    logger.info(f"Connecting to Cresco Server at {host}:{port}...")
    
    # Ensure database tables exist
    Base.metadata.create_all(bind=engine)
    
    if cresco_client.connect():
        logger.info("Successfully connected to Cresco Server.")
        stunnel_manager = StunnelDirect(cresco_client, logger=logger)
    else:
        logger.error("Failed to connect to Cresco server!")

# Initialize on startup
try:
    init_app()
except Exception as e:
    logger.error(f"Initialization failed: {e}")

@app.route("/", methods=["GET"])
def read_root():
    return jsonify({"message": "Welcome to the Cresco Tunnel Manager API (Flask Version)."})

@app.route("/tunnels", methods=["POST"])
def create_tunnel():
    """
    Launch a new tunnel between a source node and a destination node.
    """
    if not stunnel_manager:
        return jsonify({"detail": "Stunnel manager not initialized (Check Cresco connection)."}), 500
         
    req = request.json
    if not req:
        return jsonify({"detail": "Invalid JSON body"}), 400

    required_fields = ["src_region", "src_agent", "src_port", "dst_region", "dst_agent", "dst_host", "dst_port"]
    for field in required_fields:
        if field not in req:
            return jsonify({"detail": f"Missing required field: {field}"}), 400

    buffer_size = req.get("buffer_size", "1024")
    stunnel_id = str(uuid.uuid1())
    
    response = stunnel_manager.create_tunnel(
        stunnel_id=stunnel_id,
        src_region=req["src_region"],
        src_agent=req["src_agent"],
        src_port=req["src_port"],
        dst_region=req["dst_region"],
        dst_agent=req["dst_agent"],
        dst_host=req["dst_host"],
        dst_port=req["dst_port"],
        buffer_size=buffer_size
    )

    stunnel_plugin_id = stunnel_manager.find_existing_stunnel_plugin(req["src_region"], req["src_agent"])
    tunnel_list = stunnel_manager.get_tunnel_list(req["src_region"], req["src_agent"], stunnel_plugin_id)

    if tunnel_list:
        for stunnel in tunnel_list:
            s_id = stunnel['stunnel_id']
            s_status = stunnel['status']
            logger.info(f"{s_id}: {s_status}")

            returned_tunnel_status = stunnel_manager.get_tunnel_status(req["src_region"], req["src_agent"], stunnel_plugin_id, s_id)
            logger.info(returned_tunnel_status)

            returned_stunnel_config = stunnel_manager.get_tunnel_config(req["src_region"], req["src_agent"], stunnel_plugin_id, s_id)
            logger.info(returned_stunnel_config)
    else:
        return jsonify({"detail": "Failed to create tunnel. Make sure your cresco agent is up to date."}), 400
        
    if response is None:
        return jsonify({"detail": "Failed to create tunnel. Verify agents and plugins."}), 400
        
    # Persist to database
    db = SessionLocal()
    try:
        db_tunnel = TunnelRecord(
            stunnel_id=stunnel_id,
            src_region=req["src_region"],
            src_agent=req["src_agent"],
            src_port=req["src_port"],
            dst_region=req["dst_region"],
            dst_agent=req["dst_agent"],
            dst_host=req["dst_host"],
            dst_port=req["dst_port"],
            buffer_size=buffer_size,
            stunnel_plugin_id=stunnel_plugin_id
        )
        db.add(db_tunnel)
        db.commit()
    finally:
        db.close()
        
    return jsonify({"message": f"Tunnel {stunnel_id} created successfully.", "data": response})

@app.route("/tunnels", methods=["GET"])
def get_tunnels():
    """
    Retrieve a list of database tunnels.
    Provide optional query parameters to filter the results.
    """
    src_region = request.args.get("src_region")
    src_agent = request.args.get("src_agent")
    src_plugin_id = request.args.get("src_plugin_id")
    dst_region = request.args.get("dst_region")
    dst_agent = request.args.get("dst_agent")
    src_port = request.args.get("src_port")
    dst_host = request.args.get("dst_host")
    dst_port = request.args.get("dst_port")

    db = SessionLocal()
    try:
        query = db.query(TunnelRecord)
        
        if src_region:
            query = query.filter(TunnelRecord.src_region == src_region)
        if src_agent:
            query = query.filter(TunnelRecord.src_agent == src_agent)
        if dst_region:
            query = query.filter(TunnelRecord.dst_region == dst_region)
        if dst_agent:
            query = query.filter(TunnelRecord.dst_agent == dst_agent)
        if src_port:
            query = query.filter(TunnelRecord.src_port == src_port)
        if dst_host:
            query = query.filter(TunnelRecord.dst_host == dst_host)
        if dst_port:
            query = query.filter(TunnelRecord.dst_port == dst_port)
            
        tunnels = query.all()
        # Convert objects to dicts
        tunnels_data = []
        for t in tunnels:
            tunnels_data.append({
                "id": t.id,
                "stunnel_id": t.stunnel_id,
                "src_region": t.src_region,
                "src_agent": t.src_agent,
                "src_port": t.src_port,
                "dst_region": t.dst_region,
                "dst_agent": t.dst_agent,
                "dst_host": t.dst_host,
                "dst_port": t.dst_port,
                "buffer_size": t.buffer_size,
                "stunnel_plugin_id": t.stunnel_plugin_id,
                "created_at": t.created_at.isoformat() if t.created_at else None
            })
    finally:
        db.close()
    
    cresco_tunnels = []
    if stunnel_manager and src_region and src_agent and src_plugin_id:
        try:
            live_tunnels = stunnel_manager.get_tunnel_list(
                src_region=src_region,
                src_agent=src_agent,
                src_plugin_id=src_plugin_id
            )
            if live_tunnels:
                cresco_tunnels = live_tunnels
        except Exception as e:
            logger.error(f"Failed to fetch live tunnels: {e}")

    return jsonify({
        "database_tunnels": tunnels_data,
        "live_cresco_tunnels": cresco_tunnels
    })

@app.route("/tunnels/<stunnel_id>/status", methods=["GET"])
def get_tunnel_status(stunnel_id):
    """
    Retrieve the status of a specific tunnel by its ID.
    Requires specifying the overarching source node and plugin ID.
    """
    src_region = request.args.get("src_region")
    src_agent = request.args.get("src_agent")
    src_plugin_id = request.args.get("src_plugin_id")

    if not all([src_region, src_agent, src_plugin_id]):
        return jsonify({"detail": "Missing query parameters: src_region, src_agent, src_plugin_id"}), 400

    if not stunnel_manager:
        return jsonify({"detail": "Stunnel manager not initialized."}), 500
         
    status = stunnel_manager.get_tunnel_status(
        src_region=src_region,
        src_agent=src_agent,
        src_plugin_id=src_plugin_id,
        stunnel_id=stunnel_id
    )
    
    if status is None:
        return jsonify({"detail": f"No status found for tunnel {stunnel_id}."}), 404
        
    return jsonify({"stunnel_id": stunnel_id, "status": status})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
