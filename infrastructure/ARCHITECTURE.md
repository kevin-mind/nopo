# Infrastructure Architecture

This document provides a detailed explanation of the Google Cloud Platform infrastructure used to deploy and run the application.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Network Architecture](#network-architecture)
3. [Compute Layer (Cloud Run)](#compute-layer-cloud-run)
4. [Database Layer (Cloud SQL)](#database-layer-cloud-sql)
5. [Load Balancing & SSL](#load-balancing--ssl)
6. [Secrets Management](#secrets-management)
7. [Container Registry](#container-registry)
8. [Deployment Flow](#deployment-flow)
9. [Security Model](#security-model)
10. [Scaling & Performance](#scaling--performance)
11. [Cost Optimization](#cost-optimization)
12. [Disaster Recovery](#disaster-recovery)

---

## Architecture Overview

### High-Level Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    INTERNET                                          │
└─────────────────────────────────────┬───────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         GOOGLE CLOUD PLATFORM                                        │
│  ┌───────────────────────────────────────────────────────────────────────────────┐  │
│  │                    GLOBAL LOAD BALANCER (HTTPS)                               │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐   │  │
│  │  │ Static IP       │  │ Managed SSL     │  │ URL Map (Path Routing)      │   │  │
│  │  │ (Anycast)       │  │ Certificate     │  │                             │   │  │
│  │  └─────────────────┘  └─────────────────┘  │  /api/*    → Backend NEG    │   │  │
│  │                                            │  /admin/*  → Backend NEG    │   │  │
│  │                                            │  /django/* → Backend NEG    │   │  │
│  │                                            │  /static/* → GCS Bucket     │   │  │
│  │                                            │  /*        → Web NEG        │   │  │
│  │                                            └─────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                      │                                               │
│                    ┌─────────────────┼─────────────────┐                            │
│                    ▼                 ▼                 ▼                            │
│  ┌──────────────────────────┐ ┌──────────────────────────┐ ┌──────────────────────┐│
│  │   CLOUD RUN (Backend)    │ │    CLOUD RUN (Web)       │ │ CLOUD STORAGE (GCS)  ││
│  │  ┌────────────────────┐  │ │  ┌────────────────────┐  │ │ ┌──────────────────┐ ││
│  │  │ Django + DRF       │  │ │  │ React Router (SSR) │  │ │ │ Static Assets    │ ││
│  │  │ Gunicorn           │  │ │  │ Node.js            │  │ │ │ /backend/*       │ ││
│  │  │ Port 3000          │  │ │  │ Port 3000          │  │ │ │ /web/*           │ ││
│  │  └────────────────────┘  │ │  └────────────────────┘  │ │ │ (CDN enabled)    │ ││
│  │  • Auto-scaling (0-10)   │ │  • Auto-scaling (0-10)   │ │ └──────────────────┘ ││
│  │  • 1 vCPU, 512Mi-1Gi     │ │  • 1 vCPU, 256Mi-512Mi   │ │ • Public read access ││
│  └───────────┬──────────────┘ └──────────────────────────┘ │ • 1-year cache       ││
│              │                                              └──────────────────────┘│
│              │ VPC Connector                                                        │
│              ▼                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                           VPC NETWORK                                        │   │
│  │  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐  │   │
│  │  │ Subnet              │  │ VPC Connector       │  │ Private Services    │  │   │
│  │  │ 10.8.0.0/28         │  │ (Serverless VPC     │  │ Connection          │  │   │
│  │  │                     │  │  Access)            │  │ (Service Networking)│  │   │
│  │  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘  │   │
│  └─────────────────────────────────────┬───────────────────────────────────────┘   │
│                                        │                                            │
│                                        ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                         CLOUD SQL (PostgreSQL 16)                            │   │
│  │  ┌─────────────────────────────────────────────────────────────────────┐    │   │
│  │  │ • Private IP only (no public access)                                │    │   │
│  │  │ • Automated backups (daily, 7-day retention)                        │    │   │
│  │  │ • Point-in-time recovery enabled                                    │    │   │
│  │  │ • Query insights enabled                                            │    │   │
│  │  └─────────────────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                     │
│  ┌────────────────────────┐  ┌────────────────────────┐                            │
│  │    SECRET MANAGER      │  │   ARTIFACT REGISTRY    │                            │
│  │  • DB Password         │  │  • Docker Images       │                            │
│  │  • Django Secret Key   │  │  • backend:tag         │                            │
│  │                        │  │  • web:tag             │                            │
│  └────────────────────────┘  └────────────────────────┘                            │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Component Summary

| Component | GCP Service | Purpose |
|-----------|-------------|---------|
| Load Balancer | [Cloud Load Balancing](https://cloud.google.com/load-balancing/docs/https) | HTTPS termination, path-based routing |
| SSL Certificate | [Managed SSL](https://cloud.google.com/load-balancing/docs/ssl-certificates/google-managed-certs) | Automatic certificate provisioning |
| Backend Service | [Cloud Run](https://cloud.google.com/run/docs) | Django REST API |
| Web Service | [Cloud Run](https://cloud.google.com/run/docs) | React Router frontend |
| Static Assets | [Cloud Storage](https://cloud.google.com/storage/docs) + [Cloud CDN](https://cloud.google.com/cdn/docs) | CSS, JS, images with global caching |
| Database | [Cloud SQL](https://cloud.google.com/sql/docs/postgres) | PostgreSQL 16 |
| Networking | [VPC](https://cloud.google.com/vpc/docs) | Private network connectivity |
| Secrets | [Secret Manager](https://cloud.google.com/secret-manager/docs) | Secure credential storage |
| Container Registry | [Artifact Registry](https://cloud.google.com/artifact-registry/docs) | Docker image storage |

### Static Assets: Local vs Production

The `/static/*` path is handled differently in local development vs production,
but both use the same URL pattern from the application's perspective.

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                        STATIC FILE SERVING COMPARISON                                │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  LOCAL DEVELOPMENT (nopo up)                                                         │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                                │ │
│  │  Browser                                                                       │ │
│  │     │                                                                          │ │
│  │     │ GET /static/assets/style.css                                             │ │
│  │     ▼                                                                          │ │
│  │  ┌─────────────────────────────────┐                                           │ │
│  │  │         Nginx (Docker)          │  ← apps/nginx/templates/apps.conf.template   │ │
│  │  │                                 │  ← apps/nginx/templates/apps.local.template  │ │
│  │  │  location /static/ {            │                                           │ │
│  │  │    alias /app/apps/backend/     │                                           │ │
│  │  │          build/;                │  ← Serves from local filesystem           │ │
│  │  │  }                              │                                           │ │
│  │  │                                 │                                           │ │
│  │  │  location /static/vite {        │                                           │ │
│  │  │    proxy_pass → Vite dev server │  ← Hot reloading in dev mode              │ │
│  │  │  }                              │                                           │ │
│  │  └─────────────────────────────────┘                                           │ │
│  │                                                                                │ │
│  │  Environment:                                                                  │ │
│  │    STATIC_URL = /static/  (default, relative path)                             │ │
│  │                                                                                │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  PRODUCTION (GCP)                                                                    │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                                │ │
│  │  Browser                                                                       │ │
│  │     │                                                                          │ │
│  │     │ GET /static/backend/assets/style.css                                     │ │
│  │     ▼                                                                          │ │
│  │  ┌─────────────────────────────────┐                                           │ │
│  │  │     GCP Load Balancer           │  ← URL Map with path routing              │ │
│  │  │                                 │                                           │ │
│  │  │  /static/* → GCS Backend Bucket │  ← URL rewrite: strips /static/ prefix    │ │
│  │  │                                 │                                           │ │
│  │  └───────────────┬─────────────────┘                                           │ │
│  │                  │                                                             │ │
│  │                  ▼                                                             │ │
│  │  ┌─────────────────────────────────┐                                           │ │
│  │  │    Cloud Storage Bucket         │  gs://nopo-{env}-static/                  │ │
│  │  │                                 │                                           │ │
│  │  │    /backend/assets/style.css    │  ← Files organized by service             │ │
│  │  │    /backend/assets/main.js      │                                           │ │
│  │  │    /web/...                     │                                           │ │
│  │  │                                 │                                           │ │
│  │  │    + Cloud CDN (prod only)      │  ← Global edge caching                    │ │
│  │  └─────────────────────────────────┘                                           │ │
│  │                                                                                │ │
│  │  Environment:                                                                  │ │
│  │    STATIC_URL = https://domain.com/static/backend/  (full URL)                 │ │
│  │                                                                                │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  KEY DIFFERENCES:                                                                    │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                                │ │
│  │  Feature          │ Local (nginx)              │ Production (GCP)              │ │
│  │  ─────────────────┼────────────────────────────┼─────────────────────────────  │ │
│  │  Routing          │ nginx location blocks      │ Load Balancer URL Map         │ │
│  │  File source      │ Local filesystem (volume)  │ GCS bucket                    │ │
│  │  Hot reload       │ Vite dev server proxy      │ N/A (immutable assets)        │ │
│  │  Caching          │ None (dev)                 │ Cloud CDN (1 year)            │ │
│  │  URL pattern      │ /static/*                  │ /static/<service>/*           │ │
│  │  STATIC_URL env   │ /static/ (relative)        │ https://domain/static/svc/    │ │
│  │                                                                                │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**Why Different Approaches?**

| Aspect | Local (nginx) | Production (GCS) |
|--------|---------------|------------------|
| **Hot reloading** | ✅ Essential for DX | N/A |
| **File changes** | Instant via volume mount | Requires deployment |
| **CDN caching** | Not needed | Critical for performance |
| **Cost** | Free (local) | Pay per request/storage |
| **Setup complexity** | Simple nginx config | Terraform module + LB routing |

**Configuration Files:**

- **Local nginx**: `apps/nginx/templates/apps.conf.template` (main routing) + `apps/nginx/templates/apps.local.template` (static override)
- **Production routing**: `infrastructure/terraform/modules/loadbalancer/main.tf` (URL map)
- **Static bucket**: `infrastructure/terraform/modules/static-assets/main.tf`
- **Django config**: `apps/backend/settings.py` (`STATIC_URL` environment variable)

---

## Network Architecture

### VPC Network Design

```
┌─────────────────────────────────────────────────────────────────┐
│                    VPC: nopo-{env}-vpc                          │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Subnet: nopo-{env}-subnet                    │  │
│  │              CIDR: 10.8.0.0/28                            │  │
│  │              Region: us-central1                          │  │
│  │                                                           │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │         VPC Access Connector                        │  │  │
│  │  │         nopo-{env}-connector                        │  │  │
│  │  │         Min: 2 instances, Max: 3 instances          │  │  │
│  │  │                                                     │  │  │
│  │  │    Allows Cloud Run → VPC communication             │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │         Private Services Connection                       │  │
│  │         (Service Networking API)                          │  │
│  │                                                           │  │
│  │    Reserved IP Range: 10.x.0.0/16 (for Cloud SQL)        │  │
│  │    Peered with: servicenetworking.googleapis.com          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Firewall Rules:                                                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  allow-internal: TCP/UDP all ports, ICMP                  │  │
│  │  Source: 10.8.0.0/16                                      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Network Flow

```
                    Internet Request
                          │
                          ▼
              ┌───────────────────────┐
              │   Global IP (Anycast) │
              │   Closest Google POP  │
              └───────────┬───────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │   HTTPS Load Balancer │
              │   (SSL Termination)   │
              └───────────┬───────────┘
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
    ┌───────────────┐           ┌───────────────┐
    │  Backend NEG  │           │   Web NEG     │
    │ (Serverless)  │           │ (Serverless)  │
    └───────┬───────┘           └───────────────┘
            │
            │ (Database queries)
            ▼
    ┌───────────────┐
    │ VPC Connector │
    │ (10.8.0.0/28) │
    └───────┬───────┘
            │
            │ Private IP
            ▼
    ┌───────────────┐
    │   Cloud SQL   │
    │  (10.x.x.x)   │
    └───────────────┘
```

### Why This Design?

1. **Private Database Access**: Cloud SQL has no public IP, reducing attack surface
2. **VPC Connector**: Enables serverless Cloud Run to access private resources
3. **Private Services Connection**: Google-managed peering for Cloud SQL
4. **Minimal Subnet**: /28 provides 16 IPs, sufficient for VPC connector

**External Documentation:**
- [Serverless VPC Access](https://cloud.google.com/vpc/docs/serverless-vpc-access)
- [Private Services Access](https://cloud.google.com/vpc/docs/private-services-access)
- [Cloud SQL Private IP](https://cloud.google.com/sql/docs/postgres/private-ip)

---

## Compute Layer (Cloud Run)

### Service Configuration

```
┌─────────────────────────────────────────────────────────────────┐
│                    Cloud Run Service                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Container                                                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Image: {region}-docker.pkg.dev/{project}/nopo/{service}  │  │
│  │                                                           │  │
│  │  Resources:                                               │  │
│  │    CPU: 1 vCPU (throttled when idle)                      │  │
│  │    Memory: 512Mi (backend) / 256Mi (web)                  │  │
│  │    CPU Idle: true (cost optimization)                     │  │
│  │                                                           │  │
│  │  Probes:                                                  │  │
│  │    Startup:  GET /__version__ (10s initial, 10s period)   │  │
│  │    Liveness: GET /__version__ (30s period)                │  │
│  │                                                           │  │
│  │  Environment Variables:                                   │  │
│  │    SERVICE_NAME, PORT, SITE_URL, DB_HOST, DB_NAME...      │  │
│  │                                                           │  │
│  │  Secrets (from Secret Manager):                           │  │
│  │    DB_PASSWORD, SECRET_KEY                                │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Scaling                                                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Min Instances: 0 (staging) / 1 (production)              │  │
│  │  Max Instances: 5 (staging) / 10 (production)             │  │
│  │                                                           │  │
│  │  Scale-to-zero: Yes (when no traffic)                     │  │
│  │  Cold Start: ~2-5 seconds                                 │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Networking                                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  VPC Connector: nopo-{env}-connector                      │  │
│  │  Egress: PRIVATE_RANGES_ONLY                              │  │
│  │  (Public internet via Cloud Run, private via VPC)         │  │
│  │                                                           │  │
│  │  Cloud SQL: Mounted at /cloudsql/{connection_name}        │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  IAM                                                            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Service Account: nopo-{env}-cloudrun@{project}.iam...    │  │
│  │  Roles:                                                   │  │
│  │    - roles/cloudsql.client                                │  │
│  │    - roles/secretmanager.secretAccessor                   │  │
│  │                                                           │  │
│  │  Invoker: allUsers (public access via Load Balancer)      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Request Lifecycle

```
1. Request arrives at Load Balancer
                │
                ▼
2. SSL terminated, forwarded to Cloud Run
                │
                ▼
3. Cloud Run checks for warm instances
                │
        ┌───────┴───────┐
        ▼               ▼
   [Warm Instance]  [No Instance]
        │               │
        │               ▼
        │         4. Cold start:
        │            - Pull image (cached)
        │            - Start container
        │            - Run startup probe
        │               │
        └───────┬───────┘
                ▼
5. Request processed by application
                │
                ▼
6. Response returned (typically <100ms warm, <3s cold)
```

### Migration Jobs

Services with `run_migrations: true` get two Cloud Run jobs:

```
┌─────────────────────────────────────────────────────────────────┐
│           Cloud Run Job: nopo-{env}-backend-migrate-check       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Purpose: Check for pending Django database migrations          │
│                                                                 │
│  Trigger: Automatically during deployment (before migrate job)  │
│                                                                 │
│  Command: nopo migrate check backend                            │
│                                                                 │
│  Exit Codes:                                                    │
│    - 0: No pending migrations (skip migrate job)                │
│    - 1: Pending migrations exist (run migrate job)              │
│                                                                 │
│  Configuration:                                                 │
│    - Same image as backend service                              │
│    - Same VPC connector and secrets                             │
│    - Timeout: 120 seconds                                       │
│    - Max retries: 0                                             │
│                                                                 │
│  Execution:                                                     │
│    gcloud run jobs execute nopo-{env}-backend-migrate-check \   │
│      --region=us-central1                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                 Cloud Run Job: nopo-{env}-backend-migrate       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Purpose: Run Django database migrations                        │
│                                                                 │
│  Trigger: Only runs if migrate-check indicates pending changes  │
│                                                                 │
│  Command: nopo migrate backend                                  │
│                                                                 │
│  Configuration:                                                 │
│    - Same image as backend service                              │
│    - Same VPC connector and secrets                             │
│    - Timeout: 600 seconds                                       │
│    - Max retries: 1                                             │
│                                                                 │
│  Execution:                                                     │
│    gcloud run jobs execute nopo-{env}-backend-migrate \         │
│      --region=us-central1 --wait                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**External Documentation:**
- [Cloud Run Overview](https://cloud.google.com/run/docs/overview/what-is-cloud-run)
- [Cloud Run Scaling](https://cloud.google.com/run/docs/configuring/min-instances)
- [Cloud Run Jobs](https://cloud.google.com/run/docs/create-jobs)
- [Container Contract](https://cloud.google.com/run/docs/container-contract)

---

## Database Layer (Cloud SQL)

### Instance Configuration

```
┌─────────────────────────────────────────────────────────────────┐
│              Cloud SQL Instance: nopo-{env}-db                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Engine: PostgreSQL 16                                          │
│                                                                 │
│  Machine Type:                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Staging:    db-f1-micro (shared vCPU, 614 MB RAM)        │  │
│  │  Production: db-custom-1-3840 (1 vCPU, 3.75 GB RAM)       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Storage:                                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Type: SSD (PD-SSD)                                       │  │
│  │  Size: 10 GB (auto-increase enabled)                      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Networking:                                                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Public IP:  DISABLED                                     │  │
│  │  Private IP: ENABLED (via Private Services Connection)    │  │
│  │                                                           │  │
│  │  Connection Name: {project}:{region}:nopo-{env}-db        │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Backup Configuration:                                          │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Automated Backups: Enabled                               │  │
│  │  Backup Window: 03:00 UTC                                 │  │
│  │  Retention: 7 days                                        │  │
│  │  Point-in-Time Recovery: Enabled                          │  │
│  │  Binary Logging: Enabled (for PITR)                       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Maintenance:                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Window: Sunday 03:00 UTC                                 │  │
│  │  (Automatic updates for security patches)                 │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Query Insights:                                                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Enabled: Yes                                             │  │
│  │  Query Plans per Minute: 5                                │  │
│  │  Query String Length: 1024                                │  │
│  │  Record Application Tags: Yes                             │  │
│  │  Record Client Address: Yes                               │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  High Availability:                                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Staging:    ZONAL (single zone, no failover)             │  │
│  │  Production: ZONAL (upgrade to REGIONAL for HA)           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Deletion Protection: ENABLED                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Connection Methods

```
┌─────────────────────────────────────────────────────────────────┐
│                    Cloud SQL Connections                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  From Cloud Run (Production):                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Method 1: Unix Socket (Cloud SQL Proxy built-in)         │  │
│  │                                                           │  │
│  │  Volume Mount: /cloudsql/{connection_name}                │  │
│  │  Connection:   /cloudsql/{project}:{region}:{instance}    │  │
│  │                                                           │  │
│  │  Pros: Automatic IAM auth, encrypted, no IP management    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Method 2: Private IP (via VPC Connector)                 │  │
│  │                                                           │  │
│  │  Host: 10.x.x.x (Private IP of Cloud SQL)                 │  │
│  │  Port: 5432                                               │  │
│  │                                                           │  │
│  │  Pros: Standard PostgreSQL connection, lower latency      │  │
│  │  Cons: Requires VPC connector                             │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  From Local Development:                                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Method: Cloud SQL Auth Proxy                             │  │
│  │                                                           │  │
│  │  # Install proxy                                          │  │
│  │  curl -o cloud-sql-proxy \                                │  │
│  │    https://storage.googleapis.com/cloud-sql-connectors/...│  │
│  │                                                           │  │
│  │  # Run proxy                                              │  │
│  │  ./cloud-sql-proxy {connection_name} &                    │  │
│  │                                                           │  │
│  │  # Connect via localhost                                  │  │
│  │  psql -h localhost -U app -d database                     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**External Documentation:**
- [Cloud SQL for PostgreSQL](https://cloud.google.com/sql/docs/postgres)
- [Cloud SQL Private IP](https://cloud.google.com/sql/docs/postgres/private-ip)
- [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy)
- [Connecting from Cloud Run](https://cloud.google.com/sql/docs/postgres/connect-run)

---

## Load Balancing & SSL

### Load Balancer Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                        Global External Application Load Balancer                     │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Frontend                                                                            │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                                │ │
│  │  Global Static IP: x.x.x.x (Anycast)                                          │ │
│  │  ├── HTTPS Forwarding Rule (port 443)                                         │ │
│  │  │   └── Target HTTPS Proxy                                                   │ │
│  │  │       └── SSL Certificate (Google-managed)                                 │ │
│  │  │           └── URL Map                                                      │ │
│  │  │                                                                            │ │
│  │  └── HTTP Forwarding Rule (port 80)                                           │ │
│  │      └── Target HTTP Proxy                                                    │ │
│  │          └── URL Map (redirect to HTTPS)                                      │ │
│  │                                                                                │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  URL Map (Path-Based Routing)                                                        │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                                │ │
│  │  Host: {subdomain}.{domain} or {domain}                                       │ │
│  │                                                                                │ │
│  │  Path Matchers:                                                               │ │
│  │  ┌──────────────────┬─────────────────────────────────────────────────────┐  │ │
│  │  │ Path             │ Backend Service                                     │  │ │
│  │  ├──────────────────┼─────────────────────────────────────────────────────┤  │ │
│  │  │ /api/*           │ nopo-{env}-backend-service → Backend NEG            │  │ │
│  │  │ /admin/*         │ nopo-{env}-backend-service → Backend NEG            │  │ │
│  │  │ /django/*        │ nopo-{env}-backend-service → Backend NEG            │  │ │
│  │  │ /static/*        │ nopo-{env}-backend-service → Backend NEG            │  │ │
│  │  │ /* (default)     │ nopo-{env}-web-service → Web NEG                    │  │ │
│  │  └──────────────────┴─────────────────────────────────────────────────────┘  │ │
│  │                                                                                │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  Backend Services                                                                    │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                                │ │
│  │  nopo-{env}-backend-service                                                   │ │
│  │  ├── Protocol: HTTP                                                           │ │
│  │  ├── Timeout: 30 seconds                                                      │ │
│  │  └── Backend: Serverless NEG (Cloud Run)                                      │ │
│  │                                                                                │ │
│  │  nopo-{env}-web-service                                                       │ │
│  │  ├── Protocol: HTTP                                                           │ │
│  │  ├── Timeout: 30 seconds                                                      │ │
│  │  └── Backend: Serverless NEG (Cloud Run)                                      │ │
│  │                                                                                │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  Network Endpoint Groups (NEGs)                                                      │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                                │ │
│  │  nopo-{env}-backend-neg (Serverless)                                          │ │
│  │  └── Cloud Run Service: nopo-{env}-backend                                    │ │
│  │                                                                                │ │
│  │  nopo-{env}-web-neg (Serverless)                                              │ │
│  │  └── Cloud Run Service: nopo-{env}-web                                        │ │
│  │                                                                                │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### SSL Certificate Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│              Google-Managed SSL Certificate                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Certificate Created                                         │
│     └── Status: PROVISIONING                                    │
│         └── Google initiates domain validation                  │
│                                                                 │
│  2. DNS Configured                                              │
│     └── A record points to Load Balancer IP                     │
│         └── Google validates domain ownership                   │
│                                                                 │
│  3. Certificate Issued                                          │
│     └── Status: ACTIVE                                          │
│         └── Valid for 90 days                                   │
│                                                                 │
│  4. Auto-Renewal                                                │
│     └── Google automatically renews before expiry               │
│         └── No action required                                  │
│                                                                 │
│  Timeline:                                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  DNS Propagation: 5 minutes - 24 hours                  │   │
│  │  Certificate Provisioning: 10 minutes - 24 hours        │   │
│  │  Total: Usually < 1 hour, max 48 hours                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Check Certificate Status

```bash
# List certificates
gcloud compute ssl-certificates list --project=${PROJECT_ID}

# Describe specific certificate
gcloud compute ssl-certificates describe nopo-{env}-ssl-cert \
  --project=${PROJECT_ID} \
  --format="yaml(managed)"

# Expected output when active:
# managed:
#   domains:
#   - stage.example.com
#   status: ACTIVE
```

**External Documentation:**
- [External Application Load Balancer](https://cloud.google.com/load-balancing/docs/https)
- [Serverless NEGs](https://cloud.google.com/load-balancing/docs/negs/serverless-neg-concepts)
- [Google-managed SSL Certificates](https://cloud.google.com/load-balancing/docs/ssl-certificates/google-managed-certs)
- [URL Maps](https://cloud.google.com/load-balancing/docs/url-map)

---

## Secrets Management

### Secret Manager Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Secret Manager                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Secrets                                                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                                                           │  │
│  │  nopo-{env}-db-password                                   │  │
│  │  ├── Version 1: ******* (auto-generated, 32 chars)        │  │
│  │  ├── Replication: Automatic                               │  │
│  │  └── Accessed by: Cloud Run service account               │  │
│  │                                                           │  │
│  │  nopo-{env}-django-secret                                 │  │
│  │  ├── Version 1: ******* (auto-generated, 50 chars)        │  │
│  │  ├── Replication: Automatic                               │  │
│  │  └── Accessed by: Cloud Run service account               │  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Access Control (IAM)                                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                                                           │  │
│  │  nopo-{env}-cloudrun@{project}.iam.gserviceaccount.com    │  │
│  │  └── roles/secretmanager.secretAccessor                   │  │
│  │      └── Can read secret versions                         │  │
│  │                                                           │  │
│  │  github-actions@{project}.iam.gserviceaccount.com         │  │
│  │  └── roles/secretmanager.admin                            │  │
│  │      └── Can create/update/delete secrets                 │  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  How Secrets Reach Cloud Run                                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                                                           │  │
│  │  1. Cloud Run config references secret:                   │  │
│  │     env:                                                  │  │
│  │       - name: DB_PASSWORD                                 │  │
│  │         valueFrom:                                        │  │
│  │           secretKeyRef:                                   │  │
│  │             name: nopo-{env}-db-password                  │  │
│  │             key: latest                                   │  │
│  │                                                           │  │
│  │  2. At container start, Cloud Run:                        │  │
│  │     - Fetches secret from Secret Manager                  │  │
│  │     - Injects as environment variable                     │  │
│  │                                                           │  │
│  │  3. Application reads from environment:                   │  │
│  │     DB_PASSWORD = os.environ["DB_PASSWORD"]               │  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Secret Rotation

Secrets are configured with automatic rotation schedules. Secret Manager publishes to a Pub/Sub topic (`secret-rotation`) when rotation is due, and a Cloud Function (`rotate-django-secret`) handles generating the new secret version.

**Rotation schedules:**

| Secret | Rotation Period | Auto-Rotated |
|--------|----------------|--------------|
| `nopo-{env}-django-secret` | 90 days | Yes (Cloud Function generates new random key) |
| `nopo-{env}-database-url` | 90 days | No (requires coordinated Cloud SQL password update) |

**Automatic rotation flow (Django secret key):**

```
Secret Manager (rotation timer)
  → Pub/Sub topic: secret-rotation
    → Cloud Function: rotate-django-secret
      → Generates 50-char random secret
      → Adds as new secret version
        → Cloud Run picks up on next deploy/restart
```

**Manual rotation (database password):**

```bash
# 1. Generate new password
NEW_PASSWORD=$(openssl rand -base64 32)

# 2. Add new secret version
echo -n "${NEW_PASSWORD}" | gcloud secrets versions add nopo-{env}-database-url \
  --data-file=-

# 3. Update Cloud SQL user password
gcloud sql users set-password app \
  --instance=nopo-{env}-db \
  --password="${NEW_PASSWORD}"

# 4. Redeploy Cloud Run to pick up new secret
gcloud run services update nopo-{env}-backend \
  --region=us-central1
```

**External Documentation:**
- [Secret Manager Overview](https://cloud.google.com/secret-manager/docs/overview)
- [Secret Manager with Cloud Run](https://cloud.google.com/run/docs/configuring/secrets)
- [Secret Rotation](https://cloud.google.com/secret-manager/docs/rotation-recommendations)
- [Automatic Rotation with Cloud Functions](https://cloud.google.com/secret-manager/docs/secret-rotation)

---

## Container Registry

### Artifact Registry Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                     Artifact Registry                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Repository: us-central1-docker.pkg.dev/{project}/nopo          │
│                                                                 │
│  Images:                                                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                                                           │  │
│  │  backend                                                  │  │
│  │  ├── sha-abc1234  (commit-based tag)                      │  │
│  │  ├── sha-def5678                                          │  │
│  │  ├── stage        (environment tag, points to latest)     │  │
│  │  └── prod         (environment tag)                       │  │
│  │                                                           │  │
│  │  web                                                      │  │
│  │  ├── sha-abc1234                                          │  │
│  │  ├── sha-def5678                                          │  │
│  │  ├── stage                                                │  │
│  │  └── prod                                                 │  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Full Image Path Example:                                       │
│  us-central1-docker.pkg.dev/myproject/nopo/backend:sha-abc1234  │
│  └──────────┬─────────────┘ └───┬───┘ └─┬┘ └──┬──┘ └────┬────┘  │
│           Region          Project  Repo  Image    Tag           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Image Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                      Image Lifecycle                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Build (GitHub Actions)                                      │
│     ├── Build multi-stage Docker image                          │
│     ├── Push to ghcr.io (GitHub Container Registry)             │
│     └── Tag: ghcr.io/{org}/{repo}-{service}:sha-{commit}        │
│                                                                 │
│  2. Deploy (GitHub Actions)                                     │
│     ├── Pull from ghcr.io                                       │
│     ├── Push to Artifact Registry                               │
│     └── Tag: {region}-docker.pkg.dev/{project}/nopo/{service}   │
│                                                                 │
│  3. Run (Cloud Run)                                             │
│     ├── Pull from Artifact Registry                             │
│     └── Cache locally for fast scaling                          │
│                                                                 │
│  4. Tag Update (after successful deploy)                        │
│     └── Update environment tag (stage/prod) to point to         │
│         successfully deployed version                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**External Documentation:**
- [Artifact Registry Overview](https://cloud.google.com/artifact-registry/docs/overview)
- [Docker in Artifact Registry](https://cloud.google.com/artifact-registry/docs/docker)
- [Artifact Registry with Cloud Run](https://cloud.google.com/run/docs/deploying#images)

---

## Deployment Flow

### CI/CD Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              GitHub Actions Pipeline                                 │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Trigger: Push to main branch                                                        │
│                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐│
│  │ 1. BUILD                                                                        ││
│  │    ├── Checkout code                                                            ││
│  │    ├── Build Docker images (backend, web)                                       ││
│  │    ├── Push to ghcr.io with SHA tag                                             ││
│  │    └── Output: image tags, version                                              ││
│  └─────────────────────────────────────────────────────────────────────────────────┘│
│                                       │                                              │
│                                       ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐│
│  │ 2. TEST                                                                         ││
│  │    ├── Pull built images                                                        ││
│  │    ├── Run unit tests                                                           ││
│  │    ├── Run integration tests                                                    ││
│  │    └── Run linting/type checks                                                  ││
│  └─────────────────────────────────────────────────────────────────────────────────┘│
│                                       │                                              │
│                                       ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐│
│  │ 3. DEPLOY STAGING                                                               ││
│  │    ├── Authenticate to GCP (Workload Identity)                                  ││
│  │    ├── Push images to Artifact Registry                                         ││
│  │    ├── Prepare static bucket (targeted Terraform)                               ││
│  │    ├── PARALLEL: ┬─ Deploy services (full Terraform apply)                      ││
│  │    │             └─ Upload static assets (extract from images)                  ││
│  │    ├── Run database migrations                                                  ││
│  │    ├── Run smoke tests                                                          ││
│  │    └── Tag images with "stage"                                                  ││
│  └─────────────────────────────────────────────────────────────────────────────────┘│
│                                       │                                              │
│                                       ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐│
│  │ 4. DEPLOY PRODUCTION                                                            ││
│  │    ├── Same steps as staging                                                    ││
│  │    ├── Environment protection rules (optional)                                  ││
│  │    └── Tag images with "prod"                                                   ││
│  └─────────────────────────────────────────────────────────────────────────────────┘│
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Terraform Deployment Details

```
┌─────────────────────────────────────────────────────────────────┐
│                    Terraform Apply Process                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Initialize                                                  │
│     terraform init \                                            │
│       -backend-config="bucket=${PROJECT_ID}-terraform-state" \  │
│       -backend-config="prefix=nopo/${ENV}"                      │
│                                                                 │
│  2. Plan                                                        │
│     terraform plan \                                            │
│       -var="project_id=${PROJECT_ID}" \                         │
│       -var="backend_image=${BACKEND_IMAGE}" \                   │
│       -var="web_image=${WEB_IMAGE}" \                           │
│       -out=tfplan                                               │
│                                                                 │
│  3. Apply                                                       │
│     terraform apply tfplan                                      │
│                                                                 │
│  What Gets Updated:                                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  • Cloud Run services (new image)                         │  │
│  │  • Cloud Run job (new image for migrations)               │  │
│  │  • Nothing else changes unless config modified            │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  State Storage:                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Bucket: gs://${PROJECT_ID}-terraform-state               │  │
│  │  Path:   nopo/${ENV}/default.tfstate                      │  │
│  │  Locking: Automatic (GCS)                                 │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Rollback Procedure

```
┌─────────────────────────────────────────────────────────────────┐
│                      Rollback Options                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Option 1: Cloud Run Revision (Fastest)                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  # List revisions                                         │  │
│  │  gcloud run revisions list --service=nopo-{env}-backend   │  │
│  │                                                           │  │
│  │  # Route traffic to previous revision                     │  │
│  │  gcloud run services update-traffic nopo-{env}-backend \  │  │
│  │    --to-revisions=nopo-{env}-backend-xxxxx=100            │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Option 2: Re-deploy Previous Version (Terraform)               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  # Trigger deploy workflow with previous version          │  │
│  │  gh workflow run _deploy_gcp.yml \                        │  │
│  │    -f version=sha-previous123 \                           │  │
│  │    -f environment=prod                                    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Option 3: Git Revert + New Deploy                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  git revert HEAD                                          │  │
│  │  git push origin main                                     │  │
│  │  # Triggers full pipeline                                 │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Security Model

### Defense in Depth

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              Security Layers                                         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Layer 1: Network                                                                    │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │  • HTTPS only (HTTP redirects to HTTPS)                                        │ │
│  │  • Google-managed SSL certificate                                              │ │
│  │  • DDoS protection (Cloud Armor eligible)                                      │ │
│  │  • Database has no public IP                                                   │ │
│  │  • VPC for internal communication                                              │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  Layer 2: Identity & Access                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │  • Workload Identity Federation (no stored credentials)                        │ │
│  │  • Least-privilege service accounts                                            │ │
│  │  • Separate service accounts per environment                                   │ │
│  │  • Essential Contacts for security/billing/technical notifications             │ │
  │  │  • IAM conditions for fine-grained access                                      │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  Layer 3: Secrets                                                                    │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │  • All secrets in Secret Manager                                               │ │
│  │  • Automatic encryption at rest                                                │ │
│  │  • Automatic rotation for Django secret key (90-day schedule)                  │ │
│  │  • Access audit logging                                                        │ │
│  │  • No secrets in code or environment                                           │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  Layer 4: Container                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │  • Non-root user in container                                                  │ │
│  │  • Read-only filesystem (where possible)                                       │ │
│  │  • No SSH access to containers                                                 │ │
│  │  • Automatic vulnerability scanning                                            │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  Layer 5: Data                                                                       │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │  • Encryption at rest (Cloud SQL, GCS)                                         │ │
│  │  • Encryption in transit (TLS everywhere)                                      │ │
│  │  • Automated backups with PITR                                                 │ │
│  │  • Deletion protection on database                                             │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### IAM Roles Summary

| Service Account | Purpose | Roles |
|-----------------|---------|-------|
| `github-actions@...` | CI/CD deployment | run.admin, iam.serviceAccountUser, iam.serviceAccountAdmin, artifactregistry.admin, cloudsql.admin, secretmanager.admin, storage.admin, compute.admin, vpcaccess.admin, servicenetworking.networksAdmin |
| `nopo-{env}-cloudrun@...` | Cloud Run runtime | cloudsql.client, secretmanager.secretAccessor |

**External Documentation:**
- [Cloud Run Security](https://cloud.google.com/run/docs/securing/security)
- [Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation)
- [Secret Manager Security](https://cloud.google.com/secret-manager/docs/security)
- [Cloud SQL Security](https://cloud.google.com/sql/docs/postgres/security)

---

## Scaling & Performance

### Auto-Scaling Behavior

```
┌─────────────────────────────────────────────────────────────────┐
│                    Cloud Run Auto-Scaling                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Scaling Triggers:                                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  • Concurrent requests per instance (default: 80)         │  │
│  │  • CPU utilization (default: 60%)                         │  │
│  │  • Request queue depth                                    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Scaling Timeline:                                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                                                           │  │
│  │  0 instances (idle)                                       │  │
│  │       │                                                   │  │
│  │       │ First request arrives                             │  │
│  │       ▼                                                   │  │
│  │  1 instance (cold start: 2-5 seconds)                     │  │
│  │       │                                                   │  │
│  │       │ Traffic increases                                 │  │
│  │       ▼                                                   │  │
│  │  N instances (scale up: ~seconds)                         │  │
│  │       │                                                   │  │
│  │       │ Traffic decreases                                 │  │
│  │       ▼                                                   │  │
│  │  Fewer instances (scale down: ~minutes)                   │  │
│  │       │                                                   │  │
│  │       │ No traffic for ~15 minutes                        │  │
│  │       ▼                                                   │  │
│  │  0 instances (scale to zero)                              │  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Configuration by Environment:                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Staging:                                                 │  │
│  │    min_instances: 0 (scale to zero for cost savings)      │  │
│  │    max_instances: 5                                       │  │
│  │                                                           │  │
│  │  Production:                                              │  │
│  │    min_instances: 1 (always warm, no cold starts)         │  │
│  │    max_instances: 10                                      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Performance Optimization Tips

```
┌─────────────────────────────────────────────────────────────────┐
│                  Performance Recommendations                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Reduce Cold Start Time:                                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  • Keep container image small                             │  │
│  │  • Use min_instances=1 in production                      │  │
│  │  • Lazy-load heavy dependencies                           │  │
│  │  • Use startup CPU boost (default enabled)                │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Database Performance:                                          │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  • Use connection pooling (pgbouncer or app-level)        │  │
│  │  • Enable Query Insights for slow query detection         │  │
│  │  • Size instance appropriately for workload               │  │
│  │  • Consider read replicas for read-heavy workloads        │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Caching:                                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  • Add Memorystore (Redis) for session/cache              │  │
│  │  • Use Cloud CDN for static assets                        │  │
│  │  • Implement application-level caching                    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Static File Serving (Cloud-Native):                            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Static files are served from Cloud Storage + CDN:        │  │
│  │                                                           │  │
│  │  Request: /static/backend/assets/style.css                │  │
│  │      ↓                                                    │  │
│  │  Load Balancer routes /static/* → GCS Backend Bucket      │  │
│  │      ↓ (URL rewrite: strips /static/ prefix)              │  │
│  │  Cloud Storage: gs://bucket/backend/assets/style.css      │  │
│  │                                                           │  │
│  │  Upload Process (during deployment):                      │  │
│  │  • Files extracted from built Docker images               │  │
│  │  • docker cp from /app/apps/<service>/<static_path>       │  │
│  │  • Uploaded to gs://bucket/<service>/                     │  │
│  │  • Runs in parallel with container deployment             │  │
│  │                                                           │  │
│  │  Configuration:                                           │  │
│  │  • apps/<service>/nopo.yml → static_path                  │  │
│  │  • Container env: STATIC_URL=https://domain.com/static/x  │  │
│  │  • CDN enabled in production for global caching           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**External Documentation:**
- [Cloud Run Scaling](https://cloud.google.com/run/docs/configuring/min-instances)
- [Cloud Run Performance](https://cloud.google.com/run/docs/tips/general)
- [Cloud SQL Performance](https://cloud.google.com/sql/docs/postgres/best-practices)

---

## Cost Optimization

### Cost Breakdown

```
┌─────────────────────────────────────────────────────────────────┐
│                    Monthly Cost Estimate                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  STAGING (scale-to-zero, minimal usage)                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Cloud Run (backend + web)      $0 - $10                  │  │
│  │  Cloud SQL (db-f1-micro)        ~$8                       │  │
│  │  Load Balancer                  ~$18                      │  │
│  │  VPC Connector                  ~$7                       │  │
│  │  Secret Manager                 ~$0                       │  │
│  │  Artifact Registry              ~$1-5                     │  │
│  │  ─────────────────────────────────────                    │  │
│  │  TOTAL                          ~$35-50/month             │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  PRODUCTION (min 1 instance, moderate usage)                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Cloud Run (backend + web)      ~$20-50                   │  │
│  │  Cloud SQL (db-custom-1-3840)   ~$50                      │  │
│  │  Load Balancer                  ~$18                      │  │
│  │  VPC Connector                  ~$7                       │  │
│  │  Secret Manager                 ~$0                       │  │
│  │  Artifact Registry              ~$1-5                     │  │
│  │  ─────────────────────────────────────                    │  │
│  │  TOTAL                          ~$100-150/month           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Cost Drivers:                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  • Cloud Run: Pay per request + CPU/memory time           │  │
│  │  • Cloud SQL: Always-on, pay for instance size            │  │
│  │  • Load Balancer: Fixed cost + data processed             │  │
│  │  • VPC Connector: Pay for 2-3 always-on instances         │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Cost Reduction Strategies

| Strategy | Savings | Trade-off |
|----------|---------|-----------|
| Use `min_instances=0` | Cloud Run costs | Cold start latency |
| Use `db-f1-micro` | ~$40/month | Limited performance |
| Share database between envs | ~$50/month | Isolation, risk |
| Use committed use discounts | 20-50% | 1-3 year commitment |
| Delete unused resources | Variable | Manual cleanup needed |

**External Documentation:**
- [Cloud Run Pricing](https://cloud.google.com/run/pricing)
- [Cloud SQL Pricing](https://cloud.google.com/sql/pricing)
- [GCP Pricing Calculator](https://cloud.google.com/products/calculator)

---

## Disaster Recovery

### Backup Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                      Backup Configuration                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Cloud SQL Automated Backups:                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  • Daily automated backups at 03:00 UTC                   │  │
│  │  • Retention: 7 days                                      │  │
│  │  • Point-in-time recovery: Enabled                        │  │
│  │  • Binary logging: Enabled                                │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Terraform State:                                               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  • Stored in GCS with versioning enabled                  │  │
│  │  • Can recover previous state versions                    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Container Images:                                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  • Stored in Artifact Registry                            │  │
│  │  • Also stored in ghcr.io (GitHub)                        │  │
│  │  • Tagged by commit SHA (immutable)                       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Secrets:                                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  • Secret Manager maintains version history               │  │
│  │  • Can restore previous secret versions                   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Recovery Procedures

```bash
# Restore database to point in time
gcloud sql instances clone nopo-prod-db nopo-prod-db-restored \
  --point-in-time="2024-01-15T10:00:00Z"

# Restore from backup
gcloud sql backups list --instance=nopo-prod-db
gcloud sql backups restore BACKUP_ID --restore-instance=nopo-prod-db

# Restore Terraform state
gsutil ls gs://${PROJECT_ID}-terraform-state/nopo/prod/
gsutil cp gs://${PROJECT_ID}-terraform-state/nopo/prod/default.tfstate#VERSION ./

# Roll back to previous container image
gcloud run services update nopo-prod-backend \
  --image=us-central1-docker.pkg.dev/${PROJECT_ID}/nopo/backend:sha-previous
```

### Recovery Time Objectives

| Scenario | RTO | RPO | Procedure |
|----------|-----|-----|-----------|
| Bad deployment | < 5 min | 0 | Cloud Run revision rollback |
| Database corruption | < 1 hour | < 5 min | Point-in-time recovery |
| Region outage | Hours | < 1 day | Restore in new region |
| Full project loss | Days | < 1 day | Rebuild from code + backups |

**External Documentation:**
- [Cloud SQL Backups](https://cloud.google.com/sql/docs/postgres/backup-recovery/backups)
- [Point-in-time Recovery](https://cloud.google.com/sql/docs/postgres/backup-recovery/pitr)
- [Disaster Recovery Planning](https://cloud.google.com/architecture/dr-scenarios-planning-guide)

---

## Quick Reference

### Useful Commands

```bash
# View Cloud Run logs
gcloud run services logs read nopo-{env}-backend --region=us-central1

# Connect to Cloud SQL
gcloud sql connect nopo-{env}-db --user=app --database=database

# List Cloud Run revisions
gcloud run revisions list --service=nopo-{env}-backend --region=us-central1

# Check SSL certificate status
gcloud compute ssl-certificates describe nopo-{env}-ssl-cert

# View Terraform state
terraform state list
terraform state show module.infrastructure.module.cloudrun.google_cloud_run_v2_service.backend

# Force new Cloud Run deployment
gcloud run services update nopo-{env}-backend --region=us-central1
```

### Environment URLs

| Environment | URL | Cloud Console |
|-------------|-----|---------------|
| Staging | https://stage.{domain} | [Console](https://console.cloud.google.com/run?project={project}) |
| Production | https://{domain} | [Console](https://console.cloud.google.com/run?project={project}) |

---

## Further Reading

- [Google Cloud Architecture Center](https://cloud.google.com/architecture)
- [Cloud Run Best Practices](https://cloud.google.com/run/docs/tips)
- [Terraform Google Provider Docs](https://registry.terraform.io/providers/hashicorp/google/latest/docs)
- [12-Factor App Methodology](https://12factor.net/)
