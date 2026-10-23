# GhostRead

> **A Behavioral Reading-Comprehension Verifier with Targeted Re-Assessment**  
> *Developed per the Software Requirements Specification (SRS Version 1.0) for VIT University Software Engineering Lab (Experiment 1).*

GhostRead bridges the gap between *access* (did a student open a file?) and *comprehension* (did they actually read and absorb it?). While a student reads inside an embedded PDF.js reader, GhostRead silently tracks dwell time, scroll velocity relative to word density, and backtracking. It classifies each section as **Skimmed**, **Genuinely Read**, or **Reread**, generates a targeted micro-quiz exclusively on skimmed sections, and displays a multi-document comprehension dashboard.

---

## Quick Setup (3 Commands)

```bash
# 1. Install dependencies
npm install

# 2. Programmatically generate 3 academic PDFs & seed realistic demo history
npm run demo

# 3. Start GhostRead server
npm start
```

Open your browser to: **`http://localhost:3000`**

---

## 3-Minute Teacher Demo Walkthrough Script

Use this step-by-step walkthrough to demonstrate the core novelty and all increments to your instructor:

### Step 1: Login & Document Library (30 seconds)
1. Navigate to `http://localhost:3000/login.html`.
2. Click the quick button **"Quick Fill Demo Student"** (`demo@ghostread.app` / `demo1234`) and click **Sign In**.
3. You will see the **Document Library** pre-populated with 3 programmatically generated academic PDFs:
   - *Distributed Consensus & Fault Tolerant Protocols*
   - *Virtual Memory & Hardware Paging Architectures*
   - *Database Storage Hierarchies & B+ Tree Indexing*

### Step 2: Live Behavioral Telemetry in the Reader (60 seconds)
1. On *Distributed Consensus*, click **"Start Reading"**.
2. Notice the continuous vertical scroll powered by Mozilla PDF.js.
3. In the top right toolbar, turn on the **"Demo Mode HUD"** toggle.
4. **Demonstrate Genuine Reading:**
   - Stay on **Section 1 (Page 1)** and scroll slowly.
   - Point out in the HUD that dwell time increases and the classifier shows **"Genuinely Reading"** (Green).
5. **Demonstrate Skimming Detection (Core Novelty):**
   - Rapidly scroll past **Section 2 (Page 2)** in under 4 seconds.
   - Point out to your teacher how the live HUD immediately flags **"Skim Detected! (Fast Velocity)"** (Red) because scroll velocity exceeded the threshold relative to the page's word density!
6. **Demonstrate Rereading Detection:**
   - Scroll back up to Section 1 and linger for > 4 seconds.
   - The HUD registers a backtrack and displays **"Reread Pass (Deep Engagement)"** (Purple).

### Step 3: Finish Reading & Post-Read Summary (30 seconds)
1. Click the top button **"✓ Finish Reading"**.
2. The session completes in under 3 seconds and presents the **Post-Read Summary**.
3. Notice that the summary transparently displays:
   - Genuinely Read and Reread sections marked safe.
   - The skimmed section highlighted with an alert: *"Review Needed: 1 section was skimmed."*

### Step 4: Targeted Micro-Quiz & Section Reinforcement (45 seconds)
1. Click **"Start Targeted Micro-Quiz"**.
2. Notice that the quiz contains questions **ONLY from the skimmed section** (REQ-4.1). No unskimmed sections are quizzed!
3. Select your answers and click **Submit Answers & Grade**.
4. You receive immediate right/wrong feedback and an alert:
   > *"Comprehension Upgraded! Upgraded Section from Skimmed to **Reinforced**."*
5. Click **View Comprehension Dashboard**.

### Step 5: Comprehension Dashboard & Admin Thresholds (15 seconds)
1. On the **Comprehension Dashboard**, show the interactive **Heatmap**:
   - Click the upgraded section block to show the inspector modal with raw dwell, speed, and the full decision explanation (*"Why was this label assigned?"*).
2. Show the **Chart.js Cross-Document Trends** chart illustrating study habits across multiple sessions.
3. Sign out and sign in with the admin account (**"Quick Fill Demo Admin"**: `admin@ghostread.app` / `admin1234`).
4. Visit **Admin Settings** to show how classification thresholds (words-per-second, dwell fractions, skim velocity) can be adjusted dynamically in `/config/thresholds.json` without modifying any code!

---

## Architecture Overview

GhostRead follows the **Incremental SDLC Model** (detailed in `/public/explain.html`):

```
┌────────────────────────────────────────────────────────┐
│                      Client Layer                      │
│   Vanilla JS (No Build Step) • PDF.js CDN • Chart.js   │
└───────────────────────────┬────────────────────────────┘
                            │ REST / JSON (sendBeacon)
┌───────────────────────────▼────────────────────────────┐
│                      Server Layer                      │
│        Node.js + Express • bcryptjs • jsonwebtoken     │
│   ├── Classifier Engine (Dwell vs Word Density Math)   │
│   ├── Targeted Micro-Quiz Generator (Cloze / MCQ)      │
│   └── Multi-document Dashboard Analytics Router        │
└───────────────────────────┬────────────────────────────┘
                            │ SQL Prepared Statements
┌───────────────────────────▼────────────────────────────┐
│                    Persistence Layer                   │
│   SQLite (better-sqlite3) • PostgreSQL-Portable Schema │
│   JSON Config (/config/thresholds.json)                │
└────────────────────────────────────────────────────────┘
```

---

## Thresholds Configuration (`/config/thresholds.json`)

All classification rules are configurable per REQ-3.4 and REQ-5.4:

```json
{
  "reading_speed": {
    "words_per_second": 3.5
  },
  "dwell_time": {
    "min_dwell_fraction": 0.40,
    "min_absolute_dwell_seconds": 2.0
  },
  "scroll_speed": {
    "max_reading_speed_px_sec": 350.0,
    "relative_speed_skim_threshold": 1.25
  },
  "reread": {
    "min_backtrack_dwell_seconds": 4.0,
    "min_passes": 2
  }
}
```

---

## Switching to HTTPS (SRS 3.4, 5.3)

GhostRead runs on HTTP on `localhost:3000` for development convenience. To enable secure HTTPS:

1. Obtain your SSL certificate and private key (e.g., `key.pem` and `cert.pem`).
2. In your `.env` file, set:
   ```env
   USE_HTTPS=true
   SSL_KEY_PATH=/path/to/key.pem
   SSL_CERT_PATH=/path/to/cert.pem
   ```
3. Restart the server (`npm start`). `server/index.js` automatically instantiates `https.createServer` with zero code modifications.

---

## Running Automated Tests

Run the test suite using Node's native test runner:

```bash
npm test
```

Includes test coverage for:
- Comprehension Classifier rules (Skimmed, Genuinely Read, Reread, empty page, diagrams).
- Targeted Micro-Quiz selection (strictly skimmed sections, skipping when 0 skimmed, grading, status upgrade to Reinforced).
- Document upload validation (rejecting non-PDFs, 20MB file limit, page boundary section splitting).

---

## Known Limitations

1. **Heuristic Estimates**: The classifier uses heuristic behavioral models (dwell time relative to text density, scroll velocity deltas, backtracking). As noted in SRS 2.5, results are behavioral estimates rather than cognitive certainties.
2. **Desktop Focus**: Per SRS Section 2.4, the reading viewer is optimized for desktop browsers (Chrome, Firefox, Edge) using mouse and trackpad scroll inputs.
3. **PDF Text Layouts**: Extracted text relies on standard PDF streams; scanned image-only PDFs without OCR text layers will be classified based on visual inspection dwell time rather than word counts.
