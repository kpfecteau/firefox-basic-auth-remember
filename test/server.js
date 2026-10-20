// Local Basic-auth server for manual and e2e testing: node test/server.js
// Credentials: user / secret. /hop?to=HOST redirects (once authenticated) to
// http://HOST:8765/, which challenges again because it's a different host.
const http = require("http");
const PORT = 8765;
const expected = "Basic " + Buffer.from("user:secret").toString("base64");

http
  .createServer((req, res) => {
    if (req.headers.authorization !== expected) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="test"' });
      res.end("Unauthorized\n");
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/hop") {
      res.writeHead(302, { Location: `http://${url.searchParams.get("to")}:${PORT}/` });
      res.end();
      return;
    }
    res.end("Authenticated!\n");
  })
  .listen(PORT, () => console.log(`http://localhost:${PORT} (user / secret)`));
