const assert = require('assert');
const app = require('../server/app');
const http = require('http');

let server;
let baseUrl;

async function startServer() {
  return new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`[E2E] Verification test server running on ${baseUrl}`);
      resolve();
    });
  });
}

async function runE2E() {
  await startServer();

  try {
    console.log('[E2E] 1. Testing Student Login...');
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@ghostread.app', password: 'demo1234' })
    });
    const loginData = await loginRes.json();
    assert.strictEqual(loginRes.status, 200);
    assert.ok(loginData.token);
    assert.strictEqual(loginData.user.email, 'demo@ghostread.app');
    const token = loginData.token;
    console.log('   ✓ Student login successful');

    console.log('[E2E] 2. Testing Document Listing & Metadata...');
    const docsRes = await fetch(`${baseUrl}/api/documents`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const docsData = await docsRes.json();
    assert.strictEqual(docsRes.status, 200);
    assert.ok(docsData.documents.length >= 3, 'Should have at least 3 documents');
    const targetDoc = docsData.documents.find(d => d.total_pages === 4) || docsData.documents[0];
    console.log(`   ✓ Found ${docsData.documents.length} documents. Target: "${targetDoc.title}" (${targetDoc.total_pages} pages)`);

    console.log('[E2E] 3. Fetching Document Sections...');
    const docDetailRes = await fetch(`${baseUrl}/api/documents/${targetDoc.id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const docDetail = await docDetailRes.json();
    assert.strictEqual(docDetailRes.status, 200);
    assert.strictEqual(docDetail.sections.length, targetDoc.total_pages);
    console.log(`   ✓ Retrieved ${docDetail.sections.length} sections for reading view`);

    console.log('[E2E] 4. Starting a New Reading Session...');
    const sessionRes = await fetch(`${baseUrl}/api/sessions/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ documentId: targetDoc.id })
    });
    const sessionData = await sessionRes.json();
    assert.strictEqual(sessionRes.status, 201);
    const sessionId = sessionData.sessionId;
    console.log(`   ✓ Session started with ID: ${sessionId}`);

    console.log('[E2E] 5. Simulating Telemetry Event Streaming (Fast Scroll vs Slow Read)...');
    const s1 = docDetail.sections[0];
    const s2 = docDetail.sections[1];
    const s3 = docDetail.sections[2];
    const s4 = docDetail.sections[3];

    // Simulate events:
    // s1: Fast scroll (skimmed) -> 2.5s dwell, 650 px/s, 2.6x relSpeed
    // s2: Slow thorough read -> 42.0s dwell, 110 px/s, 0.45x relSpeed
    // s3: Backtrack revisit (reread) -> pass 1: 20s, pass 2: 25s, backtrack 1
    // s4: Normal read -> 38.0s dwell, 120 px/s, 0.50x relSpeed
    const telemetryEvents = [
      {
        sectionId: s1.id,
        dwellTimeMs: 2500,
        scrollSpeedPxPerSec: 650.0,
        relativeScrollSpeed: 2.6,
        backtrackCount: 0,
        passNumber: 1
      },
      {
        sectionId: s2.id,
        dwellTimeMs: 42000,
        scrollSpeedPxPerSec: 110.0,
        relativeScrollSpeed: 0.45,
        backtrackCount: 0,
        passNumber: 1
      },
      {
        sectionId: s3.id,
        dwellTimeMs: 20000,
        scrollSpeedPxPerSec: 140.0,
        relativeScrollSpeed: 0.55,
        backtrackCount: 0,
        passNumber: 1
      },
      {
        sectionId: s3.id,
        dwellTimeMs: 25000,
        scrollSpeedPxPerSec: 90.0,
        relativeScrollSpeed: 0.38,
        backtrackCount: 1,
        passNumber: 2
      },
      {
        sectionId: s4.id,
        dwellTimeMs: 38000,
        scrollSpeedPxPerSec: 120.0,
        relativeScrollSpeed: 0.50,
        backtrackCount: 0,
        passNumber: 1
      }
    ];

    const eventPostRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ events: telemetryEvents })
    });
    const eventPostData = await eventPostRes.json();
    assert.strictEqual(eventPostData.received, telemetryEvents.length);
    console.log(`   ✓ Telemetry batch of ${telemetryEvents.length} events recorded successfully`);

    console.log('[E2E] 6. Finishing Session & Running Classifier Engine (< 3s)...');
    const finishStart = Date.now();
    const finishRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/finish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    const finishDuration = Date.now() - finishStart;
    const finishData = await finishRes.json();
    assert.strictEqual(finishRes.status, 200);
    assert.ok(finishDuration < 3000, `Finish took ${finishDuration}ms, must be < 3000ms`);

    console.log(`   ✓ Classification completed in ${finishDuration}ms:`);
    console.log(`     - Skimmed: ${finishData.summary.skimmed}`);
    console.log(`     - Genuinely Read: ${finishData.summary.genuinelyRead}`);
    console.log(`     - Reread: ${finishData.summary.reread}`);

    const c1 = finishData.classifications.find(c => c.section_id === s1.id);
    const c2 = finishData.classifications.find(c => c.section_id === s2.id);
    const c3 = finishData.classifications.find(c => c.section_id === s3.id);

    assert.strictEqual(c1.status, 'Skimmed', 'Section 1 should be classified as Skimmed');
    assert.strictEqual(c2.status, 'Genuinely Read', 'Section 2 should be classified as Genuinely Read');
    assert.strictEqual(c3.status, 'Reread', 'Section 3 should be classified as Reread');
    assert.ok(finishData.quizRequired, 'Quiz should be required because Section 1 was Skimmed');
    console.log('   ✓ All 3 section classes matched expected heuristic outcomes with explanations');

    console.log('[E2E] 7. Fetching Targeted Micro-Quiz (ONLY Skimmed Sections, REQ-4.1)...');
    const quizRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/quiz`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const quizData = await quizRes.json();
    assert.strictEqual(quizRes.status, 200);
    assert.ok(quizData.questions.length >= 2, 'Should have at least 2 questions for Section 1');
    for (const q of quizData.questions) {
      assert.strictEqual(q.section_id, s1.id, 'Every question must strictly belong to Section 1');
    }
    console.log(`   ✓ Retrieved ${quizData.questions.length} questions, all strictly targeting Section 1`);

    console.log('[E2E] 8. Submitting Quiz & Upgrading Section to Reinforced (REQ-4.4)...');
    // Get correct answers directly from DB to simulate 100% correct student attempt
    const db = require('../server/db');
    const storedQs = db.prepare('SELECT id, correct_answer FROM questions WHERE quiz_id = ?').all(quizData.quizId);
    const responses = storedQs.map(q => ({ questionId: q.id, answer: q.correct_answer }));

    const submitRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/quiz/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ responses })
    });
    const submitData = await submitRes.json();
    assert.strictEqual(submitRes.status, 200);
    assert.strictEqual(submitData.percentage, 100);
    assert.ok(submitData.upgradedSections.includes(s1.id));
    console.log('   ✓ Quiz passed with 100%! Section 1 successfully upgraded from Skimmed to Reinforced');

    console.log('[E2E] 9. Verifying Comprehension Dashboard (< 2s load time, REQ-5.1..5.3)...');
    const dashStart = Date.now();
    const dashRes = await fetch(`${baseUrl}/api/dashboard`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const dashDuration = Date.now() - dashStart;
    const dashData = await dashRes.json();
    assert.strictEqual(dashRes.status, 200);
    assert.ok(dashDuration < 2000, `Dashboard took ${dashDuration}ms, must be < 2000ms`);

    const latestDocHeatmap = dashData.documentHeatmaps.find(d => d.documentId === targetDoc.id);
    const heatSec1 = latestDocHeatmap.sections.find(s => s.sectionId === s1.id);
    assert.strictEqual(heatSec1.status, 'Reinforced', 'Heatmap must reflect Reinforced status');
    assert.ok(dashData.sessionTrends.length >= 3, 'Multi-document trend history must be present');
    console.log(`   ✓ Dashboard loaded in ${dashDuration}ms with verified Reinforced heatmap block & trend charts`);

    console.log('[E2E] 10. Verifying Admin Thresholds & Health Metrics (REQ-3.4, REQ-5.4)...');
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@ghostread.app', password: 'admin1234' })
    });
    const adminToken = (await adminLoginRes.json()).token;

    const healthRes = await fetch(`${baseUrl}/api/admin/health`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const healthData = await healthRes.json();
    assert.strictEqual(healthRes.status, 200);
    assert.ok(healthData.metrics.readingEvents > 0);

    const configRes = await fetch(`${baseUrl}/api/admin/thresholds`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const configData = await configRes.json();
    assert.strictEqual(configRes.status, 200);
    assert.strictEqual(typeof configData.config.reading_speed.words_per_second, 'number');
    console.log('   ✓ Admin health and thresholds APIs verified successfully');

    console.log('\n========================================');
    console.log('🎉 ALL 10 END-TO-END VERIFICATION CHECKS PASSED!');
    console.log('========================================\n');

  } finally {
    server.close();
  }
}

runE2E().catch(err => {
  console.error('[E2E Error]:', err);
  if (server) server.close();
  process.exit(1);
});
