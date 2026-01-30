# Backend

The backend django app.

This service provides a REST API built with Django and Django REST Framework.

## Database Configuration

### Connection Pooling

Django uses persistent database connections to improve performance by reusing connections instead of creating new ones for each request.

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `CONN_MAX_AGE` | `600` | Maximum lifetime (seconds) of a database connection. Set to `0` to close connections after each request. |
| `DB_CONN_HEALTH_CHECKS` | `true` | Enable health checks on persistent connections before reuse. Recommended for production. |
| `DATABASE_SSL` | `false` | Require SSL for database connections. |

**Example:**

```bash
# Production settings
export CONN_MAX_AGE=600
export DB_CONN_HEALTH_CHECKS=true
export DATABASE_SSL=true

# Development settings (close connections after each request)
export CONN_MAX_AGE=0
```
