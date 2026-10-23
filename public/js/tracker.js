// Set up PDF.js worker (Local + CDN fallback)
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
}

const urlParams = new URLSearchParams(window.location.search);
const documentId = parseInt(urlParams.get('doc'), 10);

if (!documentId) {
  alert('No document specified');
  window.location.href = '/';
}

// Global Tracking State
let sessionId = null;
let docData = null;
let sectionsMap = {}; // section_number -> section object
let sectionMetrics = {}; // section_id -> { dwellMs, maxBacktracks, pass, lastEnterTime, speedSum, speedSamples }
let highestSectionVisited = 1;
let currentVisibleSectionNumber = 1;

// Scroll calculation variables
let lastScrollY = 0;
let lastScrollTime = performance.now();
let instantScrollSpeed = 0; // px/sec
let eventBatchQueue = [];
let batchIntervalId = null;
let isDemoMode = false;

// 1. Initialize Document & Reading Session
async function initReader() {
  try {
    const user = await API.getCurrentUser();
    if (!user) {
      window.location.href = '/login.html';
      return;
    }

    // Check first-time walkthrough (SRS 2.6)
    if (!localStorage.getItem('ghostread_walkthrough_seen')) {
      showWalkthroughModal();
    }

    // Load document metadata and sections
    const docRes = await API.get(`/api/documents/${documentId}`);
    docData = docRes.document;
    document.getElementById('doc-title').textContent = docData.title;

    for (const sec of docRes.sections) {
      sectionsMap[sec.section_number] = sec;
      sectionMetrics[sec.id] = {
        sectionId: sec.id,
        sectionNumber: sec.section_number,
        dwellMs: 0,
        backtrackCount: 0,
        passNumber: 1,
        lastEnterTime: null,
        scrollSpeedPxPerSec: 0,
        relativeScrollSpeed: 0,
        samples: 0
      };
    }

    // Start reading session
    const sessionRes = await API.post('/api/sessions/start', { documentId });
    sessionId = sessionRes.sessionId;

    // Render PDF with PDF.js
    await renderPdfDocument(`/api/documents/${documentId}/file`);

    // Setup viewport tracking and batch timer
    setupTracking();
    batchIntervalId = setInterval(flushTelemetryEvents, 3000);

  } catch (err) {
    console.error('Initialization error:', err);
    alert('Failed to load document: ' + err.message);
    window.location.href = '/';
  }
}

// 2. Render all PDF pages in continuous scroll
async function renderPdfDocument(pdfUrl) {
  const container = document.getElementById('pdf-viewport');
  const token = API.getToken();
  const authUrl = token ? `${pdfUrl}?token=${encodeURIComponent(token)}` : pdfUrl;

  const loadingTask = pdfjsLib.getDocument({
    url: authUrl,
    withCredentials: true,
    httpHeaders: token ? { 'Authorization': `Bearer ${token}` } : {}
  });

  const pdf = await loadingTask.promise;
  const spinner = document.getElementById('pdf-loading-spinner');
  if (spinner) spinner.remove();

  const totalPages = pdf.numPages;
  document.getElementById('page-indicator').textContent = `Page 1 of ${totalPages}`;

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdf.getPage(pageNum);

    // Calculate scale to fit standard desktop viewport (~820px width)
    const viewportDefault = page.getViewport({ scale: 1.0 });
    const targetWidth = Math.min(840, window.innerWidth - 80);
    const scale = targetWidth / viewportDefault.width;
    const viewport = page.getViewport({ scale });

    const pageWrapper = document.createElement('div');
    pageWrapper.className = 'pdf-page-container';
    pageWrapper.id = `page-container-${pageNum}`;
    pageWrapper.dataset.pageNumber = pageNum;
    pageWrapper.dataset.sectionNumber = pageNum;
    pageWrapper.style.width = `${viewport.width}px`;
    pageWrapper.style.height = `${viewport.height}px`;

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    pageWrapper.appendChild(canvas);

    container.appendChild(pageWrapper);

    const renderContext = {
      canvasContext: canvas.getContext('2d'),
      viewport: viewport
    };
    await page.render(renderContext).promise;
  }

  // Focus container so keyboard navigation (arrows/Space/PageDown) works immediately
  container.focus();

  // Add keyboard navigation listener
  window.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'PageDown', ' '].includes(e.key)) {
      container.scrollTop += (e.key === ' ' || e.key === 'PageDown') ? 500 : 70;
    } else if (['ArrowUp', 'PageUp'].includes(e.key)) {
      container.scrollTop -= (e.key === 'PageUp') ? 500 : 70;
    }
  });
}

