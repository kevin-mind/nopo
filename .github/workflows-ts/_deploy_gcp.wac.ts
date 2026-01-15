import {
  Workflow,
  expressions,
  echoKeyValue,
  dedentString,
} from "@github-actions-workflow-ts/lib";
import { ExtendedStep } from "./lib/enhanced-step";
import { ExtendedNormalJob, needs, needsOutput } from "./lib/enhanced-job";
import { defaultDefaults, emptyPermissions, permissions } from "./lib/patterns";
import { checkoutStep, setupDockerStep, setupNodeStep } from "./lib/steps";

const GCP_REGION = "us-central1";
const TERRAFORM_VERSION = "1.7.0";

// Shared inputs definition for both workflow_dispatch and workflow_call
const sharedInputs = {
  version: {
    description: "The version to deploy",
    required: true,
    type: "string",
  },
  digest: {
    description: "The digest to deploy",
    required: false,
    type: "string",
  },
  environment: {
    description: "The environment to deploy to",
    required: true,
    type: "string",
  },
  services: {
    description: "JSON array of services to deploy",
    required: true,
    type: "string",
  },
};

const sharedPermissions = {
  ...permissions.contents.read,
  ...permissions.idToken.write,
}

// Context job - validates services and sets environment config
const contextJob = new ExtendedNormalJob("context", {
  "runs-on": "ubuntu-latest",
  "timeout-minutes": 5,
  steps: [
    checkoutStep("checkout"),
    setupNodeStep("setup_node"),
    new ExtendedStep({
      id: "services",
      name: "Validate services",
      uses: "./.github/actions/validate-services",
      with: {
        services: expressions.expn("inputs.services"),
      },
      outputs: ["services"],
    }),
    new ExtendedStep({
      id: "env_config",
      name: "Environment config",
      env: {
        ENVIRONMENT: expressions.expn("inputs.environment"),
      },
      run: dedentString(`
        if [[ "$ENVIRONMENT" == "stage" ]]; then
          ${echoKeyValue.toGithubOutput("subdomain_prefix", "stage")}
        else
          ${echoKeyValue.toGithubOutput("subdomain_prefix", "")}
        fi
      `),
      outputs: ["subdomain_prefix"],
    }),
  ],
  outputs: (steps) => ({
    services: steps.services.outputs.services,
    subdomain_prefix: steps.env_config.outputs.subdomain_prefix,
  }),
});

// Provision Infrastructure job
const provisionInfraJob = new ExtendedNormalJob("provision_infra", {
  name: "Provision Infrastructure",
  "runs-on": "ubuntu-latest",
  environment: expressions.expn("inputs.environment"),
  "timeout-minutes": 20,
  permissions: sharedPermissions,
  needs: [contextJob],
  steps: [
    checkoutStep("checkout"),
    new ExtendedStep({
      id: "auth",
      name: "Authenticate to GCP",
      uses: "google-github-actions/auth@v2",
      with: {
        workload_identity_provider: expressions.secret(
          "GCP_WORKLOAD_IDENTITY_PROVIDER",
        ),
        service_account: expressions.secret("GCP_SERVICE_ACCOUNT"),
      },
    }),
    new ExtendedStep({
      id: "setup_terraform",
      name: "Setup Terraform",
      uses: "hashicorp/setup-terraform@v3",
      with: {
        terraform_version: TERRAFORM_VERSION,
        terraform_wrapper: false,
      },
    }),
    new ExtendedStep({
      id: "init",
      name: "Terraform Init",
      env: {
        TF_STATE_BUCKET: expressions.var("TERRAFORM_STATE_BUCKET"),
        ENVIRONMENT: expressions.expn("inputs.environment"),
      },
      "working-directory": `infrastructure/terraform/environments/${expressions.expn("inputs.environment")}/infra`,
      run: `terraform init -input=false \\
  -backend-config="bucket=\${TF_STATE_BUCKET}" \\
  -backend-config="prefix=nopo/\${ENVIRONMENT}/infra"
`,
    }),
    new ExtendedStep({
      id: "apply",
      name: "Terraform Apply",
      env: {
        TF_VAR_project_id: expressions.var("GCP_PROJECT_ID"),
        TF_VAR_region: GCP_REGION,
        TF_VAR_domain: expressions.var("DOMAIN"),
        TF_VAR_supabase_database_url: expressions.secret("SUPABASE_DATABASE_URL"),
      },
      "working-directory": `infrastructure/terraform/environments/${expressions.expn("inputs.environment")}/infra`,
      run: dedentString(`
        # Apply infra changes (create/update registry, buckets, etc.)
        terraform apply -input=false -auto-approve

        # Capture outputs
        artifact_registry_url=$(terraform output -raw artifact_registry_url)
        static_bucket_name=$(terraform output -raw static_bucket_name)

        ${echoKeyValue.toGithubOutput("artifact_registry_url", "$artifact_registry_url")}
        ${echoKeyValue.toGithubOutput("static_bucket_name", "$static_bucket_name")}
      `),
      outputs: ["artifact_registry_url", "static_bucket_name"],
    }),
  ],
  outputs: (steps) => ({
    artifact_registry_url: steps.apply.outputs.artifact_registry_url,
    static_bucket_name: steps.apply.outputs.static_bucket_name,
  }),
});

