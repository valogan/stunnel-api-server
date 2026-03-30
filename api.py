import logging
import configparser
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from fastapi import Request
from fastapi.responses import Response
from fastapi.security import OAuth2PasswordBearer, APIKeyHeader
from fastapi import Depends, Security
import time
import uuid
import asyncio
import secrets

from pycrescolib.clientlib import clientlib
from pycrescolib.haproxy import HAProxyDeployer
from pycrescolib.stunnel import StunnelDirect
from sqlalchemy.orm import Session
from database import Base, engine, get_db, TunnelRecord, SessionLocal, UserRecord, APIKeyRecord
import threading
import re

# JWT imports
from jose import JWTError, jwt

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("api_server")

# Global instances
cresco_client = None
stunnel_manager = None
proxy_region = None
proxy_agent = None
proxy_host = None

# --- Authentication Configuration ---
# These will be loaded from config.ini
AUTH_SECRET_KEY = None
AUTH_ALGORITHM = "HS256"
AUTH_ACCESS_TOKEN_EXPIRE_MINUTES = 30

# --- CORS Configuration ---
# Load CORS origins at module level (needed before middleware is added)
def _load_cors_origins():
    """Load CORS origins from config.ini at module load time"""
    config = configparser.ConfigParser()
    config.read('config.ini')
    try:
        origins_str = config.get('cors', 'allow_origins')
        return [origin.strip() for origin in origins_str.split(',') if origin.strip()]
    except (configparser.NoSectionError, configparser.NoOptionError):
        # Default origins for development
        return ["http://localhost:8000", "http://localhost:8005"]

CORS_ORIGINS = _load_cors_origins()

# Security schemes for dual authentication
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token", auto_error=False)
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


# --- Authentication Helper Functions ---
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=AUTH_ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, AUTH_SECRET_KEY, algorithm=AUTH_ALGORITHM)
    return encoded_jwt