// 3. Silent Telemetry Tracking (REQ-2.1 to 2.4, SRS 5.1, 5.4)
function setupTracking() {
  const container = document.getElementById('pdf-viewport');

  // IntersectionObserver to detect which page/section is in viewport
  const observer = new IntersectionObserver((entries) => {
    const now = performance.now();

    entries.forEach(entry => {
      const pageNum = parseInt(entry.target.dataset.pageNumber, 10);
      const sec = sectionsMap[pageNum];
      if (!sec) return;
      const metrics = sectionMetrics[sec.id];

      if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
        // Entering section
        currentVisibleSectionNumber = pageNum;
        document.getElementById('page-indicator').textContent = `Page ${pageNum} of ${docData.total_pages}`;
        metrics.lastEnterTime = now;

        // Check Backtrack (REQ-2.3)
        if (pageNum < highestSectionVisited) {
          metrics.backtrackCount++;
          metrics.passNumber++;
        } else {
          highestSectionVisited = Math.max(highestSectionVisited, pageNum);
        }
      } else {
        // Exiting section: accumulate dwell time (REQ-2.1)
        if (metrics.lastEnterTime) {
          const deltaDwell = now - metrics.lastEnterTime;
          metrics.dwellMs += deltaDwell;
          metrics.lastEnterTime = null;
          queueTelemetryEvent(metrics);
        }
      }
    });

    if (isDemoMode) updateDemoHud();
  }, {
    root: container,
    threshold: [0.1, 0.35, 0.7]
  });

  document.querySelectorAll('.pdf-page-container').forEach(el => observer.observe(el));

  // Scroll event tracking with RAF (< 50ms processing, REQ-2.4, 5.1)
  let ticking = false;
  container.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        const now = performance.now();
        const currentScrollY = container.scrollTop;
        const deltaY = Math.abs(currentScrollY - lastScrollY);
        const deltaTimeMs = Math.max(16, now - lastScrollTime);

        instantScrollSpeed = (deltaY / (deltaTimeMs / 1000.0)); // px/sec

        // Update active section's relative speed (REQ-2.2)
        const activeSec = sectionsMap[currentVisibleSectionNumber];
        if (activeSec && sectionMetrics[activeSec.id]) {
          const m = sectionMetrics[activeSec.id];
          const pageContainer = document.getElementById(`page-container-${currentVisibleSectionNumber}`);
          const pageHeight = pageContainer ? pageContainer.clientHeight : 1000;
          
          // Text density: words per 1000px
          const words = Math.max(1, activeSec.word_count || 1);
          const density = words / (pageHeight / 1000);
          const baselineDensity = 150; // words per 1000px typical
          
          // Relative scroll speed: ratio of current scroll speed to expected text-density speed
          const expectedReadingScrollSpeed = (words / 3.5) > 0 ? (pageHeight / (words / 3.5)) : 200;
          const relSpeed = instantScrollSpeed > 0 ? (instantScrollSpeed / expectedReadingScrollSpeed) : 0.5;

          m.scrollSpeedPxPerSec = (m.scrollSpeedPxPerSec * m.samples + instantScrollSpeed) / (m.samples + 1);
          m.relativeScrollSpeed = (m.relativeScrollSpeed * m.samples + relSpeed) / (m.samples + 1);
          m.samples++;
        }

        lastScrollY = currentScrollY;
        lastScrollTime = now;
        ticking = false;

        if (isDemoMode) updateDemoHud();
      });
      ticking = true;
    }
  }, { passive: true });
}

// 4. Batching and telemetry dispatch
function queueTelemetryEvent(metric) {
  eventBatchQueue.push({
    sectionId: metric.sectionId,
    dwellTimeMs: Math.round(metric.dwellMs),
    scrollSpeedPxPerSec: parseFloat(metric.scrollSpeedPxPerSec.toFixed(2)),
    relativeScrollSpeed: parseFloat(metric.relativeScrollSpeed.toFixed(2)),
    backtrackCount: metric.backtrackCount,
    passNumber: metric.passNumber
  });
}

