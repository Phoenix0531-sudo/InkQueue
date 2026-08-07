# TLS dev certs (do not commit — gitignored)

生成自签证书用于本地 HTTPS 启动验证：

```bash
mkdir -p server/data/tls
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout server/data/tls/key.pem \
  -out server/data/tls/cert.pem \
  -days 365 \
  -subj "/CN=inkqueue.local" \
  -addext "subjectAltName=IP:127.0.0.1,DNS:localhost,DNS:inkqueue.local"
```

启动 HTTPS server：

```bash
INKQUEUE_PORT=18787 \
INKQUEUE_TLS_KEY=server/data/tls/key.pem \
INKQUEUE_TLS_CERT=server/data/tls/cert.pem \
INKQUEUE_DATA_FILE=server/data/tls-tasks.json \
node server/src/server.js
```

验证：

```bash
curl -sk https://localhost:18787/v1/health   # {"ok":true}
curl -sk https://localhost:18787/v1/tasks/snapshot -H "X-InkQueue-Token: dev-token"
```

`curl -k` 跳过证书校验仅用于本地开发。Android 4.4 真机需要把 `cert.pem` 导入系统信任 CA（root 设备）。详见 `docs/development.md`。