def verify_token(token: str) -> Optional[str]:
    """Verify a JWT token and return the username if valid"""
    try:
        payload = jwt.decode(token, AUTH_SECRET_KEY, algorithms=[AUTH_ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            return None
        return username
    except JWTError:
        return None


async def get_current_user(
    db: Session = Depends(get_db),
    token: str = Depends(oauth2_scheme),
    api_key: str = Depends(api_key_header)
) -> dict:
    """
    Dual authentication: Accept either API key or JWT token.
    Returns a dict with auth type and user/key info.
    """
    credentials_exception = HTTPException(
        status_code=401,
        detail="Valid API key (X-API-Key header) or authentication token required",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    # Try API Key first (for programmatic access)
    if api_key:
        key_record = db.query(APIKeyRecord).filter(
            APIKeyRecord.key == api_key,
            APIKeyRecord.is_active == True
        ).first()
        if key_record:
            # Update last_used timestamp
            key_record.last_used = datetime.utcnow()
            db.commit()
            return {"type": "api_key", "key": key_record}
    
    # Try JWT token (for web portal)
    if token:
        username = verify_token(token)
        if username:
            user = db.query(UserRecord).filter(
                UserRecord.username == username,
                UserRecord.is_active == True
            ).first()
            if user:
                return {"type": "user", "user": user}
    
    raise credentials_exception


async def get_current_active_user(current_auth: dict = Depends(get_current_user)) -> dict:
    """Ensure the user is active (for user-based auth)"""
    if current_auth["type"] == "user":
        if not current_auth["user"].is_active:
            raise HTTPException(status_code=400, detail="Inactive user")
    return current_auth


def require_role(required_role: str):
    """Dependency to require a specific role for user auth"""
    async def role_checker(current_auth: dict = Depends(get_current_active_user)):
        if current_auth["type"] == "api_key":
            # API keys have full access
            return current_auth
        if current_auth["type"] == "user":
            user_role = current_auth["user"].role
            if user_role != required_role and user_role != "admin":
                raise HTTPException(status_code=403, detail="Not enough permissions")
        return current_auth
    return role_checker

# --- Metrics Cache & Logstreamer ---
active_metrics_cache = {}
plugin_id_to_stunnel_id = {}
logstreamer_instance = None
metrics_worker_running = False

def process_log_message(message: str):
    # Skip noisy messages that aren't stunnel related
    if "io.cresco.stunnel" not in message and "tunnel" not in message.lower():
        return

    plugin_match = re.search(r'system-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})', message)
    stunnel_id = None
    if plugin_match:
        plugin_id = f"system-{plugin_match.group(1)}"
        stunnel_id = plugin_id_to_stunnel_id.get(plugin_id)
        
    if not stunnel_id:
        stunnel_match = re.search(r'tunnel:?\s*([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})', message, re.IGNORECASE)
        if stunnel_match:
            stunnel_id = stunnel_match.group(1)
            
    if stunnel_id:
        if stunnel_id not in active_metrics_cache:
            active_metrics_cache[stunnel_id] = {"health": "unknown", "bytes_msg": "0 B/s", "last_updated": 0, "last_updated_bytes": 0, "status_code": 10}
            
        active_metrics_cache[stunnel_id]["last_updated"] = time.time()
        
        if "Health check successful" in message:
            active_metrics_cache[stunnel_id]["health"] = "healthy"
            active_metrics_cache[stunnel_id]["status_code"] = 10
        elif "Health check failed" in message or "timeout" in message.lower():
            active_metrics_cache[stunnel_id]["health"] = "degraded"
            active_metrics_cache[stunnel_id]["status_code"] = 50
        elif "Performance:" in message and "bits/sec" in message:
            perf_match = re.search(r'Performance:\s*(\d+)\s*bits/sec', message, re.IGNORECASE)
            if perf_match:
                bits_per_sec = int(perf_match.group(1))
                bytes_per_sec = bits_per_sec // 8
                active_metrics_cache[stunnel_id]["bytes_msg"] = f"{bytes_per_sec} B/s"
                active_metrics_cache[stunnel_id]["last_updated_bytes"] = time.time()

def background_metrics_worker():
    global logstreamer_instance
    subscribed_agents = set()
    while metrics_worker_running:
        try:
            # Update mappings from DB
            db = SessionLocal()
            try:
                tunnels = db.query(TunnelRecord).all()
                for t in tunnels:
                    if t.stunnel_plugin_id and t.stunnel_id:
                        plugin_id_to_stunnel_id[t.stunnel_plugin_id] = t.stunnel_id
            finally:
                db.close()
                
            # Subscribe to newly discovered agents
            if cresco_client and cresco_client.connected() and logstreamer_instance:
                agents = cresco_client.globalcontroller.get_agent_list()
                if agents:
                    for agent in agents:
                        r = agent.get('region') or agent.get('region_id')
                        a = agent.get('agent') or agent.get('agent_id')
                        if r and a and (r, a) not in subscribed_agents:
                            logger.info(f"Subscribing logstreamer to {r}/{a}")
                            logstreamer_instance.update_config(r, a)
                            subscribed_agents.add((r, a))
        except Exception as e:
            logger.error(f"Error in background metrics worker: {e}")
        time.sleep(10)

# --- Lifespan & Initialization ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    global cresco_client, stunnel_manager, logstreamer_instance, metrics_worker_running
    global AUTH_SECRET_KEY, AUTH_ALGORITHM, AUTH_ACCESS_TOKEN_EXPIRE_MINUTES
    
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
        
    global proxy_region, proxy_agent, proxy_host
    try:
        proxy_region = config.get('proxy', 'region')
        proxy_agent = config.get('proxy', 'agent')
        proxy_host = config.get('proxy', 'host', fallback='localhost')
    except (configparser.NoSectionError, configparser.NoOptionError):
        logger.error("config.ini missing 'proxy' section or required keys. Using defaults.")
        proxy_region = ""
        proxy_agent = ""
        proxy_host = "localhost"
    
    # Load auth configuration
    try:
        AUTH_SECRET_KEY = config.get('auth', 'secret_key')
        AUTH_ALGORITHM = config.get('auth', 'algorithm', fallback='HS256')
        AUTH_ACCESS_TOKEN_EXPIRE_MINUTES = config.getint('auth', 'access_token_expire_minutes', fallback=30)
        logger.info("Authentication configuration loaded successfully.")
    except (configparser.NoSectionError, configparser.NoOptionError):
        # Generate a random secret key if not provided (for development)
        AUTH_SECRET_KEY = secrets.token_urlsafe(32)
        logger.warning("config.ini missing 'auth' section. Using generated secret key (not suitable for production!).")
    
    # 2. Connect to Cresco
    cresco_client = clientlib(host, port, service_key)
    logger.info(f"Connecting to Cresco Server at {host}:{port}...")
    
    # Ensure database tables exist. Retry because postgres might take a moment to be available via DNS.
    import asyncio
    for attempt in range(5):
        try:
            Base.metadata.create_all(bind=engine)
            logger.info("Database tables verified/created successfully.")
            break
        except Exception as e:
            if attempt < 4:
                logger.warning(f"Database not ready. Retrying in 5 seconds... ({e})")
                await asyncio.sleep(5)
            else:
                logger.error("Failed to connect to the database after 5 attempts.")
                raise
    
    # Create default admin user if no users exist (after tables are created)
    db = SessionLocal()
    try:
        user_count = db.query(UserRecord).count()
        if user_count == 0:
            default_admin = UserRecord(
                username="admin",
                hashed_password=UserRecord.hash_password("admin"),
                is_active=True,
                role="admin"
            )
            db.add(default_admin)
            db.commit()
            logger.info("Created default admin user (username: admin, password: admin). CHANGE THIS IMMEDIATELY!")
    except Exception as e:
        logger.error(f"Error creating default admin user: {e}")
    finally:
        db.close()

    if cresco_client.connect():
        logger.info("Successfully connected to Cresco Server.")
        # 3. Initialize StunnelManager
        stunnel_manager = StunnelDirect(cresco_client, logger=logger)
        
        try:
            logstreamer_instance = cresco_client.get_logstreamer(callback=process_log_message)
            logstreamer_instance.connect()
            metrics_worker_running = True
            threading.Thread(target=background_metrics_worker, daemon=True).start()
            asyncio.create_task(websocket_metrics_task())
            logger.info("Started background logstreamer and WS task for tunnel metrics.")
        except Exception as e:
            logger.error(f"Failed to start logstreamer: {e}")
            
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
    metrics_worker_running = False
    if logstreamer_instance:
        logstreamer_instance.close()
    if cresco_client:
        cresco_client.close()

# Initialize FastAPI App
app = FastAPI(
    title="Cresco Tunnel Manager API",
    description="An API to launch and manage Cresco stunnel pipelines.",
    version="1.0.0",
    lifespan=lifespan
)

from fastapi.middleware.cors import CORSMiddleware

# Configure CORS explicitly for the web frontend and common local hosts.
# Note: allow_credentials=True requires specific origins (not "*")
# CORS_ORIGINS is loaded from config.ini in lifespan, defaults are set above
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,  # Loaded from config.ini [cors] allow_origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info(f"Incoming request: {request.method} {request.url.path}")
    logger.info(f"Headers: {request.headers}")
    try:
        response = await call_next(request)
        logger.info(f"Response status: {response.status_code}")
        return response
    except Exception as e:
        logger.error(f"Request failed: {e}", exc_info=True)
        raise

# --- WebSocket Connection Manager ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Failed to send WS message: {e}")
                if connection in self.active_connections:
                    self.active_connections.remove(connection)

manager = ConnectionManager()

def build_tunnels_response(db: Session, src_region=None, src_agent=None, src_plugin_id=None, dst_region=None, dst_agent=None, src_port=None, dst_host=None, dst_port=None):
    """Helper to build the tunnels response block for both REST and WS"""
    query = db.query(TunnelRecord)
    if src_region: query = query.filter(TunnelRecord.src_region == src_region)
    if src_agent: query = query.filter(TunnelRecord.src_agent == src_agent)
    if dst_region: query = query.filter(TunnelRecord.dst_region == dst_region)
    if dst_agent: query = query.filter(TunnelRecord.dst_agent == dst_agent)
    if src_port: query = query.filter(TunnelRecord.src_port == src_port)
    if dst_host: query = query.filter(TunnelRecord.dst_host == dst_host)
    if dst_port: query = query.filter(TunnelRecord.dst_port == dst_port)
        
    tunnels = query.all()
    tunnels_data = []
    current_time = time.time()
    
    import datetime
    for t in tunnels:
        t_dict = {}
        for c in t.__table__.columns:
            val = getattr(t, c.name)
            if isinstance(val, datetime.datetime):
                val = val.isoformat()
            t_dict[c.name] = val
            
        metrics = None
        if t.stunnel_id in active_metrics_cache:
            metrics = dict(active_metrics_cache[t.stunnel_id])
            last_bytes_time = metrics.get("last_updated_bytes", 0)
            if current_time - last_bytes_time > 5:
                metrics["bytes_msg"] = "0 B/s"
        t_dict["metrics"] = metrics
        tunnels_data.append(t_dict)
    
    cresco_tunnels = []
    if stunnel_manager and src_region and src_agent and src_plugin_id:
        try:
            live_tunnels = stunnel_manager.get_tunnel_list(
                src_region=src_region, src_agent=src_agent, src_plugin_id=src_plugin_id
            )
            if live_tunnels: cresco_tunnels = live_tunnels
        except Exception:
            pass

    return {
        "database_tunnels": tunnels_data,
        "live_cresco_tunnels": cresco_tunnels
    }

async def websocket_metrics_task():
    """Background task to broadcast metrics continuously"""
    while metrics_worker_running:
        try:
            if manager.active_connections:
                db = SessionLocal()
                try:
                    data = build_tunnels_response(db)
                    await manager.broadcast(data)
                finally:
                    db.close()
        except Exception as e:
            logger.error(f"WebSocket broadcast error: {e}")
        await asyncio.sleep(2)  # Update UI every 2 seconds

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

class LoadBalancedTunnelRequest(BaseModel):
    src_region: str
    src_agent: str
    src_port: str
    dst_region: str
    dst_agent: str
    destinations: list[str]
    buffer_size: str = "1024"

# --- Auth Pydantic Models ---
class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "user"

class UserResponse(BaseModel):
    id: int
    username: str
    is_active: bool
    role: str
    created_at: datetime

    class Config:
        from_attributes = True

class APIKeyCreate(BaseModel):
    name: str

class APIKeyResponse(BaseModel):
    id: int
    key: str
    name: str
    is_active: bool
    created_at: datetime
    last_used: Optional[datetime]

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

# --- Authentication Endpoints ---
from fastapi.security import OAuth2PasswordRequestForm

@app.post("/token", response_model=Token)
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    """Login endpoint for web portal users to obtain JWT token"""
    user = db.query(UserRecord).filter(UserRecord.username == form_data.username).first()
    if not user or not user.verify_password(form_data.password):
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    
    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}


@app.get("/users/me", response_model=UserResponse)
async def read_users_me(current_auth: dict = Depends(get_current_active_user)):
    """Get current user info (for web portal)"""
    if current_auth["type"] == "api_key":
        raise HTTPException(status_code=400, detail="This endpoint requires user authentication")
    return current_auth["user"]


@app.post("/users", response_model=UserResponse)
async def create_user(
    user_data: UserCreate,
    db: Session = Depends(get_db),
    current_auth: dict = Depends(require_role("admin"))
):
    """Create a new user (admin only)"""
    # Check if username exists
    existing = db.query(UserRecord).filter(UserRecord.username == user_data.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already registered")
    
    new_user = UserRecord(
        username=user_data.username,
        hashed_password=UserRecord.hash_password(user_data.password),
        is_active=True,
        role=user_data.role
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@app.get("/users", response_model=list[UserResponse])
async def list_users(
    db: Session = Depends(get_db),
    current_auth: dict = Depends(require_role("admin"))
):
    """List all users (admin only)"""
    return db.query(UserRecord).all()


@app.put("/users/{user_id}/deactivate")
async def deactivate_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_auth: dict = Depends(require_role("admin"))
):
    """Deactivate a user (admin only)"""
    user = db.query(UserRecord).filter(UserRecord.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = False
    db.commit()
    return {"message": f"User {user.username} deactivated"}


class PasswordChange(BaseModel):
    new_password: str


@app.put("/users/{user_id}/password")
async def change_user_password(
    user_id: int,
    password_data: PasswordChange,
    db: Session = Depends(get_db),
    current_auth: dict = Depends(get_current_active_user)
):
    """
    Change a user's password.
    - Admins can change any user's password
    - Regular users can only change their own password
    """
    # Check permissions
    if current_auth["type"] == "user":
        current_user = current_auth["user"]
        if current_user.role != "admin" and current_user.id != user_id:
            raise HTTPException(status_code=403, detail="You can only change your own password")
    elif current_auth["type"] == "api_key":
        # API keys can only change passwords if they have admin access
        raise HTTPException(status_code=403, detail="API keys cannot change user passwords")
    
    user = db.query(UserRecord).filter(UserRecord.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.hashed_password = UserRecord.hash_password(password_data.new_password)
    db.commit()
    return {"message": f"Password updated for user {user.username}"}


# --- API Key Management Endpoints ---
@app.post("/api-keys", response_model=APIKeyResponse)
async def create_api_key(
    key_data: APIKeyCreate,
    db: Session = Depends(get_db),
    current_auth: dict = Depends(get_current_active_user)
):
    """Create a new API key"""
    new_key = APIKeyRecord(
        key=secrets.token_urlsafe(32),
        name=key_data.name,
        is_active=True,
        created_by=current_auth["user"].id if current_auth["type"] == "user" else None
    )
    db.add(new_key)
    db.commit()
    db.refresh(new_key)
    return new_key


@app.get("/api-keys", response_model=list[APIKeyResponse])
async def list_api_keys(
    db: Session = Depends(get_db),
    current_auth: dict = Depends(get_current_active_user)
):
    """List all API keys"""
    return db.query(APIKeyRecord).all()


@app.delete("/api-keys/{key_id}")
async def delete_api_key(
    key_id: int,
    db: Session = Depends(get_db),
    current_auth: dict = Depends(get_current_active_user)
):
    """Delete an API key"""
    key = db.query(APIKeyRecord).filter(APIKeyRecord.id == key_id).first()
    if not key:
        raise HTTPException(status_code=404, detail="API key not found")
    db.delete(key)
    db.commit()
    return {"message": "API key deleted"}


@app.put("/api-keys/{key_id}/deactivate")
async def deactivate_api_key(
    key_id: int,
    db: Session = Depends(get_db),
    current_auth: dict = Depends(get_current_active_user)
):
    """Deactivate an API key"""
    key = db.query(APIKeyRecord).filter(APIKeyRecord.id == key_id).first()
    if not key:
        raise HTTPException(status_code=404, detail="API key not found")
    key.is_active = False
    db.commit()
    return {"message": "API key deactivated"}


# --- Endpoints ---

@app.get("/")
def read_root():
    return {"message": "Welcome to the Cresco Tunnel Manager API. Visit /docs for documentation."}

@app.post("/tunnels")
def create_tunnel(
    req: TunnelCreateRequest, 
    db: Session = Depends(get_db),
    current_auth: dict = Depends(get_current_active_user)
):
    """
    Launch a new direct tunnel between a source node and a destination node.
    Requires authentication (API Key or JWT token).
    """
    if not stunnel_manager:
         raise HTTPException(status_code=500, detail="Stunnel manager not initialized (Check Cresco connection).")
         
    tunnel_id = str(uuid.uuid1())
    
    response = stunnel_manager.create_tunnel(
        stunnel_id=tunnel_id,
        src_region=req.src_region,
        src_agent=req.src_agent,
        src_port=req.src_port,
        dst_region=req.dst_region,
        dst_agent=req.dst_agent,
        dst_host=req.dst_host,
        dst_port=req.dst_port,
        buffer_size=req.buffer_size
    )

    if response is None:
        raise HTTPException(status_code=400, detail="Failed to create direct tunnel. Verify agents and plugins.")

    src_plugin_id = stunnel_manager.find_existing_stunnel_plugin(req.src_region, req.src_agent)

    db_tunnel = TunnelRecord(
        stunnel_id=tunnel_id,
        src_region=req.src_region,
        src_agent=req.src_agent,
        src_port=req.src_port,
        dst_region=req.dst_region,
        dst_agent=req.dst_agent,
        dst_host=req.dst_host,
        dst_port=req.dst_port,
        buffer_size=req.buffer_size,
        stunnel_plugin_id=src_plugin_id
    )
    db.add(db_tunnel)
    db.commit()
    db.refresh(db_tunnel)
        
    return {
        "message": f"Direct Tunnel {tunnel_id} created successfully.", 
        "data": response
    }

@app.post("/tunnels-proxy")
def create_tunnel_proxy(
    req: TunnelCreateRequest, 
    db: Session = Depends(get_db),
    current_auth: dict = Depends(get_current_active_user)
):
    """
    Launch a new tunnel between a source node and a destination node.
    Requires authentication (API Key or JWT token).
    """
    if not stunnel_manager:
         raise HTTPException(status_code=500, detail="Stunnel manager not initialized (Check Cresco connection).")
         
    if not proxy_region or not proxy_agent:
        raise HTTPException(status_code=500, detail="Proxy node is not configured in config.ini")

    import random
    proxy_port = str(random.randint(10000, 60000))
         
    hop1_id = str(uuid.uuid1())
    hop2_id = str(uuid.uuid1())
    
    # Hop 1: Source to Proxy
    response_hop1 = stunnel_manager.create_tunnel(
        stunnel_id=hop1_id,
        src_region=req.src_region,
        src_agent=req.src_agent,
        src_port=req.src_port,
        dst_region=proxy_region,
        dst_agent=proxy_agent,
        dst_host=proxy_host,
        dst_port=proxy_port,
        buffer_size=req.buffer_size
    )

    # Hop 2: Proxy to Destination
    response_hop2 = stunnel_manager.create_tunnel(
        stunnel_id=hop2_id,
        src_region=proxy_region,
        src_agent=proxy_agent,
        src_port=proxy_port,
        dst_region=req.dst_region,
        dst_agent=req.dst_agent,
        dst_host=req.dst_host,
        dst_port=req.dst_port,
        buffer_size=req.buffer_size
    )

    if response_hop1 is None or response_hop2 is None:
        raise HTTPException(status_code=400, detail="Failed to create proxy tunnel hops. Verify agents and plugins.")

    src_plugin_id = stunnel_manager.find_existing_stunnel_plugin(req.src_region, req.src_agent)
    proxy_plugin_id = stunnel_manager.find_existing_stunnel_plugin(proxy_region, proxy_agent)

    # Persist Hop 1 to DB
    db_tunnel_hop1 = TunnelRecord(
        stunnel_id=hop1_id,
        src_region=req.src_region,
        src_agent=req.src_agent,
        src_port=req.src_port,
        dst_region=proxy_region,
        dst_agent=proxy_agent,
        dst_host=proxy_host,
        dst_port=proxy_port,
        buffer_size=req.buffer_size,
        stunnel_plugin_id=src_plugin_id
    )
    db.add(db_tunnel_hop1)

    # Persist Hop 2 to DB
    db_tunnel_hop2 = TunnelRecord(
        stunnel_id=hop2_id,
        src_region=proxy_region,
        src_agent=proxy_agent,
        src_port=proxy_port,
        dst_region=req.dst_region,
        dst_agent=req.dst_agent,
        dst_host=req.dst_host,
        dst_port=req.dst_port,
        buffer_size=req.buffer_size,
        stunnel_plugin_id=proxy_plugin_id
    )
    db.add(db_tunnel_hop2)
    
    db.commit()
    db.refresh(db_tunnel_hop1)
    db.refresh(db_tunnel_hop2)
        
    return {
        "message": f"Proxy Tunnels {hop1_id} and {hop2_id} created successfully.", 
        "data": {
            "hop1": response_hop1,
            "hop2": response_hop2
        }
    }

@app.post("/tunnels-load-balanced")
def create_tunnel_load_balanced(
    req: LoadBalancedTunnelRequest, 
    db: Session = Depends(get_db),
    current_auth: dict = Depends(get_current_active_user)
):
    """
    Launch two tunnels to a destination and configure HAProxy locally to round-robin between them.
    req.src_port will be what HAProxy binds to locally.
    Requires authentication (API Key or JWT token).
    """
    if not stunnel_manager or not cresco_client:
         raise HTTPException(status_code=500, detail="Stunnel manager or Cresco client not initialized.")
         
    if not req.destinations:
         raise HTTPException(status_code=400, detail="At least one destination must be provided.")
         
    import random
    import uuid
    
    src_plugin_id = stunnel_manager.find_existing_stunnel_plugin(req.src_region, req.src_agent)
    
    tunnel_ids = []
    haproxy_servers = []
    
    for i, dest in enumerate(req.destinations):
        if ":" not in dest:
            raise HTTPException(status_code=400, detail=f"Invalid destination format: '{dest}'. Expected 'host:port'.")
            
        dst_host, dst_port = dest.split(":", 1)
        tunnel_port = str(random.randint(10000, 60000))
        tunnel_id = str(uuid.uuid1())
        
        response = stunnel_manager.create_tunnel(
            stunnel_id=tunnel_id,
            src_region=req.src_region,
            src_agent=req.src_agent,
            src_port=tunnel_port,
            dst_region=req.dst_region,
            dst_agent=req.dst_agent,
            dst_host=dst_host,
            dst_port=dst_port,
            buffer_size=req.buffer_size
        )

        if response is None:
            raise HTTPException(status_code=400, detail=f"Failed to create tunnel for {dest}.")

        # Save to local db
        db_tunnel = TunnelRecord(
            stunnel_id=tunnel_id,
            src_region=req.src_region,
            src_agent=req.src_agent,
            src_port=tunnel_port,
            dst_region=req.dst_region,
            dst_agent=req.dst_agent,
            dst_host=dst_host,
            dst_port=dst_port,
            buffer_size=req.buffer_size,
            stunnel_plugin_id=src_plugin_id
        )
        db.add(db_tunnel)
        
        tunnel_ids.append(tunnel_id)
        haproxy_servers.append(f"    server t{i+1} 127.0.0.1:{tunnel_port} check")
        
    db.commit()
    
    # Now deploy and configure HAProxy
    deployer = HAProxyDeployer(cresco_client, logger)
    jar_url = "https://github.com/valogan/cresco-haproxy-plugin/releases/download/third/haproxy-1.2-SNAPSHOT.jar"
    
    pipeline_id = deployer.deploy_haproxy_plugin(req.src_region, req.src_agent, jar_url)
    
    if not pipeline_id:
        raise HTTPException(status_code=500, detail="Failed to deploy HAProxy plugin.")
        
    pipeline_config = cresco_client.globalcontroller.get_pipeline_info(pipeline_id)
    plugin_id = pipeline_config['nodes'][0]['node_id']
    
    servers_block = "\n".join(haproxy_servers)
    
    haproxy_config = f"""
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
    bind *:{req.src_port}
    default_backend tunnel_backend

backend tunnel_backend
    balance roundrobin
{servers_block}
"""

    cresco_client.messaging.global_plugin_msgevent(True, 'CONFIG', {
        'action': 'build_config',
        'haproxy_config_data': haproxy_config
    }, req.src_region, req.src_agent, plugin_id)
    
    cresco_client.messaging.global_plugin_msgevent(True, 'CONFIG', {
        'action': 'start_haproxy'
    }, req.src_region, req.src_agent, plugin_id)
    
    return {
        "message": f"Load balanced tunnels created and HAProxy configured successfully on port {req.src_port}.",
        "data": {
            "tunnels": tunnel_ids,
            "haproxy_pipeline": pipeline_id,
            "haproxy_plugin": plugin_id
        }
    }


@app.options("/tunnels")
@app.options("/tunnels-proxy")
@app.options("/tunnels-load-balanced")
async def tunnels_preflight(request: Request):
    """Handle CORS preflight requests for /tunnels explicitly.
    This ensures OPTIONS requests receive the appropriate CORS headers
    even if middleware isn't intercepting for some deployment setups.
    """
    origin = request.headers.get("origin") or "*"
    request_headers = request.headers.get("access-control-request-headers", "*")
    headers = {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE",
        "Access-Control-Allow-Headers": request_headers,
        "Access-Control-Allow-Credentials": "true",
    }
    return Response(status_code=204, headers=headers)


from typing import Optional

@app.websocket("/ws/tunnels")
async def websocket_tunnels(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Client doesn't need to send us anything, but we keep the connection alive
            # by awaiting messages. If client drops, receive_text() raises an exception.
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)

@app.get("/tunnels")
def get_tunnels(
    src_region: Optional[str] = Query(None, description="The source region to filter by"),
    src_agent: Optional[str] = Query(None, description="The source agent to filter by"),
    src_plugin_id: Optional[str] = Query(None, description="The ID of the source stunnel plugin (e.g. system-io.cresco.stunnel...)"),
    dst_region: Optional[str] = Query(None, description="The destination region to filter by"),
    dst_agent: Optional[str] = Query(None, description="The destination agent to filter by"),
    src_port: Optional[str] = Query(None, description="The source port to filter by"),
    dst_host: Optional[str] = Query(None, description="The destination host to filter by"),
    dst_port: Optional[str] = Query(None, description="The destination port to filter by"),
    db: Session = Depends(get_db),
    current_auth: dict = Depends(get_current_active_user)
):
    """
    Retrieve a list of database tunnels.
    Provide optional query parameters to filter the results.
    Requires authentication (API Key or JWT token).
    """
    return build_tunnels_response(
        db, src_region, src_agent, src_plugin_id, dst_region, dst_agent,
        src_port, dst_host, dst_port
    )

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


@app.get("/tunnels/{stunnel_id}/config")
def get_tunnel_config(
    stunnel_id: str,
    src_region: str = Query(..., description="The source region of the stunnel plugin"),
    src_agent: str = Query(..., description="The source agent of the stunnel plugin"),
    src_plugin_id: str = Query(..., description="The ID of the source stunnel plugin (e.g. system-io.cresco.stunnel...)")
):
    """
    Retrieve the configuration of a specific tunnel by its ID.
    Requires specifying the overarching source node and plugin ID.
    """
    if not stunnel_manager:
         raise HTTPException(status_code=500, detail="Stunnel manager not initialized.")
         
    config = stunnel_manager.get_tunnel_config(
        src_region=src_region,
        src_agent=src_agent,
        src_plugin_id=src_plugin_id,
        stunnel_id=stunnel_id
    )
    
    if config is None:
        raise HTTPException(status_code=404, detail=f"No config found for tunnel {stunnel_id}.")
        
    return {"stunnel_id": stunnel_id, "config": config}

    
@app.delete("/tunnels/{stunnel_id}")
def delete_tunnel(
    stunnel_id: str,
    db: Session = Depends(get_db),
    current_auth: dict = Depends(get_current_active_user)
):
    """
    Remove a tunnel from the Cresco global controller and database by its ID.
    Note: The stunnel_id here must correspond to the pipeline ID assigned by Cresco.
    Requires authentication (API Key or JWT token).
    """
    logger.info(f"--- ENTERING delete_tunnel(stunnel_id='{stunnel_id}') ---")
    if not cresco_client:
         logger.error("Cresco client not connected!")
         raise HTTPException(status_code=500, detail="Cresco client not connected.")
         
    try:
        logger.info(f"Calling cresco_client.globalcontroller.remove_pipeline('{stunnel_id}')")
        response = cresco_client.globalcontroller.remove_pipeline(stunnel_id)
        logger.info(f"remove_pipeline response: {response}")
        
        # Optionally remove from database to keep it clean
        logger.info("Querying local DB for tunnel record...")
        db_tunnel = db.query(TunnelRecord).filter(
            (TunnelRecord.stunnel_id == stunnel_id) | 
            (TunnelRecord.stunnel_plugin_id == stunnel_id)
        ).first()
        
        if db_tunnel:
            logger.info(f"Found record in DB: stunnel_id={db_tunnel.stunnel_id}, plugin_id={db_tunnel.stunnel_plugin_id}. Deleting...")
            dst_region = db_tunnel.dst_region
            dst_agent = db_tunnel.dst_agent
            db.delete(db_tunnel)
            db.commit()
            logger.info("DB record deleted.")
            
            # Restart the destination agent as requested
            try:
                logger.info(f"Restarting destination agent {dst_region}/{dst_agent}...")
                cresco_client.admin.restartframework(dst_region, dst_agent)
                logger.info("Restart command sent.")
            except Exception as e:
                logger.error(f"Failed to restart destination agent {dst_region}/{dst_agent}: {e}")
        else:
            logger.warning(f"No corresponding record found in local DB for '{stunnel_id}'.")
            
        logger.info("--- EXITING delete_tunnel (Success) ---")
        return {"stunnel_id": stunnel_id, "status": "Request sent", "response": response}
    except Exception as e:
        logger.error(f"Failed to delete tunnel {stunnel_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete tunnel: {str(e)}")


@app.post("/agents/{region}/{agent}/restart")
def restart_agent(region: str, agent: str, current_auth: dict = Depends(get_current_active_user)):
    """
    Restart the Cresco framework on a specific agent.
    Requires authentication (API Key or JWT token).
    """
    if not cresco_client:
        raise HTTPException(status_code=500, detail="Cresco client not connected.")
    
    try:
        logger.info(f"Restarting agent {region}/{agent} via API...")
        cresco_client.admin.restartframework(region, agent)
        return {"message": f"Restart command sent to agent {region}/{agent}"}
    except Exception as e:
        logger.error(f"Failed to restart agent {region}/{agent}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to restart agent: {str(e)}")

@app.post("/agents/{region}/{agent}/stop")
def stop_agent(region: str, agent: str, current_auth: dict = Depends(get_current_active_user)):
    """
    Stop the Cresco controller on a specific agent.
    Requires authentication (API Key or JWT token).
    """
    if not cresco_client:
        raise HTTPException(status_code=500, detail="Cresco client not connected.")
    
    try:
        logger.info(f"Stopping agent {region}/{agent} via API...")
        cresco_client.admin.stopcontroller(region, agent)
        return {"message": f"Stop command sent to agent {region}/{agent}"}
    except Exception as e:
        logger.error(f"Failed to stop agent {region}/{agent}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to stop agent: {str(e)}")

@app.get("/agents")
def get_agents(current_auth: dict = Depends(get_current_active_user)):
    """
    Retrieve a list of agents from the Cresco global controller.
    Requires authentication (API Key or JWT token).
    """
    if not cresco_client:
        raise HTTPException(status_code=500, detail="Cresco client not connected.")
        
    try:
        logger.info("Fetching agent list from Cresco global controller...")
        agents = cresco_client.globalcontroller.get_agent_list()
        # Ensure we return valid JSON (list of dicts typically)
        return {"agents": agents}
    except Exception as e:
        logger.error(f"Failed to fetch agent list: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch agents: {str(e)}")

@app.get("/agents/with-stunnel-plugins")
def get_agents_with_stunnel_plugins(detailed: bool = Query(False, description="Include detailed tunnel configuration with port information")):
    """
    Retrieve a list of agents and find stunnel plugins on each agent.
    Returns agents with their stunnel plugin IDs if found.
    """
    logger.info(f"GET /agents/with-stunnel-plugins called with detailed={detailed}")
    if not cresco_client:
        raise HTTPException(status_code=500, detail="Cresco client not connected.")
    if not stunnel_manager:
        raise HTTPException(status_code=500, detail="Stunnel manager not initialized.")
        
    try:
        logger.info("Fetching agent list and checking for stunnel plugins...")
        agents = cresco_client.globalcontroller.get_agent_list()
        
        enhanced_agents = []
        for agent in agents:
            region = agent.get('region') or agent.get('region_id')
            agent_name = agent.get('agent') or agent.get('agent_id')
            
            if not region or not agent_name:
                continue
                
            # Find stunnel plugin on this agent
            plugin_id = None
            try:
                plugin_id = stunnel_manager.find_existing_stunnel_plugin(region, agent_name)
            except Exception as e:
                logger.warning(f"Error finding stunnel plugin on {region}/{agent_name}: {e}")
            
            enhanced_agent = {
                **agent,
                "stunnel_plugin_found": plugin_id is not None,
                "stunnel_plugin_id": plugin_id
            }
            
            # If plugin found, get tunnels from this agent
            tunnels = []
            if plugin_id:
                try:
                    tunnel_list = stunnel_manager.get_tunnel_list(region, agent_name, plugin_id)
                    if tunnel_list:
                        # Enhance tunnel data with detailed configuration if requested
                        enhanced_tunnels = []
                        for tunnel in tunnel_list:
                            enhanced_tunnel = {
                                "stunnel_id": tunnel.get("stunnel_id"),
                                "status": tunnel.get("status")
                            }
                            
                            # If detailed flag is True, fetch tunnel configuration
                            if detailed and tunnel.get("stunnel_id"):
                                logger.info(f"Fetching config for tunnel {tunnel['stunnel_id']} on {region}/{agent_name}")
                                try:
                                    config = stunnel_manager.get_tunnel_config(
                                        src_region=region,
                                        src_agent=agent_name,
                                        src_plugin_id=plugin_id,
                                        stunnel_id=tunnel["stunnel_id"]
                                    )
                                    if config:
                                        enhanced_tunnel["config"] = config
                                        # Extract key fields for easier access
                                        enhanced_tunnel["src_port"] = config.get("src_port")
                                        enhanced_tunnel["dst_port"] = config.get("dst_port")
                                        enhanced_tunnel["dst_host"] = config.get("dst_host")
                                        enhanced_tunnel["dst_region"] = config.get("dst_region")
                                        enhanced_tunnel["dst_agent"] = config.get("dst_agent")
                                        enhanced_tunnel["dst_plugin"] = config.get("dst_plugin")
                                        enhanced_tunnel["buffer_size"] = config.get("buffer_size")
                                        logger.info(f"Added config for tunnel {tunnel['stunnel_id']}: src_port={config.get('src_port')}, dst_port={config.get('dst_port')}")
                                    else:
                                        logger.warning(f"No config returned for tunnel {tunnel['stunnel_id']}")
                                except Exception as e:
                                    logger.warning(f"Error fetching config for tunnel {tunnel['stunnel_id']}: {e}")
                            
                            enhanced_tunnels.append(enhanced_tunnel)
                        
                        tunnels = enhanced_tunnels
                except Exception as e:
                    logger.warning(f"Error getting tunnels from {region}/{agent_name}: {e}")
            
            enhanced_agent["tunnels"] = tunnels
            enhanced_agents.append(enhanced_agent)
        
        result = {
            "agents": enhanced_agents,
            "total_agents": len(enhanced_agents),
            "agents_with_stunnel": len([a for a in enhanced_agents if a["stunnel_plugin_found"]]),
            "total_tunnels": sum(len(a["tunnels"]) for a in enhanced_agents),
            "detailed": detailed
        }
        logger.info(f"Returning response with detailed={detailed}")
        return result
    except Exception as e:
        logger.error(f"Failed to fetch agents with stunnel plugins: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch agents with stunnel plugins: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    # Running programmatically if file is executed directly
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)

