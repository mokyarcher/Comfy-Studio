from pathlib import Path

path = Path("/etc/nginx/conf.d/joy-download.conf")
text = path.read_text(encoding="utf-8")
marker = "location /qwen-image/"
if marker in text:
    print("already patched")
else:
    needle = "    client_max_body_size 200m;\n\n    location / {"
    insert = """    client_max_body_size 200m;

    # ComfyUI image API (path prefix; strips /qwen-image)
    location /qwen-image/ {
        proxy_pass http://127.0.0.1:18000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }

    location / {"""
    if needle not in text:
        raise SystemExit("unexpected joy-download.conf format")
    text = text.replace(needle, insert, 1)
    path.write_text(text, encoding="utf-8")
    print("patched joy-download.conf")

# Dedicated IP port (no domain / no DNSPod block). Open SG for 18081 if needed.
Path("/etc/nginx/conf.d/qwen-image-ip.conf").write_text(
    """server {
    listen 18081 default_server;
    server_name _;

    client_max_body_size 4m;

    location / {
        proxy_pass http://127.0.0.1:18000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }
}
""",
    encoding="utf-8",
)
print("wrote qwen-image-ip.conf")
