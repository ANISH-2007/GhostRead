const db = require('./db');

/**
 * Local offline question generator.
 * Builds cloze and multiple-choice questions from key sentences in section text.
 * Pulls distractors from other sections in the document.
 */

// Common English stopwords to ignore when selecting blanked keywords
const STOPWORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'and', 'a', 'an', 'in', 'to', 'for', 'of', 'with', 'by', 'from',
  'that', 'this', 'these', 'those', 'as', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'do', 'does', 'did', 'but', 'if', 'or', 'because', 'until', 'while', 'about', 'against',
  'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'under', 'again',
  'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same',
  'so', 'than', 'too', 'very', 'can', 'will', 'just', 'should', 'now', 'page', 'also', 'its'
]);

function extractWords(text) {
  if (!text) return [];
  return text
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 3 && !STOPWORDS.has(w.toLowerCase()));
}

function extractSentences(text) {
  if (!text) return [];
  // Clean newlines that break mid-sentence
  const clean = text.replace(/([a-z0-9,;])\n([a-z])/gi, '$1 $2').replace(/\r/g, ' ');
  return clean
    .split(/(?<=[.?!])\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 25 && s.length <= 250 && s.split(/\s+/).length >= 6);
}

function generateLocalQuestionsForSection(section, allDocWords) {
  const sentences = extractSentences(section.extracted_text);
  const questions = [];

  // Need at least 2 questions per skimmed section (REQ-4.3)
  if (sentences.length === 0) {
    // Fallback if sentences couldn't be parsed (e.g. bullet points or tables)
    const rawWords = extractWords(section.extracted_text);
    if (rawWords.length >= 2) {
      const w1 = rawWords[0];
      const w2 = rawWords[Math.floor(rawWords.length / 2)];
      const distractors1 = selectDistractors(w1, allDocWords, 3);
      const distractors2 = selectDistractors(w2, allDocWords, 3);

      questions.push({
        question_text: `According to Section ${section.section_number}, which of the following terms is a central topic discussed?`,
        question_type: 'mcq',
        correct_answer: w1,
        options: shuffleArray([w1, ...distractors1])
      });
      questions.push({
        question_type: 'mcq',
        question_text: `Which key concept from Section ${section.section_number} was covered in this material?`,
        correct_answer: w2,
        options: shuffleArray([w2, ...distractors2])
      });
      return questions;
    }
    return [];
  }

  // Shuffle sentences to pick diverse questions
  const shuffledSentences = shuffleArray([...sentences]);

  for (let i = 0; i < shuffledSentences.length && questions.length < 2; i++) {
    const sentence = shuffledSentences[i];
    const words = extractWords(sentence);
    if (words.length === 0) continue;

    // Prioritize technical terms, capitalized terms, or longer words
    const candidateWords = words.sort((a, b) => {
      const aScore = (a[0] === a[0].toUpperCase() ? 2 : 0) + a.length;
      const bScore = (b[0] === b[0].toUpperCase() ? 2 : 0) + b.length;
      return bScore - aScore;
    });

    const targetWord = candidateWords[0];
    const regex = new RegExp(`\\b${escapeRegExp(targetWord)}\\b`, 'i');
    const blankedSentence = sentence.replace(regex, '_______');

    const distractors = selectDistractors(targetWord, allDocWords, 3);
    const options = shuffleArray([targetWord, ...distractors]);

    questions.push({
      question_text: `Complete the sentence from Section ${section.section_number} (Page ${section.page_number}): "${blankedSentence}"`,
      question_type: 'cloze_mcq',
      correct_answer: targetWord,
      options: options
    });
  }

  // If only 1 question was generated, create another one
  if (questions.length === 1 && sentences.length > 0) {
    const sentence = sentences[0];
    const words = extractWords(sentence).filter(w => w.toLowerCase() !== questions[0].correct_answer.toLowerCase());
    if (words.length > 0) {
      const targetWord = words[words.length - 1];
      const distractors = selectDistractors(targetWord, allDocWords, 3);
      questions.push({
        question_text: `In Section ${section.section_number}, what term completes: "${sentence.replace(new RegExp(`\\b${escapeRegExp(targetWord)}\\b`, 'i'), '_______')}"?`,
        question_type: 'cloze_mcq',
        correct_answer: targetWord,
        options: shuffleArray([targetWord, ...distractors])
      });
    }
  }

  return questions;
}

