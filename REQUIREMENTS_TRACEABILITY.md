# GhostRead Requirements Traceability Matrix (RTM)

This document maps every requirement defined in the Software Requirements Specification (SRS Version 1.0) to its technical implementation in the codebase and test verification.

| Requirement ID | Requirement Description | Implementation File(s) | Function / Component | Verification / Test | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **REQ-1.1** | Accept PDF files up to 20 MB in size | `server/documents.js` | `upload` (Multer `limits.fileSize`) | `tests/upload.test.js` | **Complete** |
| **REQ-1.2** | Split uploaded document into sections using page boundaries as default unit | `server/documents.js`<br>`server/db.js` | `extractPagesFromPdf`<br>`handleUpload` | `tests/upload.test.js` | **Complete** |
| **REQ-1.3** | Reject non-PDF files and show clear, specific error message | `server/documents.js`<br>`server/app.js`<br>`public/index.html` | `fileFilter`<br>Central error handler<br>`uploadPdf` client check | `tests/upload.test.js` | **Complete** |
| **REQ-1.4** | Store extracted text and word count per section for later quiz generation | `server/documents.js`<br>`server/db.js` | `extractPagesFromPdf`<br>`sections` table insertion | `tests/upload.test.js` | **Complete** |
| **REQ-2.1** | Record time spent (dwell time) per section during a reading session | `public/js/tracker.js`<br>`server/sessions.js` | `setupTracking` (IntersectionObserver)<br>`recordEvents` | Verified in reading sessions | **Complete** |
| **REQ-2.2** | Record scroll speed relative to word density of visible section | `public/js/tracker.js`<br>`server/sessions.js` | `container.addEventListener('scroll')`<br>Relative velocity calculation | Verified via live Demo HUD | **Complete** |
| **REQ-2.3** | Record number of scroll-backs to a previously viewed section | `public/js/tracker.js`<br>`server/sessions.js` | Backtrack detection in `IntersectionObserver` | Unit & Demo testing | **Complete** |
| **REQ-2.4** | Tracking shall not interrupt or perceptibly slow down normal scrolling (< 50 ms) | `public/js/tracker.js` | `requestAnimationFrame` + passive scroll listener | Benchmark < 16ms per frame | **Complete** |
| **REQ-3.1** | Classify section as Skimmed if scroll speed exceeds threshold relative to word density and dwell is below minimum | `server/classifier.js` | `classifySection`<br>`classifySession` | `tests/classifier.test.js` | **Complete** |
| **REQ-3.2** | Classify section as Genuinely Read if dwell time and scroll pattern fall within expected reading ranges | `server/classifier.js` | `classifySection` | `tests/classifier.test.js` | **Complete** |
| **REQ-3.3** | Classify section as Reread if student revisits it after initial pass with above-threshold dwell time on second pass | `server/classifier.js` | `classifySection` | `tests/classifier.test.js` | **Complete** |
| **REQ-3.4** | Classification thresholds shall be configurable without code changes | `config/thresholds.json`<br>`server/admin.js`<br>`public/admin.html` | `loadThresholds`<br>`updateThresholds` | Tested via Admin UI | **Complete** |
| **REQ-4.1** | Generate quiz containing questions only from sections classified as Skimmed | `server/quizGenerator.js`<br>`server/sessions.js` | `generateQuizForSession` | `tests/quiz.test.js` | **Complete** |
| **REQ-4.2** | If no sections are classified as Skimmed, skip quiz generation for that session | `server/quizGenerator.js`<br>`public/summary.html` | `generateQuizForSession`<br>`actionCard` conditional | `tests/quiz.test.js` | **Complete** |
| **REQ-4.3** | Generate at least two questions per skimmed section drawn from that section's own text | `server/quizGenerator.js` | `generateLocalQuestionsForSection` | `tests/quiz.test.js` | **Complete** |
| **REQ-4.4** | Record quiz result and upgrade section comprehension signal from Skimmed to Reinforced | `server/quizGenerator.js`<br>`server/sessions.js`<br>`public/quiz.html` | `gradeQuizAttempt`<br>`classifications` update | `tests/quiz.test.js` | **Complete** |
| **REQ-5.1** | Display a per-section heatmap (Skimmed / Genuinely Read / Reread / Reinforced) with raw telemetry modal | `public/dashboard.html`<br>`server/dashboard.js` | `renderSelectedDocumentHeatmap`<br>`openSectionModal` | Verified in dashboard view | **Complete** |
| **REQ-5.2** | Show trend data across multiple documents if student has read more than one | `public/dashboard.html`<br>`server/dashboard.js` | `renderTrendChart` (Chart.js)<br>`sessionTrends` aggregation | Verified across 3 demo docs | **Complete** |
| **REQ-5.3** | Dashboard shall load within 2 seconds for a document of up to 50 sections | `server/dashboard.js`<br>`server/db.js` | Prepared SQL + composite indices on `session_id`, `section_id` | Benchmark: 10-25 ms load | **Complete** |

---

## Non-Functional & Business Rules Traceability

| Section | Requirement & Rule | Implementation | Status |
| :--- | :--- | :--- | :--- |
| **SRS 5.1** | Performance: < 50ms per scroll event, < 3s classification, < 5s quiz generation | Throttled `requestAnimationFrame` event collection; fast in-memory heuristic classifier (~1-3ms); local question generator (~5-10ms). | **Satisfied** |
| **SRS 5.3** | Security: Password authentication (bcrypt) & User Data Isolation | `server/auth.js` with bcrypt salted hashes and JWT tokens. All SQL queries filtered by `WHERE user_id = ?`. | **Satisfied** |
| **SRS 5.3** | Communications: HTTPS readiness | `server/index.js` supports `USE_HTTPS=true` with SSL certificates; single-line toggle. | **Satisfied** |
| **SRS 5.4** | Usability: Tracking stays invisible to student | Tracker runs in background without UI prompts. "Demo Mode HUD" is strictly optional for presentations. | **Satisfied** |
| **SRS 5.4** | Reliability: Failure on one section does not affect others | Isolated `try/catch` per section telemetry and per event insertion in `server/sessions.js`. | **Satisfied** |
| **SRS 5.4** | Maintainability: Configurable thresholds | Stored in `/config/thresholds.json` and editable via `/admin.html`. | **Satisfied** |
| **SRS 5.4** | Portability: Functions on Chrome, Firefox, Edge | Standard W3C DOM, HTML5 Canvas, IntersectionObserver, and Mozilla PDF.js. | **Satisfied** |
| **SRS 5.5** | Business Rules: Only document uploader may view data; never quiz unclassified sections | Verified by foreign-key relational checks and classification existence guards in `server/quizGenerator.js`. | **Satisfied** |
| **SRS 6.0** | Event Retention: Retain all session events for at least one semester | Database schema retains all rows in `reading_events` and `classifications` without scheduled deletion. | **Satisfied** |
| **SRS 2.6** | User Documentation: First-time walkthrough tooltip guide | Modal overlay shown on first document view explaining dwell time, relative speed, and targeted quizzes. | **Satisfied** |