// Get Current State job
const getCurrentStateJob = new ExtendedNormalJob("get_current_state", {
  name: "Get Current State",
  "runs-on": "ubuntu-latest",
  environment: expressions.expn("inputs.environment"),
  permissions: sharedPermissions,
  needs: [contextJob, provisionInfraJob],
  steps: [
    checkoutStep("checkout"),
    new ExtendedStep({
      id: "auth",
      name: "Authenticate to GCP",
      uses: "google-github-actions/auth@v2",
      with: {
        workload_identity_provider: expressions.secret(
          "GCP_WORKLOAD_IDENTITY_PROVIDER",
        ),
        service_account: expressions.secret("GCP_SERVICE_ACCOUNT"),
      },
    }),
    new ExtendedStep({
      id: "setup_terraform",
      name: "Setup Terraform",
      uses: "hashicorp/setup-terraform@v3",
      with: {
        terraform_version: TERRAFORM_VERSION,
        terraform_wrapper: false,
      },
    }),
    new ExtendedStep({
      id: "images",
      name: "Build image variables",
      env: {
        REGISTRY: expressions.expn(needsOutput(provisionInfraJob, "artifact_registry_url")),
        VERSION: expressions.expn("inputs.version"),
        SERVICES: expressions.expn(needsOutput(contextJob, "services")),
      },
      run: dedentString(`
        services_array=$(echo "\${SERVICES}" | jq -c '.')

        # Only set images for services we're actually deploying
        # For services not in the list, output empty string (Terraform will treat as null)
        if echo "\${services_array}" | jq -e '.[] | select(. == "backend")' > /dev/null 2>&1; then
          stable_backend_image="\${REGISTRY}/backend:\${VERSION}"
          canary_backend_image="\${REGISTRY}/backend:\${VERSION}"
        else
          stable_backend_image=""
          canary_backend_image=""
        fi

        if echo "\${services_array}" | jq -e '.[] | select(. == "web")' > /dev/null 2>&1; then
          stable_web_image="\${REGISTRY}/web:\${VERSION}"
          canary_web_image="\${REGISTRY}/web:\${VERSION}"
        else
          stable_web_image=""
          canary_web_image=""
        fi

        ${echoKeyValue.toGithubOutput("stable_backend_image", "$stable_backend_image")}
        ${echoKeyValue.toGithubOutput("stable_web_image", "$stable_web_image")}
        ${echoKeyValue.toGithubOutput("canary_backend_image", "$canary_backend_image")}
        ${echoKeyValue.toGithubOutput("canary_web_image", "$canary_web_image")}

        echo "Images for deployment:"
        echo "  Stable backend: \${stable_backend_image:-<not deploying>}"
        echo "  Stable web: \${stable_web_image:-<not deploying>}"
        echo "  Canary backend: \${canary_backend_image:-<not deploying>}"
        echo "  Canary web: \${canary_web_image:-<not deploying>}"
      `),
      outputs: [
        "stable_backend_image",
        "stable_web_image",
        "canary_backend_image",
        "canary_web_image",
      ],
    }),
  ],
  outputs: (steps) => ({
    stable_backend_image: steps.images.outputs.stable_backend_image,
    stable_web_image: steps.images.outputs.stable_web_image,
    canary_backend_image: steps.images.outputs.canary_backend_image,
    canary_web_image: steps.images.outputs.canary_web_image,
  }),
});

