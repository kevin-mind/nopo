import { NormalJob, Step, Workflow } from "@github-actions-workflow-ts/lib";
import {
  checkoutStep,
  setupNodeStep,
  setupDockerStep,
  validateServicesStep,
} from "./lib/steps";
import { dockerPullTagPush } from "./lib/cli/docker";
import { defaultDefaults, emptyPermissions } from "./lib/patterns";

const GCP_REGION = "us-central1";
const TERRAFORM_VERSION = "1.7.0";

// Shared inputs definition for both workflow_dispatch and workflow_call
const sharedInputs = {
  version: {
    description: "The version to deploy",
    required: true,
    type: "string" as const,
  },
  digest: {
    description: "The digest to deploy",
    required: false,
    type: "string" as const,
  },
  environment: {
    description: "The environment to deploy to",
    required: true,
    type: "string" as const,
  },
  services: {
    description: "JSON array of services to deploy",
    required: true,
    type: "string" as const,
  },
};

// Context job - validates services and sets environment config
const contextJob = new NormalJob("context", {
  "runs-on": "ubuntu-latest",
  "timeout-minutes": 5,
  outputs: {
    services: "${{ steps.services.outputs.services }}",
    subdomain_prefix: "${{ steps.env_config.outputs.subdomain_prefix }}",
  },
});

contextJob.addSteps([
  checkoutStep,
  setupNodeStep,
  validateServicesStep("services", {
    services: "${{ inputs.services }}",
  }),
  new Step({
    name: "Environment config",
    id: "env_config",
    env: {
      ENVIRONMENT: "${{ inputs.environment }}",
    },
    run: `if [[ "$ENVIRONMENT" == "stage" ]]; then
  echo "subdomain_prefix=stage" >> "$GITHUB_OUTPUT"
else
  echo "subdomain_prefix=" >> "$GITHUB_OUTPUT"
fi
`,
  }),
]);

// Provision Infrastructure job
const provisionInfraJob = new NormalJob("provision_infra", {
  name: "Provision Infrastructure",
  "runs-on": "ubuntu-latest",
  environment: "${{ inputs.environment }}",
  "timeout-minutes": 20,
  permissions: {
    contents: "read" as const,
    "id-token": "write" as const,
  },
  outputs: {
    artifact_registry_url: "${{ steps.apply.outputs.artifact_registry_url }}",
    static_bucket_name: "${{ steps.apply.outputs.static_bucket_name }}",
  },
});
provisionInfraJob.needs([contextJob]);

provisionInfraJob.addSteps([
  checkoutStep,
  new Step({
    name: "Authenticate to GCP",
    uses: "google-github-actions/auth@v2",
    with: {
      workload_identity_provider:
        "${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}",
      service_account: "${{ secrets.GCP_SERVICE_ACCOUNT }}",
    },
  }),
  new Step({
    name: "Setup Terraform",
    uses: "hashicorp/setup-terraform@v3",
    with: {
      terraform_version: TERRAFORM_VERSION,
      terraform_wrapper: false,
    },
  }),
  new Step({
    name: "Terraform Init",
    env: {
      TF_STATE_BUCKET: "${{ vars.TERRAFORM_STATE_BUCKET }}",
      ENVIRONMENT: "${{ inputs.environment }}",
    },
    "working-directory":
      "infrastructure/terraform/environments/${{ inputs.environment }}/infra",
    run: `terraform init -input=false \\
  -backend-config="bucket=\${TF_STATE_BUCKET}" \\
  -backend-config="prefix=nopo/\${ENVIRONMENT}/infra"
`,
  }),
  new Step({
    name: "Terraform Apply",
    id: "apply",
    env: {
      TF_VAR_project_id: "${{ vars.GCP_PROJECT_ID }}",
      TF_VAR_region: GCP_REGION,
      TF_VAR_domain: "${{ vars.DOMAIN }}",
      TF_VAR_supabase_database_url: "${{ secrets.SUPABASE_DATABASE_URL }}",
    },
    "working-directory":
      "infrastructure/terraform/environments/${{ inputs.environment }}/infra",
    run: `# Apply infra changes (create/update registry, buckets, etc.)
terraform apply -input=false -auto-approve

# Capture outputs
artifact_registry_url=$(terraform output -raw artifact_registry_url)
static_bucket_name=$(terraform output -raw static_bucket_name)

echo "artifact_registry_url=\${artifact_registry_url}" >> "$GITHUB_OUTPUT"
echo "static_bucket_name=\${static_bucket_name}" >> "$GITHUB_OUTPUT"
`,
  }),
]);

