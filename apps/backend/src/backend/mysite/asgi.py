import os

from django.core.asgi import get_asgi_application

# Add the project root to the Python path
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "settings")

application = get_asgi_application()
