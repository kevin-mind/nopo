# Adding New Services

This guide explains how to add a new service to the infrastructure. The deployment system automatically discovers services from the `apps/` directory.

## Quick Start

To add a new service:

1. Create a directory in `apps/` with a `Dockerfile`
2. (Optional) Add an `infrastructure.json` for custom configuration
3. Push to `main` - the service will be automatically deployed

## Step-by-Step Guide

### 1. Create the Service Directory

```bash
mkdir -p apps/my-new-service
```

### 2. Add a Dockerfile

The service must have a `Dockerfile` in its root directory to be discovered:

```dockerfile
# apps/my-new-service/Dockerfile
FROM node:22-slim

WORKDIR /app
COPY . .
RUN npm install
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
```

### 3. Add Infrastructure Configuration (Optional)

Create `apps/my-new-service/infrastructure.json` to customize deployment settings:

```json
{
  "cpu": "1",
  "memory": "512Mi",
  "port": 3000,
  "min_instances": 0,
  "max_instances": 10,
  "has_database": false,
  "run_migrations": false
}
```

#### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cpu` | string | `"1"` | CPU allocation (e.g., `"0.5"`, `"1"`, `"2"`) |
| `memory` | string | `"512Mi"` | Memory allocation (e.g., `"256Mi"`, `"1Gi"`) |
| `port` | number | `3000` | Container port to expose |
| `min_instances` | number | `0` | Minimum instances (0 = scale to zero) |
| `max_instances` | number | `10` | Maximum instances for auto-scaling |
| `has_database` | boolean | `false` | Whether service needs database access |
| `run_migrations` | boolean | `false` | Whether to create a migration job |

### 4. Add Health Check Endpoint

Your service must expose a `/__version__` endpoint for health checks:

```javascript
// Example Express.js
app.get('/__version__', (req, res) => {
  res.json({
    version: process.env.VERSION || 'unknown',
    service: 'my-new-service'
  });
});
```

### 5. Deploy

Push to `main` branch. The CI/CD pipeline will:

1. Discover the new service automatically
2. Build and push the Docker image
3. Update Terraform configuration
4. Deploy to Cloud Run
5. Configure load balancer routing

## Load Balancer Routing

By default, services are routed based on their `has_database` setting:

- **Services with `has_database: true`**: Receive traffic for `/api/*`, `/admin/*`, `/django/*`, `/static/*`
- **Services with `has_database: false`**: Receive all other traffic (default route)

### Custom Routing

For custom routing, you'll need to modify the load balancer Terraform configuration:

```hcl
# infrastructure/terraform/modules/loadbalancer/main.tf
path_rule {
  paths   = ["/my-service", "/my-service/*"]
  service = google_compute_backend_service.services["my-new-service"].id
}
```

## Service Types

### Frontend Service (No Database)

```json
{
  "cpu": "1",
  "memory": "256Mi",
  "port": 3000,
  "has_database": false,
  "run_migrations": false
}
```

### Backend Service (With Database)

```json
{
  "cpu": "1",
  "memory": "512Mi",
  "port": 3000,
  "has_database": true,
  "run_migrations": true
}
```

### Worker Service (Background Jobs)

```json
{
  "cpu": "2",
  "memory": "1Gi",
  "port": 8080,
  "min_instances": 1,
  "has_database": true,
  "run_migrations": false
}
```

## Environment Variables

All services automatically receive these environment variables:

| Variable | Description |
|----------|-------------|
| `SERVICE_NAME` | The service name (directory name) |
| `PORT` | The configured port |
| `SITE_URL` | The public URL (e.g., `https://example.com`) |

Services with `has_database: true` also receive:

| Variable | Description |
|----------|-------------|
| `DB_HOST` | Database host (private IP) |
| `DB_NAME` | Database name |
| `DB_USER` | Database username |
| `DB_PASSWORD` | Database password (from Secret Manager) |
| `SECRET_KEY` | Application secret key (from Secret Manager) |

## Removing a Service

To remove a service:

1. Delete the directory from `apps/`
2. Push to `main`
3. Terraform will automatically destroy the Cloud Run service

**Note:** The load balancer configuration will update automatically.

## Local Development

Test service discovery locally:

```bash
# Run the sync script to see what services would be discovered
./infrastructure/scripts/sync-services.sh --dry-run

# Output:
# [INFO] Scanning for services in: /path/to/apps
# [INFO]   Found service: backend
# [INFO]   Found service: web
# [INFO]   Found service: my-new-service
# [INFO] Discovered 3 service(s)
```

## Troubleshooting

### Service Not Discovered

1. Ensure there's a `Dockerfile` in the service directory
2. Check the directory is directly under `apps/` (not nested)
3. Verify the sync script finds it: `./infrastructure/scripts/sync-services.sh --dry-run`

### Service Not Deploying

1. Check GitHub Actions logs for build errors
2. Verify the Dockerfile builds successfully locally
3. Check Cloud Run logs: `gcloud run services logs read nopo-{env}-{service}`

### Database Connection Issues

1. Verify `has_database: true` in `infrastructure.json`
2. Check VPC connector is configured
3. Verify service account has Cloud SQL Client role

### Health Check Failures

1. Ensure `/__version__` endpoint returns 200 OK
2. Check the endpoint responds within 10 seconds
3. Verify the correct port is configured

## Example: Adding an API Gateway

```bash
# 1. Create directory
mkdir -p apps/api-gateway

# 2. Create Dockerfile
cat > apps/api-gateway/Dockerfile << 'EOF'
FROM nginx:alpine
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
EOF

# 3. Create infrastructure config
cat > apps/api-gateway/infrastructure.json << 'EOF'
{
  "cpu": "0.5",
  "memory": "128Mi",
  "port": 8080,
  "min_instances": 1,
  "max_instances": 5,
  "has_database": false,
  "run_migrations": false
}
EOF

# 4. Commit and push
git add apps/api-gateway
git commit -m "Add API gateway service"
git push origin main
```

The service will be automatically discovered, built, and deployed!
