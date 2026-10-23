const fs = require('fs');
const path = require('path');
const db = require('./db');

function loadThresholds() {
  const configPath = path.join(__dirname, '..', 'config', 'thresholds.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to read thresholds.json:', err.message);
  }
  return {
    reading_speed: { words_per_second: 3.5 },
    dwell_time: { min_dwell_fraction: 0.40, min_absolute_dwell_seconds: 2.0 },
    scroll_speed: { max_reading_speed_px_sec: 350.0, relative_speed_skim_threshold: 1.25 },
    reread: { min_backtrack_dwell_seconds: 4.0, min_passes: 2 },
    edge_cases: { min_words_for_text_page: 25, image_or_diagram_dwell_min_seconds: 3.0 }
  };
}

/**
 * Classify reading behavior for a single section.
 * Pure function suitable for deterministic unit testing.
 *
 * @param {Object} section - { id, section_number, word_count, estimated_read_time }
 * @param {Object} metrics - {
 *   dwell_time_seconds: number,
 *   scroll_speed_px_per_sec: number,
 *   relative_scroll_speed: number,
 *   backtrack_count: number,
 *   passes: number,
 *   pass_dwells: Array<number> (optional dwell per pass)
 * }
 * @param {Object} [customThresholds] - optional override of thresholds.json
 * @returns {Object} { status, dwell_time_seconds, relative_scroll_speed, backtrack_count, explanation }
 */
function classifySection(section, metrics, customThresholds) {
  const config = customThresholds || loadThresholds();
  const words = Math.max(0, section.word_count || 0);
  const dwell = Math.max(0, metrics.dwell_time_seconds || 0);
  const relSpeed = Math.max(0, metrics.relative_scroll_speed || 0);
  const scrollSpeed = Math.max(0, metrics.scroll_speed_px_per_sec || 0);
  const backtracks = Math.max(0, metrics.backtrack_count || 0);
  const passes = Math.max(1, metrics.passes || 1);
  const passDwells = metrics.pass_dwells || [];

  const wordsPerSecond = config.reading_speed?.words_per_second || 3.5;
  const minDwellFraction = config.dwell_time?.min_dwell_fraction || 0.40;
  const minAbsoluteDwell = config.dwell_time?.min_absolute_dwell_seconds || 2.0;
  const maxReadingSpeedPx = config.scroll_speed?.max_reading_speed_px_sec || 350.0;
  const relSpeedThreshold = config.scroll_speed?.relative_speed_skim_threshold || 1.25;
  const rereadMinDwell = config.reread?.min_backtrack_dwell_seconds || 4.0;
  const minWordsForText = config.edge_cases?.min_words_for_text_page || 25;
  const diagramDwellMin = config.edge_cases?.image_or_diagram_dwell_min_seconds || 3.0;

  // Expected minimum dwell time based on word count
  const expectedReadingTime = words > 0 ? words / wordsPerSecond : 1.0;
  const expectedMinDwell = Math.max(minAbsoluteDwell, expectedReadingTime * minDwellFraction);

  // EDGE CASE 1: Empty Page (0 words) or diagram/cover (< minWordsForText)
  if (words < minWordsForText) {
    if (dwell >= diagramDwellMin) {
      return {
        status: 'Genuinely Read',
        dwell_time_seconds: parseFloat(dwell.toFixed(1)),
        relative_scroll_speed: parseFloat(relSpeed.toFixed(2)),
        backtrack_count: backtracks,
        explanation: `Visual/low-text section (${words} words). Sufficient inspection dwell of ${dwell.toFixed(1)}s (>= ${diagramDwellMin}s requirement).`
      };
    } else {
      return {
        status: 'Skimmed',
        dwell_time_seconds: parseFloat(dwell.toFixed(1)),
        relative_scroll_speed: parseFloat(relSpeed.toFixed(2)),
        backtrack_count: backtracks,
        explanation: `Visual/low-text section (${words} words) passed through quickly in ${dwell.toFixed(1)}s (< ${diagramDwellMin}s expected).`
      };
    }
  }

  // REQ-3.3: Reread Classification
  // Revisited after initial pass with above-threshold dwell time on the second pass
  const secondPassDwell = passDwells.length > 1 ? passDwells.slice(1).reduce((a, b) => a + b, 0) : (passes > 1 ? dwell * 0.5 : 0);
  if ((passes > 1 || backtracks > 0) && (secondPassDwell >= rereadMinDwell || (passes > 1 && dwell >= expectedMinDwell * 1.2))) {
    return {
      status: 'Reread',
      dwell_time_seconds: parseFloat(dwell.toFixed(1)),
      relative_scroll_speed: parseFloat(relSpeed.toFixed(2)),
      backtrack_count: backtracks,
      explanation: `Revisited section across ${passes} passes with ${dwell.toFixed(1)}s cumulative dwell (revisit dwell ${secondPassDwell.toFixed(1)}s >= ${rereadMinDwell}s threshold). Deep engagement.`
    };
  }

  // REQ-3.1: Skimmed Classification
  // Relative scroll speed exceeds configurable threshold AND dwell is below expected minimum
  const isHighSpeed = relSpeed >= relSpeedThreshold || scrollSpeed > maxReadingSpeedPx;
  const isLowDwell = dwell < expectedMinDwell;

  if (isHighSpeed && isLowDwell) {
    return {
      status: 'Skimmed',
      dwell_time_seconds: parseFloat(dwell.toFixed(1)),
      relative_scroll_speed: parseFloat(relSpeed.toFixed(2)),
      backtrack_count: backtracks,
      explanation: `Dwell time of ${dwell.toFixed(1)}s was below the expected minimum of ${expectedMinDwell.toFixed(1)}s for ${words} words, and relative scroll speed (${relSpeed.toFixed(2)}x) exceeded threshold (${relSpeedThreshold}x).`
    };
  }

  // If dwell is extremely low regardless of scroll speed (e.g. jumped past)
  if (dwell < Math.min(minAbsoluteDwell, expectedMinDwell * 0.5)) {
    return {
      status: 'Skimmed',
      dwell_time_seconds: parseFloat(dwell.toFixed(1)),
      relative_scroll_speed: parseFloat(relSpeed.toFixed(2)),
      backtrack_count: backtracks,
      explanation: `Extremely brief dwell of ${dwell.toFixed(1)}s on a ${words}-word section (expected at least ${expectedMinDwell.toFixed(1)}s). Content was not absorbed.`
    };
  }

  // REQ-3.2: Genuinely Read Classification
  // Dwell time and scroll pattern fall within expected reading ranges
  return {
    status: 'Genuinely Read',
    dwell_time_seconds: parseFloat(dwell.toFixed(1)),
    relative_scroll_speed: parseFloat(relSpeed.toFixed(2)),
    backtrack_count: backtracks,
    explanation: `Dwell time of ${dwell.toFixed(1)}s met expected reading range (>= ${expectedMinDwell.toFixed(1)}s for ${words} words) at a steady relative scroll pace of ${relSpeed.toFixed(2)}x.`
  };
}