function selectDistractors(correctWord, pool, count = 3) {
  const filtered = pool.filter(w => w.toLowerCase() !== correctWord.toLowerCase() && Math.abs(w.length - correctWord.length) <= 5);
  const unique = Array.from(new Set(filtered));
  const shuffled = shuffleArray(unique);
  const result = shuffled.slice(0, count);

  // If not enough unique words in pool, fill with default academic terminology
  const defaultFillers = ['Protocol', 'Latency', 'Consensus', 'Throughput', 'Bandwidth', 'Cache', 'Partition', 'Algorithm'];
  let idx = 0;
  while (result.length < count && idx < defaultFillers.length) {
    const filler = defaultFillers[idx++];
    if (filler.toLowerCase() !== correctWord.toLowerCase() && !result.includes(filler)) {
      result.push(filler);
    }
  }
  return result;
}

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generate targeted micro-quiz for a reading session.
 * REQ-4.1: Select ONLY sections classified as Skimmed.
 * REQ-4.2: If no sections are Skimmed, skip quiz generation.
 * REQ-4.3: At least 2 questions per skimmed section drawn from its text.
 * REQ-5.5: Never quiz an unclassified section.
 *
 * @param {number} sessionId
 * @returns {Promise<Object>} { quizRequired: boolean, quizId?: number, message?: string, questions?: Array }
 */
