// Local Basic-auth server for manual testing: node test/server.js
// Credentials: user / secret
const http = require("http");
const PORT = 8765;
const expected = "Basic " + Buffer.from("user:secret").toString("base64");

http
  .createServer((req, res) => {
    if (req.headers.authorization === expected) {
      res.end("Authenticated!\n");
      return;
    }
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="test"' });
    res.end("Unauthorized\n");
  })
  .listen(PORT, () => console.log(`http://localhost:${PORT} (user / secret)`));