// Push Images job (matrix)
const pushImagesJob = new ExtendedNormalJob("push_images", {
  name: `Push ${expressions.expn("matrix.service")}`,
  "runs-on": "ubuntu-latest",
  "timeout-minutes": 15,
  permissions: sharedPermissions,
  strategy: {
    matrix: {
      service: expressions.expn(`fromJson(${needsOutput(contextJob, "services")})`),
    },
  },
  needs: [contextJob, provisionInfraJob],
  steps: [
    checkoutStep("checkout"),
    new ExtendedStep({
      id: "setup_docker",
      uses: "./.github/actions/setup-docker",
      with: {
        registry: "ghcr.io",
        username: expressions.expn("github.actor"),
        password: expressions.secret("GITHUB_TOKEN"),
      },
    }),
    new ExtendedStep({
      id: "auth",
      name: "Authenticate to GCP",
      uses: "google-github-actions/auth@v2",
      with: {
        workload_identity_provider: expressions.secret(
          "GCP_WORKLOAD_IDENTITY_PROVIDER",
        ),
        service_account: expressions.secret("GCP_SERVICE_ACCOUNT"),
      },
    }),
    new ExtendedStep({
      id: "configure_docker",
      name: "Configure Docker",
      run: `gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" --quiet`,
    }),
    new ExtendedStep({
      id: "push",
      name: "Push to Artifact Registry",
      env: {
        SOURCE_IMAGE: `ghcr.io/${expressions.expn("github.repository")}-${expressions.expn("matrix.service")}:${expressions.expn("inputs.version")}`,
        TARGET_IMAGE: `${expressions.expn(needsOutput(provisionInfraJob, "artifact_registry_url"))}/${expressions.expn("matrix.service")}:${expressions.expn("inputs.version")}`,
      },
      run: `docker pull "$SOURCE_IMAGE"
docker tag "$SOURCE_IMAGE" "$TARGET_IMAGE"
docker push "$TARGET_IMAGE"`,
    }),
  ],
});

// Deploy Canary job
const deployCanaryJob = new ExtendedNormalJob("deploy_canary", {
  name: "Deploy Canary",
  "runs-on": "ubuntu-latest",
  environment: {
    name: expressions.expn("inputs.environment"),
    url: expressions.expn("steps.deploy.outputs.public_url"),
  },
  permissions: sharedPermissions,
  needs: [contextJob, provisionInfraJob, getCurrentStateJob, pushImagesJob],
  steps: [
    checkoutStep("checkout"),
    new ExtendedStep({
      id: "auth",
      name: "Authenticate to GCP",
      uses: "google-github-actions/auth@v2",
      with: {
        workload_identity_provider: expressions.secret(
          "GCP_WORKLOAD_IDENTITY_PROVIDER",
        ),
        service_account: expressions.secret("GCP_SERVICE_ACCOUNT"),
      },
    }),
    new ExtendedStep({
      id: "deploy",
      name: "Deploy Services (Canary)",
      uses: "./.github/actions/deploy-gcp",
      with: {
        project_id: expressions.var("GCP_PROJECT_ID"),
        region: GCP_REGION,
        environment: expressions.expn("inputs.environment"),
        domain: expressions.var("DOMAIN"),
        subdomain_prefix: expressions.expn(needsOutput(contextJob, "subdomain_prefix")),
        terraform_state_bucket: expressions.var("TERRAFORM_STATE_BUCKET"),
        stable_backend_image: expressions.expn(needsOutput(getCurrentStateJob, "stable_backend_image")),
        stable_web_image: expressions.expn(needsOutput(getCurrentStateJob, "stable_web_image")),
        canary_backend_image: expressions.expn(needsOutput(getCurrentStateJob, "canary_backend_image")),
        canary_web_image: expressions.expn(needsOutput(getCurrentStateJob, "canary_web_image")),
        supabase_database_url: expressions.secret("SUPABASE_DATABASE_URL"),
      },
      outputs: ["public_url"],
    }),
  ],
  outputs: (steps) => ({
    public_url: steps.deploy.outputs.public_url,
  }),
});

