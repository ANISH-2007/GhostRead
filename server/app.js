const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const multer = require('multer');

const auth = require('./auth');
const documents = require('./documents');
const sessions = require('./sessions');
const dashboard = require('./dashboard');
const admin = require('./admin');

const app = express();

// Request body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// Plain text support for navigator.sendBeacon
app.use(express.text({ type: ['text/plain', 'application/json'], limit: '10mb' }));
app.use(cookieParser());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Public Auth routes
app.post('/api/auth/register', auth.register);
app.post('/api/auth/login', auth.login);
app.post('/api/auth/logout', auth.logout);
app.get('/api/auth/me', auth.requireAuth, auth.getMe);

// Protected Document routes (REQ-1.1 to 1.4, SRS 5.3, 5.5)
app.get('/api/documents', auth.requireAuth, documents.listDocuments);
app.post('/api/documents/upload', auth.requireAuth, documents.upload.single('pdf'), documents.handleUpload);
app.get('/api/documents/:id', auth.requireAuth, documents.getDocument);
app.get('/api/documents/:id/file', auth.requireAuth, documents.getPdfFile);
app.delete('/api/documents/:id', auth.requireAuth, documents.deleteDocument);

// Reading Session & Telemetry routes (REQ-2.1 to 2.4, REQ-3.1 to 3.4, REQ-4.1 to 4.4)
app.post('/api/sessions/start', auth.requireAuth, sessions.startSession);
app.post('/api/sessions/:id/events', sessions.recordEvents); // Also accessed by sendBeacon
app.post('/api/sessions/:id/finish', auth.requireAuth, sessions.finishSession);
app.get('/api/sessions/:id', auth.requireAuth, sessions.getSession);
app.get('/api/sessions/:id/quiz', auth.requireAuth, sessions.getQuiz);
app.post('/api/sessions/:id/quiz/submit', auth.requireAuth, sessions.submitQuiz);

// Dashboard routes (REQ-5.1 to 5.3)
app.get('/api/dashboard', auth.requireAuth, dashboard.getDashboardData);

// Admin routes (REQ-3.4, 5.4)
app.get('/api/admin/thresholds', auth.requireAdmin, admin.getThresholds);
app.put('/api/admin/thresholds', auth.requireAdmin, admin.updateThresholds);
app.get('/api/admin/health', auth.requireAdmin, admin.getSystemHealth);

// Central error handler (specifically handles Multer limits and format errors)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File size exceeds the 20 MB limit allowed by GhostRead (REQ-1.1).'
      });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }

  if (err.code === 'INVALID_FILE_TYPE') {
    return res.status(400).json({ error: err.message });
  }

  console.error('Unhandled Server Error:', err);
  return res.status(500).json({ error: err.message || 'Internal Server Error' });
});

module.exports = app;
