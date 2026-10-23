const db = require('./db');
const { classifySession } = require('./classifier');
const { generateQuizForSession, gradeQuizAttempt } = require('./quizGenerator');

// Start a new reading session
function startSession(req, res) {
  const userId = req.user.id;
  const { documentId } = req.body;

  if (!documentId) {
    return res.status(400).json({ error: 'documentId is required' });
  }

  // Ensure document belongs to user (SRS 5.3, 5.5)
  const doc = db.prepare('SELECT id FROM documents WHERE id = ? AND user_id = ?').get(documentId, userId);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found or access denied.' });
  }

  const insert = db.prepare(`
    INSERT INTO reading_sessions (user_id, document_id) VALUES (?, ?)
  `);
  const info = insert.run(userId, documentId);

  return res.status(201).json({
    sessionId: info.lastInsertRowid,
    documentId,
    message: 'Reading session started'
  });
}

// Record batched reading telemetry events (REQ-2.1, 2.2, 2.3, 2.4, 5.1)
function recordEvents(req, res) {
  const sessionId = req.params.id;
  let events = req.body.events;

  // Handle case where sendBeacon sends raw text or direct array
  if (!events) {
    if (Array.isArray(req.body)) {
      events = req.body;
    } else if (typeof req.body === 'string') {
      try {
        const parsed = JSON.parse(req.body);
        events = parsed.events || (Array.isArray(parsed) ? parsed : [parsed]);
      } catch (_) {
        events = [];
      }
    } else if (req.body.sectionId) {
      events = [req.body];
    }
  }

  if (!events || !Array.isArray(events) || events.length === 0) {
    return res.json({ received: 0 });
  }

  const insertEvent = db.prepare(`
    INSERT INTO reading_events (session_id, section_id, dwell_time_ms, scroll_speed_px_per_sec, relative_scroll_speed, backtrack_count, pass_number)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  // SRS 5.4: Reliability - A failure on one event/section shall not affect others
  for (const ev of events) {
    try {
      if (ev.sectionId && ev.dwellTimeMs >= 0) {
        insertEvent.run(
          sessionId,
          ev.sectionId,
          Math.round(ev.dwellTimeMs),
          parseFloat(ev.scrollSpeedPxPerSec || 0),
          parseFloat(ev.relativeScrollSpeed || 0),
          parseInt(ev.backtrackCount || 0, 10),
          parseInt(ev.passNumber || 1, 10)
        );
        count++;
      }
    } catch (err) {
      console.error(`Failed to record event for section ${ev.sectionId}:`, err.message);
    }
  }

  return res.json({ received: count });
}

// Finish reading session, run classifier, and prepare quiz if needed
async function finishSession(req, res) {
  const userId = req.user.id;
  const sessionId = req.params.id;

  const session = db.prepare('SELECT * FROM reading_sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
  if (!session) {
    return res.status(404).json({ error: 'Reading session not found.' });
  }

  try {
    // Increment 2: Run classifier (< 3s)
    const classifications = classifySession(sessionId);

    // Increment 3: Check if quiz is needed (< 5s)
    const quizResult = await generateQuizForSession(sessionId);

    const skimmedCount = classifications.filter(c => c.status === 'Skimmed').length;
    const readCount = classifications.filter(c => c.status === 'Genuinely Read').length;
    const rereadCount = classifications.filter(c => c.status === 'Reread').length;

    return res.json({
      sessionId: parseInt(sessionId, 10),
      documentId: session.document_id,
      summary: {
        totalSections: classifications.length,
        skimmed: skimmedCount,
        genuinelyRead: readCount,
        reread: rereadCount
      },
      classifications,
      quizRequired: quizResult.quizRequired,
      quizId: quizResult.quizId || null,
      message: quizResult.quizRequired
        ? `Found ${skimmedCount} skimmed section(s). Targeted micro-quiz is ready.`
        : quizResult.message
    });
  } catch (err) {
    console.error('Error finishing session:', err);
    return res.status(500).json({ error: 'Failed to process session completion: ' + err.message });
  }
}

// Get session details with classifications
function getSession(req, res) {
  const userId = req.user.id;
  const sessionId = req.params.id;

  const session = db.prepare(`
    SELECT rs.*, d.title as document_title
    FROM reading_sessions rs
    JOIN documents d ON d.id = rs.document_id
    WHERE rs.id = ? AND rs.user_id = ?
  `).get(sessionId, userId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  const classifications = db.prepare(`
    SELECT c.*, s.section_number, s.page_number, s.word_count, s.estimated_read_time
    FROM classifications c
    JOIN sections s ON s.id = c.section_id
    WHERE c.session_id = ?
    ORDER BY s.section_number ASC
  `).all(sessionId);

  const quiz = db.prepare('SELECT id FROM quizzes WHERE session_id = ?').get(sessionId);

  return res.json({ session, classifications, quizId: quiz ? quiz.id : null });
}

// Get quiz questions for a session
function getQuiz(req, res) {
  const userId = req.user.id;
  const sessionId = req.params.id;

  const session = db.prepare('SELECT * FROM reading_sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or access denied.' });
  }

  const quiz = db.prepare('SELECT * FROM quizzes WHERE session_id = ?').get(sessionId);
  if (!quiz) {
    return res.status(404).json({ error: 'No quiz found for this reading session.' });
  }

  const questions = db.prepare(`
    SELECT q.id, q.section_id, q.question_text, q.question_type, q.options_json,
           s.section_number, s.page_number
    FROM questions q
    JOIN sections s ON s.id = q.section_id
    WHERE q.quiz_id = ?
    ORDER BY s.section_number ASC, q.id ASC
  `).all(quiz.id);

  const parsedQuestions = questions.map(q => ({
    id: q.id,
    section_id: q.section_id,
    section_number: q.section_number,
    page_number: q.page_number,
    question_text: q.question_text,
    question_type: q.question_type,
    options: JSON.parse(q.options_json)
  }));

  return res.json({
    quizId: quiz.id,
    sessionId: parseInt(sessionId, 10),
    questions: parsedQuestions
  });
}

// Submit quiz answers
function submitQuiz(req, res) {
  const userId = req.user.id;
  const sessionId = req.params.id;
  const { responses } = req.body;

  if (!responses || !Array.isArray(responses)) {
    return res.status(400).json({ error: 'responses array is required' });
  }

  const session = db.prepare('SELECT * FROM reading_sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  const quiz = db.prepare('SELECT id FROM quizzes WHERE session_id = ?').get(sessionId);
  if (!quiz) {
    return res.status(404).json({ error: 'Quiz not found.' });
  }

  try {
    const result = gradeQuizAttempt(quiz.id, userId, responses);
    return res.json({
      message: 'Quiz submitted and graded.',
      ...result
    });
  } catch (err) {
    console.error('Error grading quiz:', err);
    return res.status(500).json({ error: 'Failed to grade quiz: ' + err.message });
  }
}

module.exports = {
  startSession,
  recordEvents,
  finishSession,
  getSession,
  getQuiz,
  submitQuiz
};
