# Migrations

Date: 2025-07-01

Status: accepted

## Context

Handling migrations is a delicate process. Migrations can introduce structural changes to a database as well as data changes.
They can be arbitrarily large in terms of size, complexity, runtime impact and general safety.
Finally, migrations are notoriously difficult to test. Migrations run against an existing database and since databases
are not necessarily in sync with each other across different environments, just because it passes locally, or in ci, or even in stage,
does not guarantee that something won't go horribly wrong in production.

There are 3 wasy of handling migrations in an automated way:

In any of these scenarios the following statements are true:

- migrations are generated via code changes using an orm tool and executed via a script.
- migrations run in CI and we execute our test suite against the migrated (and possible non migrated) database.

### 1. Code first

    We always deploy the code first, and only run migrations if the code deploys successfully.
    In this strategy our code should always be "backward" compatible so there should be no code changes that break against
    the existing database.

    We can test this deployment by running our test suite in CI against the latest deployed version,
    without applying any migrations from the existing patch. If the tests pass, then we can say that our code generally
    runs against the previous version of the database. This is a loose test, there are no guarantees.

    In order to ensure that the base branch of our database state is deterministic, we sould automatically run migrations
    after successful deployment and before uploading the environment tag. That way the current latest environment tag always
    points to the latest (current) version of the database schema.

    This strategy is effective against structural changes like removed columns, or modified constraints. It is not as effective
    against data changes as these are inherently non-deterministic. we could consider forbidding arbitrary data changes via migrations.

### 2. Migration first

  We always run migrations first, and only deploy the code if the migrations run successfully.
  In this strategy we deploy the code first to a sandbox environment connected to the environment's database.
  There we run the migrations introduced by the deployment and only if they run successfully do we continue with the deployment.
  In this strategy our migrations should always be "backward" compatible so there should be no migrations that break aginst
  the current codebase.

  We can test this deployment by running our migrations in CI against the latest deployed version of the code. If the tests pass,
  then we can say that our migrations are generally compatible with the current codebase. This is a loose test, there are no guarantees.

  It is easier to make this test deterministic because we can deploy our new version, run all migrations, then deploy the latest
  environment tag and run our test suite against the migrated database.

### 3. Simultaneous

  We deploy the code and run the migrations in parallel. This is the simplest strategy, but also the most dangerous.
  In this strategy we deploy the code and run migrations on a sandbox environment connected to the environment's database.
  If either fail, we rollback both.

  The biggest risk here is that we cannot deterministically compare forward or backward compatibility of either the code or the migrations.

## Decision

We are going with a hybrid of 1 and 2. Our CI will check every merge request to see if it introduces migrations or non-migraitons.
We can diff the patch for changes to "migrations" folders and for changes to the "source" folders. If a patch contains both, it is considered
unsafe and will be rejected. Note, users with bypass permissions will still be able to merge a rejected pull request but it should be considered
a generally bad idea.

Now we can ensure that every deployment will either introduce new migrations or new code, not both. This removes the potential
risk of incopatible code and migrations and also means we know when we need to run migrations during a deployment.

For a pull request that introduces migrations, we will build the image, test it according to the cretieria of stategy 2.
We don't need any special handling for this, because the state of the code in the patch and the state of the code in the latest
deployment are by definition the same. If tests pass, we can deploy the image (effectively a no op) and run the migrations.

If migrations fail, we rollback and fail the deployment, preventing merge in the case of a non-bypassed pull request.
If migrations pass, we merge the PR, push the latest environment tag and we are done.

For a pull request that introduces new code, we will build the image, test it according to the cretieria of stategy 1.
Again, we don't need any special handling for this because we know that the state of the database (in terms of migraitons) is the same as the state of the code in the patch. If the tests pass, we can deploy the image and run the migrations (effectively a no op).

If deployment fail, we rollback and fail the deployment, preventing merge in the case of a non-bypassed pull request.
If deployment passes, we merge the PR, push the latest environment tag and we are done.

## Migration Checking

To avoid wasting cloud resources running migration jobs when there are no pending migrations, the deployment workflow
includes a migration check step before running the actual migration job.

### How it works

1. Services with `run_migrations: true` in their `infrastructure.json` have two Cloud Run jobs:
   - `{env}-{service}-migrate-check`: Checks if there are pending migrations (exits 0 if none, exits 1 if pending)
   - `{env}-{service}-migrate`: Runs the actual migrations

2. During deployment, the workflow:
   - First executes the check job for each migration-enabled service
   - Only runs the migration job if the check indicates pending migrations
   - Skips the migration job if no migrations are pending, saving cloud resources

### Local usage

To check for pending migrations locally:

```bash
nopo migrate check backend
```

This uses Django's `migrate --check` command which exits with code 0 if no migrations are pending, or code 1 if there are unapplied migrations.

### Inspecting migrations on deployed environments

To check if a deployed service has pending migrations:

```bash
# Check the stage environment
gcloud run jobs execute nopo-stage-backend-migrate-check \
  --project=YOUR_PROJECT_ID \
  --region=us-central1

# Check the prod environment
gcloud run jobs execute nopo-prod-backend-migrate-check \
  --project=YOUR_PROJECT_ID \
  --region=us-central1
```

The job will succeed (exit 0) if no migrations are pending, or fail (exit 1) if migrations need to be applied.

## Consequences

This introduces a major constraint in the types of changes we can make in a single pull request.
We cannot follow the "typical" pattern of making changes to our ORM classes, generating the migration scripts and running
everything on the "latest" version of both code and database. Because we have fully continuous and automated deployments,
this is a very minor inconvenience. When making a change that requires a migration of the database as well as code changes,
the happy path should be to make the minimal set of required migrations first, then after deploying those changes make code changes.

This also means that migrations must be totally self contained. If you run a migration that executes arbitrary code,
that code must be defined in the migration itself. Again, this is more of a feature than a bug. It enforces isolation of migration code,
making sure we don't make cascading changes that could be hard to test.

This strategy does not prevent using migration scripts to execute arbitrary non-structural datbaase changes. You could still
write a migration script that removes all records from a table or adds one billion records to a table. This should generally
be considered a bad idea. Large changes to the database shuld be executed via asynhronous jobs/tasks and not via migration scripts.
Ultimately constraining this feature will be considered outside of the scope for this decision but should be considered in a future decision.