// Upload Assets job (matrix)
const uploadAssetsJob = new ExtendedNormalJob("upload_assets", {
  name: `Upload Assets ${expressions.expn("matrix.service")}`,
  "runs-on": "ubuntu-latest",
  permissions: sharedPermissions,
  strategy: {
    matrix: {
      service: expressions.expn(`fromJson(${needsOutput(contextJob, "services")})`),
    },
  },
  needs: [contextJob, provisionInfraJob],
  steps: [
    checkoutStep("checkout"),
    setupNodeStep("setup_node"),
    new ExtendedStep({
      id: "setup_docker",
      uses: "./.github/actions/setup-docker",
      with: {
        registry: "ghcr.io",
        username: expressions.expn("github.actor"),
        password: expressions.secret("GITHUB_TOKEN"),
      },
    }),
    new ExtendedStep({
      id: "auth",
      name: "Authenticate to GCP",
      uses: "google-github-actions/auth@v2",
      with: {
        workload_identity_provider: expressions.secret(
          "GCP_WORKLOAD_IDENTITY_PROVIDER",
        ),
        service_account: expressions.secret("GCP_SERVICE_ACCOUNT"),
      },
    }),
    new ExtendedStep({
      id: "upload",
      name: "Upload to GCS",
      env: {
        GHCR_IMAGE: `ghcr.io/${expressions.expn("github.repository")}-${expressions.expn("matrix.service")}:${expressions.expn("inputs.version")}`,
        BUCKET_NAME: expressions.expn(needsOutput(provisionInfraJob, "static_bucket_name")),
        SERVICE: expressions.expn("matrix.service"),
      },
      run: dedentString(`
        # Extract service config
        service_config=$(make list -- --json --jq ".services.\\"\${SERVICE}\\"")
        static_path=$(echo "\${service_config}" | jq -r '.static_path // empty')

        if [[ -z "\${static_path}" || "\${static_path}" == "null" ]]; then
          echo "No static_path for \${SERVICE}, skipping"
          exit 0
        fi

        # Pull and extract
        docker pull "\${GHCR_IMAGE}"
        CONTAINER_ID=$(docker create "\${GHCR_IMAGE}")
        EXTRACT_DIR=$(mktemp -d)

        if docker cp "\${CONTAINER_ID}:/app/apps/\${SERVICE}/\${static_path}/." "\${EXTRACT_DIR}/" 2>/dev/null; then
          echo "Uploading assets to gs://\${BUCKET_NAME}/\${SERVICE}/..."
          gcloud storage cp -r "\${EXTRACT_DIR}/*" "gs://\${BUCKET_NAME}/\${SERVICE}/" \\
            --cache-control="public, max-age=31536000, immutable" --quiet
        else
          echo "No static files found in image"
        fi

        docker rm "\${CONTAINER_ID}" > /dev/null
      `),
    }),
  ],
});

// Run Migrations job
const runMigrationsJob = new ExtendedNormalJob("run_migrations", {
  name: "Database Migrations",
  "runs-on": "ubuntu-latest",
  permissions: sharedPermissions,
  needs: [contextJob, deployCanaryJob],
  steps: [
    checkoutStep("checkout"),
    setupNodeStep("setup_node"),
    new ExtendedStep({
      id: "auth",
      name: "Authenticate to GCP",
      uses: "google-github-actions/auth@v2",
      with: {
        workload_identity_provider: expressions.secret(
          "GCP_WORKLOAD_IDENTITY_PROVIDER",
        ),
        service_account: expressions.secret("GCP_SERVICE_ACCOUNT"),
      },
    }),
    new ExtendedStep({
      id: "setup_gcloud",
      name: "Setup Cloud SDK",
      uses: "google-github-actions/setup-gcloud@v2",
    }),
    new ExtendedStep({
      id: "run_migrations",
      name: "Check and Run Migrations",
      env: {
        PROJECT_ID: expressions.var("GCP_PROJECT_ID"),
        REGION: GCP_REGION,
        ENVIRONMENT: expressions.expn("inputs.environment"),
        SERVICES: expressions.expn(needsOutput(contextJob, "services")),
      },
      run: dedentString(`
        services_payload=$(make list -- --json --jq '.services')
        for service in $(echo "\${SERVICES}" | jq -r '.[]'); do
          config=$(echo "\${services_payload}" | jq -c --arg s "$service" '.[$s]')
          run_migrations=$(echo "\${config}" | jq -r '.run_migrations // false')

          if [[ "\${run_migrations}" == "true" ]]; then
            echo "Running migrations for \${service}..."
            JOB_NAME="nopo-\${ENVIRONMENT}-\${service}-migrate"
            gcloud run jobs execute "\${JOB_NAME}" --project="\${PROJECT_ID}" --region="\${REGION}" --wait || true
          fi
        done
      `),
    }),
  ],
});

// Smoketest Canary job
const smoketestCanaryJob = new ExtendedNormalJob("smoketest_canary", {
  name: "Smoketest Canary",
  "runs-on": "ubuntu-latest",
  needs: [deployCanaryJob, runMigrationsJob, uploadAssetsJob],
  steps: [
    checkoutStep("checkout"),
    setupNodeStep("setup_node"),
    new ExtendedStep({
      id: "smoketest",
      name: "Test Canary",
      uses: "./.github/actions/smoketest",
      with: {
        public_url: expressions.expn(needsOutput(deployCanaryJob, "public_url")),
        canary: true,
      },
    }),
  ],
});