// Get Current State job
const getCurrentStateJob = new NormalJob("get_current_state", {
  name: "Get Current State",
  "runs-on": "ubuntu-latest",
  environment: "${{ inputs.environment }}",
  permissions: {
    contents: "read" as const,
    "id-token": "write" as const,
  },
  outputs: {
    stable_backend_image: "${{ steps.images.outputs.stable_backend_image }}",
    stable_web_image: "${{ steps.images.outputs.stable_web_image }}",
    canary_backend_image: "${{ steps.images.outputs.canary_backend_image }}",
    canary_web_image: "${{ steps.images.outputs.canary_web_image }}",
  },
});
getCurrentStateJob.needs([contextJob, provisionInfraJob]);

getCurrentStateJob.addSteps([
  checkoutStep,
  new Step({
    name: "Authenticate to GCP",
    uses: "google-github-actions/auth@v2",
    with: {
      workload_identity_provider:
        "${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}",
      service_account: "${{ secrets.GCP_SERVICE_ACCOUNT }}",
    },
  }),
  new Step({
    name: "Setup Terraform",
    uses: "hashicorp/setup-terraform@v3",
    with: {
      terraform_version: TERRAFORM_VERSION,
      terraform_wrapper: false,
    },
  }),
  new Step({
    name: "Build image variables",
    id: "images",
    env: {
      REGISTRY: "${{ needs.provision_infra.outputs.artifact_registry_url }}",
      VERSION: "${{ inputs.version }}",
      SERVICES: "${{ needs.context.outputs.services }}",
    },
    run: `services_array=$(echo "\${SERVICES}" | jq -c '.')

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

echo "stable_backend_image=\${stable_backend_image}" >> "$GITHUB_OUTPUT"
echo "stable_web_image=\${stable_web_image}" >> "$GITHUB_OUTPUT"
echo "canary_backend_image=\${canary_backend_image}" >> "$GITHUB_OUTPUT"
echo "canary_web_image=\${canary_web_image}" >> "$GITHUB_OUTPUT"

echo "Images for deployment:"
echo "  Stable backend: \${stable_backend_image:-<not deploying>}"
echo "  Stable web: \${stable_web_image:-<not deploying>}"
echo "  Canary backend: \${canary_backend_image:-<not deploying>}"
echo "  Canary web: \${canary_web_image:-<not deploying>}"
`,
  }),
]);

// Push Images job (matrix)
const pushImagesJob = new NormalJob("push_images", {
  name: "Push ${{ matrix.service }}",
  "runs-on": "ubuntu-latest",
  "timeout-minutes": 15,
  permissions: {
    contents: "read" as const,
    "id-token": "write" as const,
  },
  strategy: {
    matrix: {
      service: "${{ fromJson(needs.context.outputs.services) }}",
    },
  },
});
pushImagesJob.needs([contextJob, provisionInfraJob]);

pushImagesJob.addSteps([
  checkoutStep,
  setupDockerStep({
    registry: "ghcr.io",
    username: "${{ github.actor }}",
    password: "${{ secrets.GITHUB_TOKEN }}",
  }),
  new Step({
    name: "Authenticate to GCP",
    uses: "google-github-actions/auth@v2",
    with: {
      workload_identity_provider:
        "${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}",
      service_account: "${{ secrets.GCP_SERVICE_ACCOUNT }}",
    },
  }),
  new Step({
    name: "Configure Docker",
    run: `gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" --quiet`,
  }),
  dockerPullTagPush(
    {
      SOURCE_IMAGE:
        "ghcr.io/${{ github.repository }}-${{ matrix.service }}:${{ inputs.version }}",
      TARGET_IMAGE:
        "${{ needs.provision_infra.outputs.artifact_registry_url }}/${{ matrix.service }}:${{ inputs.version }}",
    },
    "Push to Artifact Registry",
  ),
]);

