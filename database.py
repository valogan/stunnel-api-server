from sqlalchemy import create_engine, Column, Integer, String, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
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
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
