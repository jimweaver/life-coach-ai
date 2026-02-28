# Life Coach AI - Docker Setup

This directory contains Docker configuration for running Life Coach AI in containerized environments.

## Quick Start

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f api

# Stop all services
docker-compose down
```

## Services

| Service | Description | Port |
|---------|-------------|------|
| `api` | Life Coach AI API server | 8787 |
| `postgres` | PostgreSQL 16 database | 5432 |
| `redis` | Redis 7 cache | 6379 |

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Required variables:
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_HOST` - Redis hostname (use `redis` in Docker)
- `REDIS_PORT` - Redis port (default: 6379)
- `PORT` - API port (default: 8787)
- `OPENAI_API_KEY` - For model calls
- `BRAVE_API_KEY` - For web search

## Development Mode

```bash
# Start with hot reload (mounts local code)
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

## Production Mode

```bash
# Production optimized build
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## Data Persistence

Data is persisted using Docker volumes:
- `postgres_data` - Database files
- `redis_data` - Redis cache

To reset data:
```bash
docker-compose down -v
```

## Health Checks

All services include health checks:
- API: `GET /health`
- PostgreSQL: `pg_isready`
- Redis: `redis-cli ping`

## Troubleshooting

### Port Already in Use

If ports are already in use, modify `docker-compose.yml`:
```yaml
ports:
  - "8788:8787"  # Use different host port
```

### Database Connection Issues

Ensure the API service waits for PostgreSQL to be ready:
```bash
docker-compose up -d postgres
sleep 5
docker-compose up -d api
```

### View Service Status

```bash
docker-compose ps
docker-compose logs [service-name]
```

## Building Custom Images

```bash
# Build API image
docker build -t life-coach-ai:latest -f Dockerfile .

# Run with custom image
docker run -p 8787:8787 --env-file .env life-coach-ai:latest
```