// Deploy Canary job
const deployCanaryJob = new NormalJob("deploy_canary", {
  name: "Deploy Canary",
  "runs-on": "ubuntu-latest",
  environment: {
    name: "${{ inputs.environment }}",
    url: "${{ steps.deploy.outputs.public_url }}",
  },
  permissions: {
    contents: "read" as const,
    "id-token": "write" as const,
  },
  outputs: {
    public_url: "${{ steps.deploy.outputs.public_url }}",
  },
});
deployCanaryJob.needs([
  contextJob,
  provisionInfraJob,
  getCurrentStateJob,
  pushImagesJob,
]);

deployCanaryJob.addSteps([
  checkoutStep,
  new Step({
    name: "Authenticate to GCP",
    uses: "google-github-actions/auth@v2",
    with: {
      workload_identity_provider:
        "${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}",
      service_account: "${{ secrets.GCP_SERVICE_ACCOUNT }}",
    },
  }),
  new Step({
    name: "Deploy Services (Canary)",
    id: "deploy",
    uses: "./.github/actions/deploy-gcp",
    with: {
      project_id: "${{ vars.GCP_PROJECT_ID }}",
      region: GCP_REGION,
      environment: "${{ inputs.environment }}",
      domain: "${{ vars.DOMAIN }}",
      subdomain_prefix: "${{ needs.context.outputs.subdomain_prefix }}",
      terraform_state_bucket: "${{ vars.TERRAFORM_STATE_BUCKET }}",
      stable_backend_image:
        "${{ needs.get_current_state.outputs.stable_backend_image }}",
      stable_web_image:
        "${{ needs.get_current_state.outputs.stable_web_image }}",
      canary_backend_image:
        "${{ needs.get_current_state.outputs.canary_backend_image }}",
      canary_web_image:
        "${{ needs.get_current_state.outputs.canary_web_image }}",
      supabase_database_url: "${{ secrets.SUPABASE_DATABASE_URL }}",
    },
  }),
]);

// Upload Assets job (matrix)
const uploadAssetsJob = new NormalJob("upload_assets", {
  name: "Upload Assets ${{ matrix.service }}",
  "runs-on": "ubuntu-latest",
  permissions: {
    contents: "read" as const,
    "id-token": "write" as const,
  },
  strategy: {
    matrix: {
      service: "${{ fromJson(needs.context.outputs.services) }}",
    },
  },
});
uploadAssetsJob.needs([contextJob, provisionInfraJob]);

uploadAssetsJob.addSteps([
  checkoutStep,
  setupNodeStep,
  setupDockerStep({
    registry: "ghcr.io",
    username: "${{ github.actor }}",
    password: "${{ secrets.GITHUB_TOKEN }}",
  }),
  new Step({
    name: "Authenticate to GCP",
    uses: "google-github-actions/auth@v2",
    with: {
      workload_identity_provider:
        "${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}",
      service_account: "${{ secrets.GCP_SERVICE_ACCOUNT }}",
    },
  }),
  new Step({
    name: "Upload to GCS",
    env: {
      GHCR_IMAGE:
        "ghcr.io/${{ github.repository }}-${{ matrix.service }}:${{ inputs.version }}",
      BUCKET_NAME: "${{ needs.provision_infra.outputs.static_bucket_name }}",
      SERVICE: "${{ matrix.service }}",
    },
    run: `# Extract service config
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
`,
  }),
]);

// Run Migrations job
const runMigrationsJob = new NormalJob("run_migrations", {
  name: "Database Migrations",
  "runs-on": "ubuntu-latest",
  permissions: {
    contents: "read" as const,
    "id-token": "write" as const,
  },
});
runMigrationsJob.needs([contextJob, deployCanaryJob]);

runMigrationsJob.addSteps([
  checkoutStep,
  setupNodeStep,
  new Step({
    name: "Authenticate to GCP",
    uses: "google-github-actions/auth@v2",
    with: {
      workload_identity_provider:
        "${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}",
      service_account: "${{ secrets.GCP_SERVICE_ACCOUNT }}",
    },
  }),
  new Step({
    name: "Setup Cloud SDK",
    uses: "google-github-actions/setup-gcloud@v2",
  }),
  new Step({
    name: "Check and Run Migrations",
    env: {
      PROJECT_ID: "${{ vars.GCP_PROJECT_ID }}",
      REGION: GCP_REGION,
      ENVIRONMENT: "${{ inputs.environment }}",
      SERVICES: "${{ needs.context.outputs.services }}",
    },
    run: `services_payload=$(make list -- --json --jq '.services')
for service in $(echo "\${SERVICES}" | jq -r '.[]'); do
  config=$(echo "\${services_payload}" | jq -c --arg s "$service" '.[$s]')
  run_migrations=$(echo "\${config}" | jq -r '.run_migrations // false')

  if [[ "\${run_migrations}" == "true" ]]; then
    echo "Running migrations for \${service}..."
    JOB_NAME="nopo-\${ENVIRONMENT}-\${service}-migrate"
    gcloud run jobs execute "\${JOB_NAME}" --project="\${PROJECT_ID}" --region="\${REGION}" --wait || true
  fi
done
`,
  }),
]);