async function generateQuizForSession(sessionId) {
  const startTime = Date.now();

  const session = db.prepare('SELECT * FROM reading_sessions WHERE id = ?').get(sessionId);
  if (!session) {
    throw new Error(`Reading session ${sessionId} not found`);
  }

  // REQ-5.5: Check classification exists
  const classifications = db.prepare(`
    SELECT c.*, s.section_number, s.page_number, s.extracted_text, s.word_count
    FROM classifications c
    JOIN sections s ON s.id = c.section_id
    WHERE c.session_id = ?
    ORDER BY s.section_number ASC
  `).all(sessionId);

  if (classifications.length === 0) {
    throw new Error('Reading session has not been classified yet.');
  }

  // REQ-4.1: Select ONLY sections classified as Skimmed
  const skimmedSections = classifications.filter(c => c.status === 'Skimmed');

  // REQ-4.2: If no sections are classified as Skimmed, skip quiz generation
  if (skimmedSections.length === 0) {
    return {
      quizRequired: false,
      message: 'You read everything thoroughly! No sections showed skimming behavior, so no quiz is needed.'
    };
  }

  // Collect pool of words across the whole document for realistic distractors
  const allDocSections = db.prepare('SELECT extracted_text FROM sections WHERE document_id = ?').all(session.document_id);
  const allDocWords = [];
  for (const docSec of allDocSections) {
    allDocWords.push(...extractWords(docSec.extracted_text));
  }

  // Generate quiz record
  let quizId;
  const generatedQuestions = [];

  db.transaction(() => {
    // Delete any previous quiz for this session to keep it clean
    db.prepare('DELETE FROM quizzes WHERE session_id = ?').run(sessionId);

    const insertQuiz = db.prepare('INSERT INTO quizzes (session_id, document_id) VALUES (?, ?)');
    const quizResult = insertQuiz.run(sessionId, session.document_id);
    quizId = quizResult.lastInsertRowid;

    const insertQuestion = db.prepare(`
      INSERT INTO questions (quiz_id, section_id, question_text, question_type, correct_answer, options_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const sec of skimmedSections) {
      // REQ-4.3: Generate at least 2 questions per skimmed section from its text
      const questionsForSec = generateLocalQuestionsForSection(sec, allDocWords);
      for (const q of questionsForSec) {
        const qResult = insertQuestion.run(
          quizId,
          sec.section_id,
          q.question_text,
          q.question_type,
          q.correct_answer,
          JSON.stringify(q.options)
        );

        generatedQuestions.push({
          id: qResult.lastInsertRowid,
          section_id: sec.section_id,
          section_number: sec.section_number,
          page_number: sec.page_number,
          question_text: q.question_text,
          question_type: q.question_type,
          options: q.options
          // Do not send correct_answer to client during quiz take!
        });
      }
    }
  })();

  const elapsedMs = Date.now() - startTime;
  if (elapsedMs > 5000) {
    console.warn(`Quiz generation took ${elapsedMs}ms (> 5000ms target)`);
  }

  return {
    quizRequired: true,
    quizId,
    skimmedCount: skimmedSections.length,
    totalQuestions: generatedQuestions.length,
    questions: generatedQuestions
  };
}

/**
 * Submits quiz answers, grades them immediately, and updates comprehension signal (REQ-4.4).
 *
 * @param {number} quizId
 * @param {number} userId
 * @param {Array<{ questionId: number, answer: string }>} responses
 * @returns {Object} { score, total, percentage, feedback, upgradedSections }
 */
function gradeQuizAttempt(quizId, userId, responses) {
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(quizId);
  if (!quiz) {
    throw new Error('Quiz not found');
  }

  const questions = db.prepare('SELECT * FROM questions WHERE quiz_id = ?').all(quizId);
  if (questions.length === 0) {
    throw new Error('No questions found for this quiz');
  }

  const questionsMap = {};
  for (const q of questions) {
    questionsMap[q.id] = q;
  }

  let correctCount = 0;
  const gradedItems = [];
  const sectionCorrectMap = {}; // section_id -> { total: number, correct: number }

  for (const resp of responses) {
    const q = questionsMap[resp.questionId];
    if (!q) continue;

    const isCorrect = (resp.answer || '').trim().toLowerCase() === (q.correct_answer || '').trim().toLowerCase();
    if (isCorrect) correctCount++;

    if (!sectionCorrectMap[q.section_id]) {
      sectionCorrectMap[q.section_id] = { total: 0, correct: 0 };
    }
    sectionCorrectMap[q.section_id].total++;
    if (isCorrect) {
      sectionCorrectMap[q.section_id].correct++;
    }

    gradedItems.push({
      questionId: q.id,
      sectionId: q.section_id,
      questionText: q.question_text,
      userAnswer: resp.answer,
      correctAnswer: q.correct_answer,
      isCorrect
    });
  }

  const totalQuestions = questions.length;
  const upgradedSections = [];

  db.transaction(() => {
    // Record quiz attempt
    const insertAttempt = db.prepare(`
      INSERT INTO quiz_attempts (quiz_id, user_id, score, total_questions)
      VALUES (?, ?, ?, ?)
    `);
    const attemptResult = insertAttempt.run(quizId, userId, correctCount, totalQuestions);
    const attemptId = attemptResult.lastInsertRowid;

    // Record individual question responses
    const insertResponse = db.prepare(`
      INSERT INTO question_responses (attempt_id, question_id, selected_answer, is_correct)
      VALUES (?, ?, ?, ?)
    `);

    for (const item of gradedItems) {
      insertResponse.run(attemptId, item.questionId, item.userAnswer || '', item.isCorrect ? 1 : 0);
    }

    // REQ-4.4: Upgrade section from Skimmed to Reinforced if answered correctly
    const updateClassification = db.prepare(`
      UPDATE classifications
      SET status = 'Reinforced',
          explanation = explanation || ' [Quiz Passed: Upgraded to Reinforced]'
      WHERE session_id = ? AND section_id = ? AND status = 'Skimmed'
    `);

    for (const secId of Object.keys(sectionCorrectMap)) {
      const stats = sectionCorrectMap[secId];
      // Passed if at least 1 question correct or >= 50%
      if (stats.correct >= Math.ceil(stats.total / 2)) {
        const res = updateClassification.run(quiz.session_id, secId);
        if (res.changes > 0) {
          upgradedSections.push(Number(secId));
        }
      }
    }

    // Mark session as 'quizzed'
    db.prepare('UPDATE reading_sessions SET status = ? WHERE id = ?').run('quizzed', quiz.session_id);
  })();

  return {
    score: correctCount,
    totalQuestions,
    percentage: Math.round((correctCount / totalQuestions) * 100),
    gradedItems,
    upgradedSections
  };
}

module.exports = {
  extractWords,
  extractSentences,
  generateLocalQuestionsForSection,
  generateQuizForSession,
  gradeQuizAttempt
};
