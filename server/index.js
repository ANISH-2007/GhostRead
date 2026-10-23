require('dotenv').config();
const http = require('http');
const https = require('https');
const fs = require('fs');
const app = require('./app');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const USE_HTTPS = process.env.USE_HTTPS === 'true';

let server;

// HTTPS toggle: single-line environment configuration or direct toggle (SRS 3.4, 5.3)
if (USE_HTTPS && process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH) {
  const options = {
    key: fs.readFileSync(process.env.SSL_KEY_PATH),
    cert: fs.readFileSync(process.env.SSL_CERT_PATH)
  };
  server = https.createServer(options, app);
  server.listen(PORT, () => {
    console.log(`[GhostRead] Secure HTTPS server running at https://localhost:${PORT}`);
  });
} else {
  server = http.createServer(app);
  server.listen(PORT, () => {
    console.log(`[GhostRead] Server running at http://localhost:${PORT}`);
    console.log(`[GhostRead] Log in with demo@ghostread.app / demo1234 or register a new student account.`);
  });
}

module.exports = server;
