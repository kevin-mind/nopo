from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.http import HttpResponse

def home(request):
    print(f'host: {request.get_host()}')
    return HttpResponse("Hello, World!", status=200)

def version(request):
    with open('/build-info.json') as file:
        return HttpResponse(file.read(), content_type='application/json')

base_urlpatterns = [
    path('', home, name='home'),
    path('admin/', admin.site.urls),
]

base_path = f'{settings.SERVICE_PUBLIC_PATH.strip("/")}/'

urlpatterns = [
    path('__version__', version),
    path(base_path, include(base_urlpatterns)),
    path(base_path.rstrip('/'), home),
]
