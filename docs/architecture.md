# Nopo Architecture

This document provides a comprehensive overview of the Nopo (monoреpo) project architecture, covering the system design, component interactions, and key architectural decisions.

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Diagram](#architecture-diagram)
3. [Component Architecture](#component-architecture)
4. [Data Flow](#data-flow)
5. [Technology Stack](#technology-stack)
6. [Development Architecture](#development-architecture)
7. [Build & Deployment Pipeline](#build--deployment-pipeline)
8. [Interface Definitions](#interface-definitions)
9. [Architectural Decisions](#architectural-decisions)

---

## System Overview

Nopo is a Docker-based monorepo development environment that combines:
- **Backend**: Django REST Framework API
- **Frontend**: React Router 7 with Server-Side Rendering
- **Database**: PostgreSQL 16
- **Infrastructure**: Terraform-managed GCP deployment
- **Automation**: Claude-powered CI/CD and issue management

### Core Principles

1. **Monorepo Architecture**: All code in a single repository with shared tooling
2. **Docker-First Development**: Consistent environments across local and production
3. **Infrastructure as Code**: All infrastructure defined in Terraform
4. **API-First Design**: Backend exposes RESTful API, frontend consumes it
5. **Type Safety**: TypeScript for frontend, Python type hints for backend
6. **Automated Workflows**: Claude agents handle triage, implementation, and reviews

---

## Architecture Diagram

```mermaid
flowchart TB
    subgraph "User Layer"
        Browser[Web Browser]
    end

    subgraph "Edge Layer"
        LB[Load Balancer<br/>SSL Termination<br/>Path Routing]
        CDN[Cloud CDN<br/>Static Assets]
    end

    subgraph "Application Layer"
        Web[Web Service<br/>React Router SSR<br/>Node.js]
        Backend[Backend Service<br/>Django + DRF<br/>Gunicorn]
    end

    subgraph "Data Layer"
        DB[(PostgreSQL 16<br/>Cloud SQL)]
        Secrets[Secret Manager<br/>Credentials]
        Storage[Cloud Storage<br/>Static Files]
    end

    subgraph "Build & Deploy"
        GHA[GitHub Actions<br/>CI/CD]
        Registry[Artifact Registry<br/>Docker Images]
        Terraform[Terraform<br/>Infrastructure]
    end

    subgraph "Development"
        Docker[Docker Compose<br/>Local Environment]
        CLI[Nopo CLI<br/>Build Tool]
    end

    Browser --> LB
    LB --> Web
    LB --> Backend
    LB --> CDN
    CDN --> Storage

    Web --> Backend
    Backend --> DB
    Backend --> Secrets

    GHA --> Registry
    GHA --> Terraform
    Terraform --> Web
    Terraform --> Backend
    Terraform --> DB

    CLI --> Docker
    Docker --> Web
    Docker --> Backend
    Docker --> DB
```

---

## Component Architecture

### Frontend (Web)

```mermaid
flowchart LR
    subgraph "React Router 7"
        Routes[Route Definitions]
        Loader[Data Loaders]
        Action[Form Actions]
        Component[React Components]
    end

    subgraph "State Management"
        Context[React Context]
        LocalState[Component State]
    end

    subgraph "Styling"
        Tailwind[Tailwind CSS]
        Storybook[Component Library]
    end

    Routes --> Loader
    Routes --> Action
    Routes --> Component
    Component --> Context
    Component --> LocalState
    Component --> Tailwind
    Storybook --> Component
```

**Key Responsibilities:**
- Server-side rendering for initial page load
- Client-side routing and navigation
- Form handling and validation
- API communication with backend
- Component-based UI construction

**Technology:**
- React 19
- React Router 7 (SSR)
- TypeScript
- Vite (build tool)
- Tailwind CSS

### Backend (API)

```mermaid
flowchart LR
    subgraph "Django"
        URLs[URL Routing]
        Views[API Views<br/>DRF]
        Serializers[Data Serializers]
        Models[ORM Models]
    end

    subgraph "Data Access"
        DB[(PostgreSQL)]
        Migrations[Django Migrations]
    end

    subgraph "Services"
        Auth[Authentication]
        Middleware[Custom Middleware]
        Tasks[Background Tasks]
    end

    URLs --> Views
    Views --> Serializers
    Serializers --> Models
    Models --> DB
    Migrations --> DB
    Views --> Auth
    Views --> Middleware
    Views --> Tasks
```

**Key Responsibilities:**
- RESTful API endpoints
- Business logic implementation
- Database access and queries
- Authentication and authorization
- Data validation and serialization

**Technology:**
- Django 5
- Django REST Framework
- Python 3.12+
- Gunicorn (WSGI server)
- PostgreSQL (database driver)

### Database Layer

**Schema Management:**
- Django ORM for schema definition
- Migrations in version control
- Expand-contract pattern for schema changes

**Key Features:**
- Automated backups (7-day retention)
- Point-in-time recovery
- Query insights for performance monitoring
- Private IP (no public access)

### Infrastructure

See [Infrastructure Architecture](../infrastructure/ARCHITECTURE.md) for detailed information about:
- Cloud Run deployment
- Load balancing and SSL
- VPC networking
- Secret management
- Static asset delivery

---

## Data Flow

### API Request Flow

```mermaid
sequenceDiagram
    participant Browser
    participant LB as Load Balancer
    participant Web as Web Service
    participant Backend as Backend API
    participant DB as Database

    Browser->>LB: HTTPS Request
    LB->>Web: Forward to Web Service
    Web->>Backend: API Request (JSON)
    Backend->>DB: SQL Query
    DB-->>Backend: Query Result
    Backend-->>Web: JSON Response
    Web-->>Browser: Rendered HTML/JSON
```

### Static Asset Flow

```mermaid
sequenceDiagram
    participant Browser
    participant LB as Load Balancer
    participant CDN as Cloud CDN
    participant GCS as Cloud Storage

    Browser->>LB: GET /static/assets/style.css
    LB->>CDN: Check Cache
    alt Cache Hit
        CDN-->>Browser: Cached Asset
    else Cache Miss
        CDN->>GCS: Fetch from Storage
        GCS-->>CDN: Asset File
        CDN-->>Browser: Asset + Cache
    end
```

### Authentication Flow

```mermaid
sequenceDiagram
    participant Browser
    participant Web
    participant Backend
    participant DB

    Browser->>Web: Login Form
    Web->>Backend: POST /api/auth/login
    Backend->>DB: Verify Credentials
    DB-->>Backend: User Data
    Backend-->>Web: Session Token
    Web-->>Browser: Set Cookie

    Note over Browser,Backend: Subsequent Requests
    Browser->>Web: Request with Cookie
    Web->>Backend: API Call with Token
    Backend->>Backend: Verify Token
    Backend-->>Web: Protected Data
    Web-->>Browser: Response
```

---

## Technology Stack

### Frontend Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Framework | React 19 | UI component framework |
| Routing | React Router 7 | SSR + client routing |
| Language | TypeScript | Type-safe JavaScript |
| Build Tool | Vite | Fast development builds |
| Styling | Tailwind CSS | Utility-first CSS |
| UI Components | Custom + Storybook | Component library |
| Testing | Vitest, Playwright | Unit + E2E tests |
| Linting | ESLint 9, Prettier | Code quality |

### Backend Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Framework | Django 5 | Web framework |
| API | Django REST Framework | RESTful API |
| Language | Python 3.12+ | Backend language |
| WSGI Server | Gunicorn | Production server |
| Database | PostgreSQL 16 | Relational database |
| Migrations | Django Migrations | Schema management |
| Testing | Django TestCase | Unit + integration tests |
| Linting | Ruff, mypy | Code quality + types |

### Infrastructure Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Compute | Cloud Run | Serverless containers |
| Database | Cloud SQL | Managed PostgreSQL |
| Load Balancer | GCP LB | HTTPS + routing |
| CDN | Cloud CDN | Static asset delivery |
| Storage | Cloud Storage | Static files |
| Secrets | Secret Manager | Credential storage |
| Registry | Artifact Registry | Docker images |
| IaC | Terraform | Infrastructure code |

### Development Stack

| Tool | Purpose |
|------|---------|
| Docker Compose | Local environment |
| pnpm | Node package manager |
| uv | Python package manager |
| Nopo CLI | Build orchestration |
| GitHub Actions | CI/CD |
| Act | Local workflow testing |

---

## Development Architecture

### Monorepo Structure

```
nopo/
├── apps/                    # Deployable services
│   ├── backend/            # Django API
│   ├── web/                # React Router app
│   ├── db/                 # Database (dev only)
│   └── nginx/              # Reverse proxy (dev only)
├── packages/               # Shared libraries
│   ├── configs/            # Shared configs
│   ├── plop/               # Code generators
│   └── ui/                 # UI component library
├── nopo/                   # CLI tool
│   ├── scripts/            # Build scripts
│   ├── docker/             # Docker configs
│   └── docs/               # CLI documentation
├── infrastructure/         # Terraform code
├── .github/                # GitHub workflows
└── decisions/              # Architecture decisions
```

### Build System

The Nopo CLI orchestrates builds across the monorepo:

```mermaid
flowchart TB
    CLI[Nopo CLI]

    subgraph "Build Commands"
        Build[nopo build]
        Compile[nopo compile]
        Test[nopo test]
        Check[nopo check]
    end

    subgraph "Docker Layer"
        Bake[Docker Buildx Bake]
        Compose[Docker Compose]
    end

    subgraph "Package Managers"
        PNPM[pnpm]
        UV[uv]
    end

    CLI --> Build
    CLI --> Compile
    CLI --> Test
    CLI --> Check

    Build --> Bake
    Build --> Compose

    Compile --> PNPM
    Compile --> UV

    Test --> PNPM
    Test --> UV

    Check --> PNPM
    Check --> UV
```

### Local Development Flow

```mermaid
flowchart LR
    Dev[Developer]

    subgraph "Local Environment"
        Make[Makefile]
        CLI[Nopo CLI]
        Docker[Docker Compose]

        subgraph "Services"
            Web[web:3000]
            Backend[backend:3000]
            DB[db:5432]
            Nginx[nginx:80]
        end
    end

    Dev --> Make
    Make --> CLI
    CLI --> Docker
    Docker --> Web
    Docker --> Backend
    Docker --> DB
    Docker --> Nginx

    Nginx --> Web
    Nginx --> Backend
    Web --> Backend
    Backend --> DB
```

**Development Commands:**
```bash
make up          # Start all services
make build       # Build Docker images
make test        # Run all tests
make check       # Lint + type check
make shell       # Shell into container
```

---

## Build & Deployment Pipeline

### CI/CD Architecture

```mermaid
flowchart TB
    Push[Git Push to main]

    subgraph "GitHub Actions"
        Build[Build Images]
        Test[Run Tests]

        subgraph "Deploy Staging"
            StageInfra[Terraform Apply]
            StageMigrate[Run Migrations]
            StageTest[Smoke Tests]
        end

        subgraph "Deploy Production"
            ProdInfra[Terraform Apply]
            ProdMigrate[Run Migrations]
            ProdTest[Smoke Tests]
        end
    end

    subgraph "GCP"
        Registry[Artifact Registry]
        CloudRun[Cloud Run]
        CloudSQL[Cloud SQL]
    end

    Push --> Build
    Build --> Test
    Test --> StageInfra

    StageInfra --> StageMigrate
    StageMigrate --> StageTest
    StageTest --> ProdInfra

    ProdInfra --> ProdMigrate
    ProdMigrate --> ProdTest

    Build --> Registry
    StageInfra --> CloudRun
    ProdInfra --> CloudRun
    StageMigrate --> CloudSQL
    ProdMigrate --> CloudSQL
```

### Deployment Stages

1. **Build**: Docker images built and pushed to Artifact Registry
2. **Test**: Unit, integration, and E2E tests
3. **Staging Deploy**:
   - Terraform applies infrastructure changes
   - Database migrations run
   - Smoke tests verify deployment
4. **Production Deploy**:
   - Same process as staging
   - Optional manual approval gate

See [Infrastructure Architecture](../infrastructure/ARCHITECTURE.md) for deployment details.

---

## Interface Definitions

### Backend API Interface

**Base URL**: `/api/v1/`

**Standard Response Format**:
```typescript
interface APIResponse<T> {
  data: T;
  status: "success" | "error";
  message?: string;
  errors?: Record<string, string[]>;
}
```

**Authentication**:
- Session-based authentication
- CSRF token required for mutations
- Token passed via cookie

**Common Headers**:
```
Content-Type: application/json
X-CSRFToken: <token>
Authorization: Bearer <token>  // If using token auth
```

### Frontend-Backend Contract

**API Client Interface**:
```typescript
interface APIClient {
  get<T>(url: string, params?: Record<string, any>): Promise<T>;
  post<T>(url: string, data: any): Promise<T>;
  put<T>(url: string, data: any): Promise<T>;
  patch<T>(url: string, data: any): Promise<T>;
  delete<T>(url: string): Promise<T>;
}
```

**Data Loader Pattern** (React Router):
```typescript
interface LoaderFunction<T> {
  (args: { request: Request; params: Params }): Promise<T>;
}

interface ActionFunction<T> {
  (args: { request: Request; params: Params }): Promise<T>;
}
```

### Database Interface

**ORM Model Pattern**:
```python
from django.db import models
from typing import TypedDict

class ModelType(TypedDict):
    id: int
    created_at: datetime
    updated_at: datetime

class BaseModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
```

**Migration Interface**:
```python
from django.db import migrations

class Migration(migrations.Migration):
    dependencies: list[tuple[str, str]]
    operations: list[migrations.Operation]
```

### Docker Interface

**Service Definition**:
```yaml
services:
  <service-name>:
    build:
      context: .
      dockerfile: apps/<service>/Dockerfile
      target: development
    ports:
      - "<host-port>:<container-port>"
    volumes:
      - .:/app
    environment:
      - SERVICE_NAME=<service-name>
    depends_on:
      - <dependency>
```

**Build Configuration** (`nopo.yml`):
```yaml
name: <service-name>
type: service | package
language: python | typescript | shell
manager: uv | pnpm

# For services
dockerfile: apps/<service>/Dockerfile
static_path: apps/<service>/build  # Static files location

# Commands
commands:
  build: <build-command>
  test: <test-command>
  check: <check-command>
  fix: <fix-command>
```

### Terraform Module Interface

**Module Input Variables**:
```hcl
variable "project_id" {
  type        = string
  description = "GCP project ID"
}

variable "environment" {
  type        = string
  description = "Environment name (stage, prod)"
}

variable "backend_image" {
  type        = string
  description = "Backend Docker image URI"
}
```

**Module Outputs**:
```hcl
output "service_url" {
  value       = google_cloud_run_v2_service.backend.uri
  description = "Cloud Run service URL"
}

output "database_connection" {
  value       = google_sql_database_instance.db.connection_name
  description = "Cloud SQL connection name"
  sensitive   = true
}
```

---

## Architectural Decisions

Key architecture decisions are documented in [decisions/](../decisions/) as ADRs (Architecture Decision Records).

### Key Design Decisions

1. **Monorepo vs Polyrepo**
   - **Decision**: Monorepo
   - **Rationale**: Simplified dependency management, atomic changes across services, shared tooling
   - **Trade-offs**: Larger repository size, more complex CI/CD

2. **Docker-First Development**
   - **Decision**: All services run in Docker, even locally
   - **Rationale**: Environment parity, consistent builds, easy onboarding
   - **Trade-offs**: Resource overhead, some performance loss on macOS

3. **SSR with React Router**
   - **Decision**: Server-side rendering for initial page load
   - **Rationale**: Better SEO, faster initial render, progressive enhancement
   - **Trade-offs**: More complex deployment, higher server load

4. **Django REST Framework for API**
   - **Decision**: DRF instead of FastAPI or Flask
   - **Rationale**: Mature ecosystem, built-in admin, ORM integration, batteries-included
   - **Trade-offs**: More opinionated, potentially slower than FastAPI

5. **Terraform for Infrastructure**
   - **Decision**: Terraform instead of gcloud CLI scripts
   - **Rationale**: Declarative, version controlled, supports drift detection
   - **Trade-offs**: Learning curve, state management complexity

6. **Cloud Run vs GKE**
   - **Decision**: Cloud Run (serverless containers)
   - **Rationale**: Simpler operations, scale-to-zero, pay-per-use
   - **Trade-offs**: Less control, vendor lock-in, cold start latency

7. **Expand-Contract Migrations**
   - **Decision**: Database migrations separate from code changes
   - **Rationale**: Zero-downtime deployments, safer rollbacks
   - **Trade-offs**: More PRs, slower feature delivery

8. **Claude Automation**
   - **Decision**: AI agents for triage, implementation, and reviews
   - **Rationale**: Faster iteration, consistent code quality, reduced manual work
   - **Trade-offs**: Requires trust in AI, needs human oversight

### Related Documentation

- [Infrastructure Architecture](../infrastructure/ARCHITECTURE.md) - GCP deployment details
- [Automation Architecture](./automation/ARCHITECTURE.md) - Claude workflow details
- [AGENTS.md](../AGENTS.md) - Development guidelines and conventions
- [ADRs](../decisions/) - Individual architecture decisions

---

## Future Considerations

### Scaling Considerations

As the system grows, consider:
1. **Caching Layer**: Redis/Memorystore for session and data caching
2. **Read Replicas**: Separate read/write database connections
3. **Message Queue**: Background job processing with Celery
4. **CDN Configuration**: More aggressive caching policies
5. **Database Sharding**: Horizontal partitioning for large datasets
6. **Microservices**: Split monolith if services have different scaling needs

### Observability

Current gaps to address:
1. **Distributed Tracing**: OpenTelemetry for request tracing
2. **Metrics**: Prometheus/Cloud Monitoring for application metrics
3. **Logging**: Structured logging with correlation IDs
4. **Error Tracking**: Sentry integration for error monitoring
5. **Performance Monitoring**: APM for slow query detection

### Security Enhancements

1. **WAF**: Cloud Armor for DDoS and attack protection
2. **Secrets Rotation**: Automated secret rotation policies
3. **Vulnerability Scanning**: Container image scanning in CI
4. **Compliance**: SOC 2, GDPR considerations
5. **Access Controls**: More granular IAM policies

---

## Appendix

### Glossary

- **ADR**: Architecture Decision Record - documents key design decisions
- **DRF**: Django REST Framework - REST API toolkit for Django
- **SSR**: Server-Side Rendering - rendering HTML on the server
- **NEG**: Network Endpoint Group - GCP load balancer target
- **PITR**: Point-in-Time Recovery - database backup restoration
- **VPC**: Virtual Private Cloud - isolated network in GCP
- **IaC**: Infrastructure as Code - managing infrastructure through code

### External Resources

- [Django Documentation](https://docs.djangoproject.com/)
- [React Router Documentation](https://reactrouter.com/)
- [GCP Documentation](https://cloud.google.com/docs)
- [Terraform GCP Provider](https://registry.terraform.io/providers/hashicorp/google/latest/docs)
- [Docker Documentation](https://docs.docker.com/)
- [12-Factor App](https://12factor.net/)