async function flushTelemetryEvents() {
  if (!sessionId) return;

  // Snapshot active visible section dwell
  const activeSec = sectionsMap[currentVisibleSectionNumber];
  if (activeSec && sectionMetrics[activeSec.id]) {
    const m = sectionMetrics[activeSec.id];
    if (m.lastEnterTime) {
      const delta = performance.now() - m.lastEnterTime;
      m.dwellMs += delta;
      m.lastEnterTime = performance.now(); // reset anchor
      queueTelemetryEvent(m);
    }
  }

  if (eventBatchQueue.length === 0) return;

  const toSend = [...eventBatchQueue];
  eventBatchQueue = [];

  try {
    await fetch(`/api/sessions/${sessionId}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API.getToken()}`
      },
      body: JSON.stringify({ events: toSend })
    });
  } catch (err) {
    console.warn('Telemetry batch dispatch error (will retry next tick):', err.message);
  }
}

// Ensure events are sent on page unload via navigator.sendBeacon
window.addEventListener('beforeunload', () => {
  if (!sessionId) return;

  const activeSec = sectionsMap[currentVisibleSectionNumber];
  if (activeSec && sectionMetrics[activeSec.id] && sectionMetrics[activeSec.id].lastEnterTime) {
    sectionMetrics[activeSec.id].dwellMs += (performance.now() - sectionMetrics[activeSec.id].lastEnterTime);
    queueTelemetryEvent(sectionMetrics[activeSec.id]);
  }

  if (eventBatchQueue.length > 0) {
    const payload = JSON.stringify({ events: eventBatchQueue });
    navigator.sendBeacon(`/api/sessions/${sessionId}/events`, payload);
  }
});

// 5. Finish Reading Session
async function finishReadingSession() {
  const finishBtn = document.getElementById('finish-btn');
  finishBtn.disabled = true;
  finishBtn.textContent = 'Analyzing reading...';

  // Flush remaining telemetry
  await flushTelemetryEvents();

  try {
    const result = await API.post(`/api/sessions/${sessionId}/finish`, {});
    window.location.href = `/summary.html?session=${sessionId}`;
  } catch (err) {
    alert('Error saving reading session: ' + err.message);
    finishBtn.disabled = false;
    finishBtn.textContent = '✓ Finish Reading';
  }
}

// 6. Live Demo Mode HUD
function toggleDemoMode(enabled) {
  isDemoMode = enabled;
  document.getElementById('demo-hud').style.display = enabled ? 'block' : 'none';
  if (enabled) updateDemoHud();
}

function updateDemoHud() {
  const sec = sectionsMap[currentVisibleSectionNumber];
  if (!sec) return;
  const m = sectionMetrics[sec.id];
  if (!m) return;

  // Active dwell
  let currentDwell = m.dwellMs;
  if (m.lastEnterTime) {
    currentDwell += (performance.now() - m.lastEnterTime);
  }
  const dwellSec = currentDwell / 1000.0;
  const words = sec.word_count || 0;
  const expDwell = Math.max(2.0, (words / 3.5) * 0.4);

  document.getElementById('hud-section').textContent = `Section ${sec.section_number} (Page ${sec.page_number})`;
  document.getElementById('hud-words').textContent = `${words} words (~${sec.estimated_read_time}s expected)`;
  document.getElementById('hud-dwell').textContent = `${dwellSec.toFixed(1)}s`;
  document.getElementById('hud-exp-dwell').textContent = `${expDwell.toFixed(1)}s`;
  document.getElementById('hud-scroll-speed').textContent = `${Math.round(instantScrollSpeed)} px/s`;
  document.getElementById('hud-rel-speed').textContent = `${m.relativeScrollSpeed.toFixed(2)}x`;
  document.getElementById('hud-backtracks').textContent = `${m.backtrackCount}`;

  // Live Classifier Prediction
  const predEl = document.getElementById('hud-prediction');
  if (m.backtrackCount > 0 && dwellSec >= 4.0) {
    predEl.className = 'hud-prediction Reread';
    predEl.textContent = 'Reread Pass (Deep Engagement)';
  } else if ((m.relativeScrollSpeed >= 1.25 || instantScrollSpeed > 350) && dwellSec < expDwell) {
    predEl.className = 'hud-prediction Skimmed';
    predEl.textContent = 'Skim Detected! (Fast Velocity)';
  } else if (dwellSec >= expDwell) {
    predEl.className = 'hud-prediction Genuinely-Read';
    predEl.textContent = 'Genuinely Reading';
  } else {
    predEl.className = 'hud-prediction Genuinely-Read';
    predEl.textContent = 'Reading in progress...';
  }
}

// Walkthrough Modal
function showWalkthroughModal() {
  document.getElementById('walkthrough-modal').style.display = 'flex';
}

function closeWalkthroughModal() {
  localStorage.setItem('ghostread_walkthrough_seen', 'true');
  document.getElementById('walkthrough-modal').style.display = 'none';
}

initReader();