// Smoketest Canary job
const smoketestCanaryJob = new NormalJob("smoketest_canary", {
  name: "Smoketest Canary",
  "runs-on": "ubuntu-latest",
});
smoketestCanaryJob.needs([deployCanaryJob, runMigrationsJob, uploadAssetsJob]);

smoketestCanaryJob.addSteps([
  checkoutStep,
  setupNodeStep,
  new Step({
    name: "Test Canary",
    uses: "./.github/actions/smoketest",
    with: {
      public_url: "${{ needs.deploy_canary.outputs.public_url }}",
      canary: true,
    },
  }),
]);

// Promote job
const promoteJob = new NormalJob("promote", {
  name: "Promote to Stable",
  "runs-on": "ubuntu-latest",
  environment: {
    name: "${{ inputs.environment }}",
    url: "https://${{ needs.context.outputs.subdomain_prefix && format('{0}.', needs.context.outputs.subdomain_prefix) || '' }}${{ vars.DOMAIN }}",
  },
  permissions: {
    contents: "read" as const,
    "id-token": "write" as const,
  },
});
promoteJob.needs([
  contextJob,
  deployCanaryJob,
  smoketestCanaryJob,
  getCurrentStateJob,
]);

promoteJob.addSteps([
  checkoutStep,
  new Step({
    name: "Authenticate to GCP",
    uses: "google-github-actions/auth@v2",
    with: {
      workload_identity_provider:
        "${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}",
      service_account: "${{ secrets.GCP_SERVICE_ACCOUNT }}",
    },
  }),
  new Step({
    name: "Deploy Services (Promote)",
    uses: "./.github/actions/deploy-gcp",
    with: {
      project_id: "${{ vars.GCP_PROJECT_ID }}",
      region: GCP_REGION,
      environment: "${{ inputs.environment }}",
      domain: "${{ vars.DOMAIN }}",
      subdomain_prefix: "${{ needs.context.outputs.subdomain_prefix }}",
      terraform_state_bucket: "${{ vars.TERRAFORM_STATE_BUCKET }}",
      stable_backend_image:
        "${{ needs.get_current_state.outputs.canary_backend_image }}",
      stable_web_image:
        "${{ needs.get_current_state.outputs.canary_web_image }}",
      canary_backend_image:
        "${{ needs.get_current_state.outputs.canary_backend_image }}",
      canary_web_image:
        "${{ needs.get_current_state.outputs.canary_web_image }}",
      supabase_database_url: "${{ secrets.SUPABASE_DATABASE_URL }}",
    },
  }),
]);

// Tag Environment job (matrix)
const tagEnvironmentJob = new NormalJob("tag_environment", {
  name: "Tag Environment",
  "runs-on": "ubuntu-latest",
  permissions: {
    contents: "read" as const,
    packages: "write" as const,
  },
  strategy: {
    matrix: {
      service: "${{ fromJson(needs.context.outputs.services) }}",
    },
  },
});
tagEnvironmentJob.needs([contextJob, promoteJob]);

tagEnvironmentJob.addSteps([
  checkoutStep,
  setupDockerStep({
    registry: "ghcr.io",
    username: "${{ github.actor }}",
    password: "${{ secrets.GITHUB_TOKEN }}",
  }),
  dockerPullTagPush(
    {
      SOURCE_IMAGE:
        "ghcr.io/${{ github.repository }}-${{ matrix.service }}:${{ inputs.version }}",
      TARGET_IMAGE:
        "ghcr.io/${{ github.repository }}-${{ matrix.service }}:${{ inputs.environment }}",
    },
    "Tag Image",
  ),
]);

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
          type: "choice" as const,
          options: ["stage", "prod"],
        },
      },
    },
    workflow_call: {
      inputs: sharedInputs,
    },
  },
  concurrency: {
    group: "deploy-${{ inputs.environment }}",
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
