const fs = require('fs');
const path = require('path');
const db = require('./db');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'thresholds.json');

function getThresholds(req, res) {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return res.status(404).json({ error: 'thresholds.json not found' });
    }
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return res.json({ config: data });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read thresholds: ' + err.message });
  }
}

function updateThresholds(req, res) {
  try {
    const { config } = req.body;
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ error: 'Invalid configuration payload' });
    }

    // Validate key fields
    if (config.reading_speed && typeof config.reading_speed.words_per_second !== 'number') {
      return res.status(400).json({ error: 'words_per_second must be a number' });
    }

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    return res.json({ message: 'Thresholds updated successfully', config });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update thresholds: ' + err.message });
  }
}

function getSystemHealth(req, res) {
  const usersCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const docsCount = db.prepare('SELECT COUNT(*) as count FROM documents').get().count;
  const sessionsCount = db.prepare('SELECT COUNT(*) as count FROM reading_sessions').get().count;
  const eventsCount = db.prepare('SELECT COUNT(*) as count FROM reading_events').get().count;
  const questionsCount = db.prepare('SELECT COUNT(*) as count FROM questions').get().count;

  return res.json({
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    metrics: {
      users: usersCount,
      documents: docsCount,
      sessions: sessionsCount,
      readingEvents: eventsCount,
      questionsGenerated: questionsCount
    }
  });
}

module.exports = {
  getThresholds,
  updateThresholds,
  getSystemHealth
};
