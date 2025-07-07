from django.contrib.staticfiles.storage import staticfiles_storage
from django.urls import reverse
from jinja2 import Environment


def environment(**options):
    """
    Create and configure a Jinja2 environment for Django.

    This function provides Django-specific functionality to Jinja2 templates
    including access to static files and URL reversing.
    """
    env = Environment(**options)
    env.globals.update(
        {
            "static": staticfiles_storage.url,
            "url": reverse,
        }
    )
    return env
