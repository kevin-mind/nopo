from urllib.parse import urljoin
from django.conf import settings
from django.utils.safestring import mark_safe
from django.contrib.staticfiles.storage import staticfiles_storage
from django.urls import reverse
from django_vite.core.tag_generator import TagGenerator
from django_vite.templatetags.django_vite import (
    vite_asset as _vite_asset,
    vite_hmr_client,
    vite_legacy_polyfills,
    vite_legacy_asset,
)
from jinja2 import Environment


def vite_asset(name, *args, **kwargs):
    """
    Get the Vite asset URL for a given name.

    This function is a wrapper around the `vite_asset` template tag to be used
    in Jinja2 templates.
    """
    django_vite = settings.DJANGO_VITE["default"]
    if django_vite["dev_mode"]:
        scripts_attrs = {"type": "module", "crossorigin": "", **kwargs}
        return mark_safe(
            TagGenerator.script(
                urljoin(
                    f"{settings.STATIC_URL}{django_vite['static_url_prefix']}/", name
                ),
                attrs=scripts_attrs,
            )
        )

    return _vite_asset(name, *args, **kwargs)


def environment(**options):
    """
    Create and configure a Jinja2 environment for Django.

    This function provides Django-specific functionality to Jinja2 templates
    including access to static files and URL reversing.
    """
    env = Environment(
        loader=options["loader"],
        autoescape=options["autoescape"],
        auto_reload=True,
    )
    env.globals.update(
        {
            "static": staticfiles_storage.url,
            "url": reverse,
            "vite_asset": vite_asset,
            "vite_hmr_client": vite_hmr_client,
            "vite_legacy_polyfills": vite_legacy_polyfills,
            "vite_legacy_asset": vite_legacy_asset,
        }
    )
    return env