// Promote job
const promoteJob = new ExtendedNormalJob("promote", {
  name: "Promote to Stable",
  "runs-on": "ubuntu-latest",
  environment: {
    name: expressions.expn("inputs.environment"),
    url: `https://${expressions.expn(`${needsOutput(contextJob, "subdomain_prefix")} && format('{0}.', ${needsOutput(contextJob, "subdomain_prefix")}) || ''`)}${expressions.var("DOMAIN")}`,
  },
  permissions: sharedPermissions,
  needs: [
    contextJob,
    deployCanaryJob,
    smoketestCanaryJob,
    getCurrentStateJob,
  ],
  steps: [
    checkoutStep("checkout"),
    new ExtendedStep({
      id: "auth",
      name: "Authenticate to GCP",
      uses: "google-github-actions/auth@v2",
      with: {
        workload_identity_provider: expressions.secret(
          "GCP_WORKLOAD_IDENTITY_PROVIDER",
        ),
        service_account: expressions.secret("GCP_SERVICE_ACCOUNT"),
      },
    }),
    new ExtendedStep({
      id: "deploy",
      name: "Deploy Services (Promote)",
      uses: "./.github/actions/deploy-gcp",
      with: {
        project_id: expressions.var("GCP_PROJECT_ID"),
        region: GCP_REGION,
        environment: expressions.expn("inputs.environment"),
        domain: expressions.var("DOMAIN"),
        subdomain_prefix: expressions.expn(needsOutput(contextJob, "subdomain_prefix")),
        terraform_state_bucket: expressions.var("TERRAFORM_STATE_BUCKET"),
        stable_backend_image: expressions.expn(needsOutput(getCurrentStateJob, "canary_backend_image")),
        stable_web_image: expressions.expn(needsOutput(getCurrentStateJob, "canary_web_image")),
        canary_backend_image: expressions.expn(needsOutput(getCurrentStateJob, "canary_backend_image")),
        canary_web_image: expressions.expn(needsOutput(getCurrentStateJob, "canary_web_image")),
        supabase_database_url: expressions.secret("SUPABASE_DATABASE_URL"),
      },
    }),
  ],
});

// Tag Environment job (matrix)
const tagEnvironmentJob = new ExtendedNormalJob("tag_environment", {
  name: "Tag Environment",
  "runs-on": "ubuntu-latest",
  permissions: sharedPermissions,
  strategy: {
    matrix: {
      service: expressions.expn(`fromJson(${needsOutput(contextJob, "services")})`),
    },
  },
  needs: [contextJob, promoteJob],
  steps: [
    checkoutStep("checkout"),
    setupDockerStep("setup_docker", {
      registry: "ghcr.io",
      username: expressions.expn("github.actor"),
      password: expressions.secret("GITHUB_TOKEN"),
    }),
    new ExtendedStep({
      id: "tag",
      name: "Tag Image",
      env: {
        SOURCE_IMAGE: `ghcr.io/${expressions.expn("github.repository")}-${expressions.expn("matrix.service")}:${expressions.expn("inputs.version")}`,
        TARGET_IMAGE: `ghcr.io/${expressions.expn("github.repository")}-${expressions.expn("matrix.service")}:${expressions.expn("inputs.environment")}`,
      },
      run: dedentString(`
        docker pull "$SOURCE_IMAGE"
        docker tag "$SOURCE_IMAGE" "$TARGET_IMAGE"
        docker push "$TARGET_IMAGE"
      `),
    }),
  ],
});

// Main workflow
export const deployGcpWorkflow = new Workflow("_deploy_gcp", {
  name: "Deploy to GCP",
  on: {
    workflow_dispatch: {
      inputs: {
        ...sharedInputs,
        environment: {
          description: "The environment to deploy to",
          required: true,
          type: "choice",
          options: ["stage", "prod"],
        },
      },
    },
    workflow_call: {
      inputs: sharedInputs,
    },
  },
  concurrency: {
    group: `deploy-${expressions.expn("inputs.environment")}`,
    "cancel-in-progress": false,
  },
  permissions: emptyPermissions,
  defaults: defaultDefaults,
  env: {
    GCP_REGION: GCP_REGION,
    TERRAFORM_VERSION: TERRAFORM_VERSION,
  },
});

deployGcpWorkflow.addJobs([
  contextJob,
  provisionInfraJob,
  getCurrentStateJob,
  pushImagesJob,
  deployCanaryJob,
  uploadAssetsJob,
  runMigrationsJob,
  smoketestCanaryJob,
  promoteJob,
  tagEnvironmentJob,
]);
