const { describe, it } = require('node:test');
const assert = require('node:assert');
const db = require('../server/db');
const {
  extractWords,
  extractSentences,
  generateLocalQuestionsForSection,
  generateQuizForSession,
  gradeQuizAttempt
} = require('../server/quizGenerator');

describe('Targeted Micro-Quiz Generator (REQ-4.1 to REQ-4.4, SRS 5.5)', () => {
  it('extractSentences breaks text into candidate sentences cleanly', () => {
    const text = 'Distributed consensus is fundamental to modern cloud systems. Leslie Lamport proposed the Paxos algorithm in 1998. State machine replication ensures identical ordering across replicas.';
    const sentences = extractSentences(text);
    assert.strictEqual(sentences.length, 3);
    assert.ok(sentences[0].includes('Distributed consensus'));
  });

  it('REQ-4.3: generates at least 2 questions per skimmed section drawn from its own text', () => {
    const section = {
      id: 999,
      section_number: 1,
      page_number: 1,
      extracted_text: `The Raft consensus algorithm decomposes agreement into leader election and log replication.
      Time is divided into numbered terms.
      Each term begins with an election where follower nodes transition to candidates upon timeout.
      A candidate wins by securing majority votes across the cluster.
      The leader maintains authoritative log matching invariants across all followers.`
    };
    const allWords = ['consensus', 'election', 'invariant', 'leader', 'follower', 'candidate', 'quorum', 'replica'];

    const questions = generateLocalQuestionsForSection(section, allWords);
    assert.ok(questions.length >= 2, `Expected at least 2 questions, got ${questions.length}`);
    for (const q of questions) {
      assert.ok(q.question_text.length > 10);
      assert.ok(q.correct_answer.length > 0);
      assert.strictEqual(q.options.length, 4);
      assert.ok(q.options.includes(q.correct_answer));
    }
  });

  it('REQ-4.1 & REQ-4.2: selects ONLY Skimmed sections, or skips quiz if 0 sections are skimmed', async () => {
    // Create an in-memory or test scenario in SQLite
    const userRes = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
      .run('Quiz Tester', `quiz_test_${Date.now()}@ghostread.app`, 'hash');
    const uId = userRes.lastInsertRowid;

    const docRes = db.prepare('INSERT INTO documents (user_id, title, file_name, file_path, file_size, total_pages) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uId, 'Quiz Test Doc', 'doc.pdf', '/path', 1000, 2);
    const dId = docRes.lastInsertRowid;

    const s1Res = db.prepare('INSERT INTO sections (document_id, section_number, page_number, extracted_text, word_count, line_count, estimated_read_time) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(dId, 1, 1, 'Virtual memory translation is performed by the Memory Management Unit. The TLB caches recently resolved page table entries for speed.', 22, 2, 6.0);
    const s2Res = db.prepare('INSERT INTO sections (document_id, section_number, page_number, extracted_text, word_count, line_count, estimated_read_time) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(dId, 2, 2, 'Page replacement policies include First In First Out and Least Recently Used. The working set model prevents system thrashing.', 22, 2, 6.0);

    // Scenario A: All sections Genuinely Read -> REQ-4.2 skips quiz
    const sessionResA = db.prepare('INSERT INTO reading_sessions (user_id, document_id) VALUES (?, ?)').run(uId, dId);
    const sessA = sessionResA.lastInsertRowid;

    db.prepare('INSERT INTO classifications (session_id, section_id, status, dwell_time_seconds, relative_scroll_speed, backtrack_count, explanation) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(sessA, s1Res.lastInsertRowid, 'Genuinely Read', 25.0, 0.4, 0, 'Read well');
    db.prepare('INSERT INTO classifications (session_id, section_id, status, dwell_time_seconds, relative_scroll_speed, backtrack_count, explanation) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(sessA, s2Res.lastInsertRowid, 'Genuinely Read', 30.0, 0.5, 0, 'Read well');

    const resultA = await generateQuizForSession(sessA);
    assert.strictEqual(resultA.quizRequired, false);
    assert.ok(resultA.message.includes('No sections showed skimming behavior'));

    // Scenario B: Section 1 was Skimmed, Section 2 was Read -> REQ-4.1 generates quiz ONLY for Section 1
    const sessionResB = db.prepare('INSERT INTO reading_sessions (user_id, document_id) VALUES (?, ?)').run(uId, dId);
    const sessB = sessionResB.lastInsertRowid;

    db.prepare('INSERT INTO classifications (session_id, section_id, status, dwell_time_seconds, relative_scroll_speed, backtrack_count, explanation) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(sessB, s1Res.lastInsertRowid, 'Skimmed', 2.0, 2.8, 0, 'Skimmed fast');
    db.prepare('INSERT INTO classifications (session_id, section_id, status, dwell_time_seconds, relative_scroll_speed, backtrack_count, explanation) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(sessB, s2Res.lastInsertRowid, 'Genuinely Read', 30.0, 0.5, 0, 'Read well');

    const resultB = await generateQuizForSession(sessB);
    assert.strictEqual(resultB.quizRequired, true);
    assert.strictEqual(resultB.skimmedCount, 1);
    // Verify all generated questions belong to Section 1 only!
    for (const q of resultB.questions) {
      assert.strictEqual(q.section_id, s1Res.lastInsertRowid);
    }

    // Scenario C: Grade quiz and verify REQ-4.4 upgrades Skimmed to Reinforced
    const storedQuestions = db.prepare('SELECT id, correct_answer FROM questions WHERE quiz_id = ?').all(resultB.quizId);
    const answers = storedQuestions.map(q => ({ questionId: q.id, answer: q.correct_answer }));

    const gradeResult = gradeQuizAttempt(resultB.quizId, uId, answers);
    assert.strictEqual(gradeResult.score, storedQuestions.length);
    assert.strictEqual(gradeResult.percentage, 100);
    assert.ok(gradeResult.upgradedSections.includes(Number(s1Res.lastInsertRowid)));

    // Verify classification in DB is updated to Reinforced
    const updatedClass = db.prepare('SELECT status FROM classifications WHERE session_id = ? AND section_id = ?')
      .get(sessB, s1Res.lastInsertRowid);
    assert.strictEqual(updatedClass.status, 'Reinforced');
  });

  it('SRS 5.5: throws error if attempting to quiz an unclassified session', async () => {
    const userRes = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
      .run('Unclassified Tester', `unclass_${Date.now()}@ghostread.app`, 'hash');
    const docRes = db.prepare('INSERT INTO documents (user_id, title, file_name, file_path, file_size, total_pages) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userRes.lastInsertRowid, 'Doc', 'd.pdf', '/path', 100, 1);
    const sessRes = db.prepare('INSERT INTO reading_sessions (user_id, document_id) VALUES (?, ?)')
      .run(userRes.lastInsertRowid, docRes.lastInsertRowid);

    await assert.rejects(
      async () => { await generateQuizForSession(sessRes.lastInsertRowid); },
      /has not been classified yet/
    );
  });
});
