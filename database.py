from sqlalchemy import create_engine, Column, Integer, String, DateTime, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import bcrypt
import datetime
import os

# Define the default SQLite database path if Postgres isn't configured for local runs
# Usually you would get this from an environment variable set by Docker Compose
SQLALCHEMY_DATABASE_URL = os.environ.get(
    "DATABASE_URL", 
    "sqlite:///./tunnels.db"
)

# For SQLite, we need connect_args={"check_same_thread": False}
# For Postgres, we don't need it.
connect_args = {"check_same_thread": False} if SQLALCHEMY_DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args=connect_args
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class TunnelRecord(Base):
    __tablename__ = "tunnels"

    id = Column(Integer, primary_key=True, index=True)
    stunnel_id = Column(String, unique=True, index=True)
    src_region = Column(String, index=True)
    src_agent = Column(String, index=True)
    src_port = Column(String)
    dst_region = Column(String, index=True)
    dst_agent = Column(String, index=True)
    dst_host = Column(String)
    dst_port = Column(String)
    buffer_size = Column(String)
    stunnel_plugin_id = Column(String)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class UserRecord(Base):
    """Web portal users for JWT authentication"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    is_active = Column(Boolean, default=True)
    role = Column(String, default="user")  # user, admin
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    def verify_password(self, plain_password: str) -> bool:
        """Verify a password against the stored hash"""
        password_bytes = plain_password.encode('utf-8')
        hashed_bytes = self.hashed_password.encode('utf-8')
        return bcrypt.checkpw(password_bytes, hashed_bytes)

    @staticmethod
    def hash_password(password: str) -> str:
        """Hash a password for storage"""
        password_bytes = password.encode('utf-8')
        salt = bcrypt.gensalt()
        hashed = bcrypt.hashpw(password_bytes, salt)
        return hashed.decode('utf-8')


class APIKeyRecord(Base):
    """API keys for programmatic access"""
    __tablename__ = "api_keys"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, index=True)
    name = Column(String)  # Description/label for the key
    is_active = Column(Boolean, default=True)
    created_by = Column(Integer)  # User ID who created it (nullable for system keys)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    last_used = Column(DateTime, nullable=True)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
