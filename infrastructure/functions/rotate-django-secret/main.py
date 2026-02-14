"""Cloud Function to auto-rotate Django secret keys in Secret Manager."""

import base64
import json
import secrets
import string

import functions_framework
from cloudevents.http import CloudEvent
from google.cloud import secretmanager


@functions_framework.cloud_event
def rotate_secret(cloud_event: CloudEvent) -> None:
    """Handle Pub/Sub message for secret rotation.

    Triggered when Secret Manager publishes a rotation notification.
    Only rotates django-secret secrets (not database URLs).
    """
    data = base64.b64decode(cloud_event.data["message"]["data"]).decode()
    payload = json.loads(data)

    secret_name = payload.get("name", "")

    if "django-secret" not in secret_name:
        print(f"Skipping non-Django secret: {secret_name}")
        return

    # Generate a new 50-character random secret
    alphabet = string.ascii_letters + string.digits + string.punctuation
    new_secret = "".join(secrets.choice(alphabet) for _ in range(50))

    client = secretmanager.SecretManagerServiceClient()
    client.add_secret_version(
        request={
            "parent": secret_name,
            "payload": {"data": new_secret.encode("UTF-8")},
        }
    )
    print(f"Rotated secret: {secret_name}")
