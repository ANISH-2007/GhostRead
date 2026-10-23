const db = require('./db');

/**
 * Returns dashboard overview for student:
 * - Summary stats: total documents, total reading sessions, total dwell time, average quiz score.
 * - Per-document heatmap data for the student's latest reading session on each document.
 * - Multi-document trends (REQ-5.2) over time:
 *   chronological list of reading sessions showing breakdown of Skimmed, Genuinely Read, Reread, Reinforced.
 * Performance: Optimized with indices to load < 2s for 50+ sections (REQ-5.3).
 */
function getDashboardData(req, res) {
  const startTime = Date.now();
  const userId = req.user.id;

  // 1. Overview counts
  const docCount = db.prepare('SELECT COUNT(*) as count FROM documents WHERE user_id = ?').get(userId).count;
  const sessionCount = db.prepare('SELECT COUNT(*) as count FROM reading_sessions WHERE user_id = ? AND status != ?').get(userId, 'in_progress').count;
  
  const quizStats = db.prepare(`
    SELECT AVG(score * 1.0 / total_questions) as avg_score, COUNT(*) as attempts
    FROM quiz_attempts
    WHERE user_id = ?
  `).get(userId);

  // 2. Per-document latest session comprehension heatmaps (REQ-5.1)
  const docs = db.prepare(`
    SELECT d.id, d.title, d.total_pages, d.upload_date,
      (SELECT rs.id FROM reading_sessions rs WHERE rs.document_id = d.id AND rs.user_id = ? AND rs.status != 'in_progress' ORDER BY rs.id DESC LIMIT 1) as latest_session_id
    FROM documents d
    WHERE d.user_id = ?
    ORDER BY d.upload_date DESC
  `).all(userId, userId);

  const documentHeatmaps = [];

  for (const doc of docs) {
    if (!doc.latest_session_id) {
      // Document uploaded but not read yet
      const sections = db.prepare(`
        SELECT id, section_number, page_number, word_count, estimated_read_time
        FROM sections
        WHERE document_id = ?
        ORDER BY section_number ASC
      `).all(doc.id);

      documentHeatmaps.push({
        documentId: doc.id,
        title: doc.title,
        totalPages: doc.total_pages,
        sessionId: null,
        status: 'Unread',
        sections: sections.map(s => ({
          sectionId: s.id,
          sectionNumber: s.section_number,
          pageNumber: s.page_number,
          wordCount: s.word_count,
          estimatedReadTime: s.estimated_read_time,
          status: 'Unread',
          dwellTimeSeconds: 0,
          relativeScrollSpeed: 0,
          backtrackCount: 0,
          explanation: 'Not yet read.'
        }))
      });
      continue;
    }

    // Latest session sections with classification
    const classifications = db.prepare(`
      SELECT s.id as sectionId, s.section_number as sectionNumber, s.page_number as pageNumber,
             s.word_count as wordCount, s.estimated_read_time as estimatedReadTime,
             c.status, c.dwell_time_seconds as dwellTimeSeconds,
             c.relative_scroll_speed as relativeScrollSpeed,
             c.backtrack_count as backtrackCount,
             c.explanation
      FROM sections s
      LEFT JOIN classifications c ON c.section_id = s.id AND c.session_id = ?
      WHERE s.document_id = ?
      ORDER BY s.section_number ASC
    `).all(doc.latest_session_id, doc.id);

    // Summary of statuses
    let skimmed = 0, genuinelyRead = 0, reread = 0, reinforced = 0;
    for (const c of classifications) {
      if (c.status === 'Skimmed') skimmed++;
      else if (c.status === 'Genuinely Read') genuinelyRead++;
      else if (c.status === 'Reread') reread++;
      else if (c.status === 'Reinforced') reinforced++;
    }

    documentHeatmaps.push({
      documentId: doc.id,
      title: doc.title,
      totalPages: doc.total_pages,
      sessionId: doc.latest_session_id,
      status: 'Completed',
      counts: { skimmed, genuinelyRead, reread, reinforced, total: classifications.length },
      sections: classifications
    });
  }

  // 3. Multi-document trend history (REQ-5.2)
  const sessionTrends = db.prepare(`
    SELECT rs.id as session_id, rs.document_id, d.title as document_title, rs.start_time, rs.end_time,
      COUNT(c.id) as total_classified,
      SUM(CASE WHEN c.status = 'Skimmed' THEN 1 ELSE 0 END) as skimmed_count,
      SUM(CASE WHEN c.status = 'Genuinely Read' THEN 1 ELSE 0 END) as read_count,
      SUM(CASE WHEN c.status = 'Reread' THEN 1 ELSE 0 END) as reread_count,
      SUM(CASE WHEN c.status = 'Reinforced' THEN 1 ELSE 0 END) as reinforced_count,
      AVG(c.dwell_time_seconds) as avg_dwell,
      AVG(c.relative_scroll_speed) as avg_speed
    FROM reading_sessions rs
    JOIN documents d ON d.id = rs.document_id
    JOIN classifications c ON c.session_id = rs.id
    WHERE rs.user_id = ?
    GROUP BY rs.id
    ORDER BY rs.start_time ASC
  `).all(userId);

  const elapsedMs = Date.now() - startTime;
  if (elapsedMs > 2000) {
    console.warn(`Dashboard query took ${elapsedMs}ms (> 2000ms target)`);
  }

  return res.json({
    summary: {
      totalDocuments: docCount,
      totalSessions: sessionCount,
      averageQuizScore: quizStats.avg_score !== null ? Math.round(quizStats.avg_score * 100) : null,
      quizAttempts: quizStats.attempts
    },
    documentHeatmaps,
    sessionTrends,
    loadTimeMs: elapsedMs
  });
}

module.exports = {
  getDashboardData
};
