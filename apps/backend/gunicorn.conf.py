import os

host = os.environ.get('HOST', '0.0.0.0')
port = os.environ.get('PORT', '80')

print(f"host: {host}, port: {port}")

bind = f"{host}:{port}"
workers = int(os.environ.get("WEB_CONCURRENCY", 4))
