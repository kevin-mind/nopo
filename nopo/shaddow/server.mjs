import http from "node:http";

const PORT = Number(process.env.PORT || 8080);
const MESSAGE = process.env.SHADDOW_RESPONSE || "Hello from shaddow";

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end(`${MESSAGE}\n`);
});

server.listen(PORT, () => {
  console.log(`shaddow service listening on ${PORT}`);
});
