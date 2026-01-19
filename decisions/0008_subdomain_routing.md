# Subdomain-Based Routing

Date: 2026-01-19

Status: accepted

## Context

The nopo project uses a reverse proxy (nginx) to route traffic to different services. The current approach uses path-based routing:

- `/api/*` routes to the backend service
- `/*` routes to the web frontend

This has several limitations:

1. **nginx configuration complexity**: Every service requires explicit path rewriting rules in nginx.
2. **Path conflicts**: Services cannot use overlapping paths without careful coordination.
3. **Environment inconsistency**: Local development differs from production routing, where services may have dedicated domains.
4. **Service isolation**: Path-based routing makes it harder to implement per-service policies (rate limiting, authentication, caching).

Modern cloud platforms (Cloud Run, Fly.io) naturally route traffic to services by hostname. Aligning local development with this model simplifies configuration and reduces deployment surprises.

## Decision

We will switch from path-based routing to **subdomain-based routing** where each service is accessed via its own subdomain.

### Routing Pattern

| Environment | Format | Example |
|-------------|--------|---------|
| Production | `<service>.<domain>` | `api.lenzhardt.org`, `web.lenzhardt.org` |
| Staging | `<service>.staging.<domain>` | `api.staging.lenzhardt.org` |
| Local | `<service>.localhost:5000` | `api.localhost:5000`, `web.localhost:5000` |

The `.localhost` TLD is reserved by RFC 6761 and resolves to `127.0.0.1` in all modern browsers without `/etc/hosts` configuration.

### Route Visibility Configuration

Services define route visibility in their `nopo.yml` file under `runtime.routes`:

```yaml
name: backend

runtime:
  routes:
    private:
      - /admin/internal
      - /metrics
```

The schema supports four configurations:

| Configuration | Meaning |
|--------------|---------|
| `routes` omitted or `routes: {}` | All routes public (default) |
| `routes.private: ["/path1", "/path2"]` | Listed paths return 404 for public traffic |
| `routes.private: true` | All routes private (service-to-service only) |
| `routes: false` | No routes at all (isolated service) |

### Traffic Headers

Public traffic from the load balancer includes:
```
X-Traffic-Source: public
```

Service-to-service traffic includes:
```
X-Service-Origin: <calling-service-name>
```

Services can trust these headers when they originate from the load balancer (validated by infrastructure). Internal traffic bypasses `private` route restrictions.

### DNS and SSL

- **DNS**: Cloudflare wildcard records (`*` and `*.staging`) point to load balancer IPs
- **SSL**: Wildcard certificates per environment (`*.lenzhardt.org`, `*.staging.lenzhardt.org`)
- **Local**: No SSL needed; browsers accept `http://*.localhost` without warnings

### Canary Routing

Header-based canary routing remains unchanged. Requests with canary headers (e.g., `X-Canary: true`) route to canary backends at the same subdomain.

## Consequences

### Benefits

- **Simplified nginx**: No path rewriting; each service is a simple `server_name` block
- **Cloud-native alignment**: Matches how Cloud Run and Fly.io route by hostname
- **Per-service policies**: Rate limiting, authentication, and caching can be scoped per subdomain
- **Environment parity**: Local development uses the same routing model as production
- **Zero-config local DNS**: `.localhost` TLD works in all modern browsers without `/etc/hosts`

### Trade-offs

- **Frontend changes**: API calls must use absolute URLs (e.g., `https://api.lenzhardt.org/...`) instead of relative paths (`/api/...`)
- **CORS configuration**: Cross-subdomain requests require proper CORS headers
- **Cookie scope**: Authentication cookies need explicit domain configuration for cross-subdomain sharing

### Implementation Phases

1. **Schema & Design** (this ADR): Add `runtime.routes` schema to nopo configuration
2. **Local Development**: Update nginx to use `server_name` based virtual hosts
3. **Django Backend**: Configure `ALLOWED_HOSTS`, CORS headers, and traffic header validation
4. **GCP Infrastructure**: Update load balancer to host-based routing with private route blocking
5. **Testing & Rollout**: Verify subdomain routing in all environments

### Mitigations

- **CORS**: Add `django-cors-headers` with explicit subdomain allowlist
- **Cookies**: Set `Domain=.lenzhardt.org` for shared authentication cookies
- **Frontend**: Use environment variables for API base URLs, allowing per-environment configuration
