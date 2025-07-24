from django.contrib import admin
from django.urls import path, include

from backend.mysite.views import home


urlpatterns = [
    path("django", home),
    path("admin/", admin.site.urls),
    path("api/", include("backend.mysite.api_urls")),
]