/**
 * Runs classification for an entire reading session.
 * Operates in < 3 seconds per REQ-5.1.
 *
 * @param {number} sessionId
 * @returns {Array<Object>} list of classifications
 */
function classifySession(sessionId) {
  const startTime = Date.now();

  const session = db.prepare('SELECT * FROM reading_sessions WHERE id = ?').get(sessionId);
  if (!session) {
    throw new Error(`Reading session ${sessionId} not found`);
  }

  // Get all sections for this document
  const sections = db.prepare(`
    SELECT * FROM sections WHERE document_id = ? ORDER BY section_number ASC
  `).all(session.document_id);

  // Get all events recorded for this session
  const events = db.prepare(`
    SELECT * FROM reading_events WHERE session_id = ? ORDER BY created_at ASC
  `).all(sessionId);

  // Group events by section_id
  const eventsBySection = {};
  for (const ev of events) {
    if (!eventsBySection[ev.section_id]) {
      eventsBySection[ev.section_id] = [];
    }
    eventsBySection[ev.section_id].push(ev);
  }

  const deleteExisting = db.prepare('DELETE FROM classifications WHERE session_id = ?');
  const insertClassification = db.prepare(`
    INSERT INTO classifications (session_id, section_id, status, dwell_time_seconds, relative_scroll_speed, backtrack_count, explanation)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const classifications = [];

  db.transaction(() => {
    deleteExisting.run(sessionId);

    for (const section of sections) {
      const sectionEvents = eventsBySection[section.id] || [];

      // Aggregate telemetry
      let totalDwellMs = 0;
      let totalScrollSpeed = 0;
      let totalRelSpeed = 0;
      let maxBacktracks = 0;
      let maxPass = 1;
      const passDwellsMap = {};

      for (const ev of sectionEvents) {
        totalDwellMs += (ev.dwell_time_ms || 0);
        totalScrollSpeed += (ev.scroll_speed_px_per_sec || 0);
        totalRelSpeed += (ev.relative_scroll_speed || 0);
        if (ev.backtrack_count > maxBacktracks) maxBacktracks = ev.backtrack_count;
        if (ev.pass_number > maxPass) maxPass = ev.pass_number;

        const p = ev.pass_number || 1;
        passDwellsMap[p] = (passDwellsMap[p] || 0) + ((ev.dwell_time_ms || 0) / 1000.0);
      }

      const count = sectionEvents.length || 1;
      const dwellSeconds = totalDwellMs / 1000.0;
      const avgRelSpeed = sectionEvents.length > 0 ? (totalRelSpeed / count) : 0;
      const avgScrollSpeed = sectionEvents.length > 0 ? (totalScrollSpeed / count) : 0;
      const passDwells = Object.keys(passDwellsMap).map(k => passDwellsMap[k]);

      const result = classifySection(section, {
        dwell_time_seconds: dwellSeconds,
        scroll_speed_px_per_sec: avgScrollSpeed,
        relative_scroll_speed: avgRelSpeed,
        backtrack_count: maxBacktracks,
        passes: maxPass,
        pass_dwells: passDwells
      });

      insertClassification.run(
        sessionId,
        section.id,
        result.status,
        result.dwell_time_seconds,
        result.relative_scroll_speed,
        result.backtrack_count,
        result.explanation
      );

      classifications.push({
        section_id: section.id,
        section_number: section.section_number,
        page_number: section.page_number,
        word_count: section.word_count,
        ...result
      });
    }

    // Mark session as completed
    db.prepare('UPDATE reading_sessions SET status = ?, end_time = CURRENT_TIMESTAMP WHERE id = ?')
      .run('completed', sessionId);
  })();

  const elapsedMs = Date.now() - startTime;
  if (elapsedMs > 3000) {
    console.warn(`Classification took ${elapsedMs}ms (> 3000ms target)`);
  }

  return classifications;
}

module.exports = {
  loadThresholds,
  classifySection,
  classifySession
};
