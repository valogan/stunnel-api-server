# Cresco Tunnel Manager API

FastAPI service for managing Cresco stunnel pipelines, optional proxy hop tunneling, load-balanced tunnel fronting with HAProxy, and Proxy Shield plugin operations.

## What This Service Does

- Connects to a Cresco controller using values from `config.ini`.
- Persists tunnel records in PostgreSQL.
- Creates and removes stunnel tunnels through Cresco messaging.
- Streams tunnel/agent updates over WebSocket at `/ws/tunnels`.
- Exposes REST APIs for tunnels, agents, and Proxy Shield lifecycle/config operations.

## Configuration

The API reads `config.ini` on startup.

### Required section

```ini
[general]
host=<cresco_host>
port=<cresco_port>
service_key=<service_key>
```

From the current `config.ini`:

- `host=128.163.202.50`
- `port=8282`
- `service_key=<service_key>`

### Optional proxy section

Used by `POST /tunnels-proxy`.

```ini
[proxy]
region=<proxy_region>
agent=<proxy_agent>
host=<proxy_host_or_localhost>
```

If the section is missing, proxy tunneling endpoint calls fail with a 500 indicating proxy node is not configured. Mitchell, you do not need this.

## Running with Docker Compose

`docker-compose.yml` defines three services:

- `db`: PostgreSQL 15 (`cresco_postgres`)
- `api`: FastAPI service (`cresco_api`)
- `web`: nginx static frontend (`cresco_web`)

### Exposed ports

- API: `http://localhost:8005` (container `8000`)
- Swagger docs: `http://localhost:8005/docs`
- Web UI: `http://localhost:8081`
- PostgreSQL: `localhost:5431` (container `5432`)

### API environment variable

The compose file passes:

```bash
DATABASE_URL=postgresql://cresco_user:cresco_password@cresco_postgres:5432/cresco_tunnels
```

### Start

```bash
docker compose up --build -d
```

### Stop

```bash
docker compose down
```

To also remove DB volume data:

```bash
docker compose down -v
```

## Quick Start

The easiest way to use this is the web interface at http://localhost:8081. The Graph View works for creating and destroying tunnels. Click an agent once, then click, hold, and drag the edge to another agent to create a tunnel. Click on an edge to delete a tunnel.

You can also restart and stop agents from the Agents page. I would ignore the Load Balanced page. It's under development.