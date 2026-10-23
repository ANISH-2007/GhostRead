const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const bcrypt = require('bcryptjs');
const db = require('../server/db');
const { extractPagesFromPdf } = require('../server/documents');
const { classifySection } = require('../server/classifier');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Helper to create a multi-page PDF using PDFKit
function createPdfFile(filePath, title, pagesData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', autoFirstPage: false });
    const writeStream = fs.createWriteStream(filePath);

    doc.pipe(writeStream);

    pagesData.forEach((page, index) => {
      doc.addPage({ margin: 40, size: 'A4' });

      // Header
      doc.fontSize(9).fillColor('#64748b').font('Helvetica').text('GhostRead Academic Library — Course Material', 40, 30);
      doc.fontSize(9).text(`Page ${index + 1} of ${pagesData.length}`, 420, 30, { align: 'right', width: 135 });
      doc.moveTo(40, 44).lineTo(555, 44).strokeColor('#cbd5e1').stroke();

      // Title & Subtitle
      doc.fontSize(15).fillColor('#0f172a').font('Helvetica-Bold').text(page.heading, 40, 56);
      doc.fontSize(10).fillColor('#475569').font('Helvetica-Oblique').text(page.subheading, 40, 78);

      // Body Paragraphs
      let currentY = 100;
      doc.fontSize(10).fillColor('#1e293b').font('Helvetica').lineGap(3);
      page.paragraphs.forEach(p => {
        doc.text(p, 40, currentY, { width: 515 });
        currentY = doc.y + 10;
      });

      // Key takeaways box
      if (page.keyConcept) {
        const boxY = Math.max(currentY + 5, 680);
        doc.rect(40, boxY, 515, 65).fillAndStroke('#f8fafc', '#94a3b8');
        doc.fillColor('#0f172a').fontSize(9.5).font('Helvetica-Bold')
           .text('Key Conceptual Takeaway:', 50, boxY + 8);
        doc.fillColor('#334155').fontSize(9).font('Helvetica')
           .text(page.keyConcept, 50, boxY + 24, { width: 495 });
      }
    });

    doc.end();
    writeStream.on('finish', () => resolve(filePath));
    writeStream.on('error', reject);
  });
}

const samplePdfs = [
  {
    fileName: 'Distributed_Consensus_Paxos_Raft.pdf',
    title: 'Distributed Consensus and Fault Tolerant Protocols',
    pages: [
      {
        heading: '1. Fundamentals of Distributed Consensus',
        subheading: 'Synchronization, Asynchrony, and the Impossibility of Agreement',
        paragraphs: [
          'A distributed system consists of autonomous computing entities that communicate via message passing over an unreliable network. Achieving agreement on a shared state machine across independent nodes is known as distributed consensus. In an asynchronous network, message delivery delays are unbounded, and network partitions can temporarily isolate nodes.',
          'The Fischer-Lynch-Paterson (FLP) impossibility result proves that in a purely asynchronous network, no deterministic consensus protocol can guarantee both safety and liveness in the presence of even a single unannounced crash failure. Consequently, modern production protocols sacrifice liveness during severe network partitions while strictly upholding safety.',
          'State machine replication (SMR) ensures that all non-faulty replicas execute identical sequences of state transitions in identical deterministic order, maintaining absolute linearizability.'
        ],
        keyConcept: 'FLP Impossibility: Deterministic asynchronous consensus cannot guarantee termination if even one node may fail. Practical protocols rely on partial synchrony and timeouts.'
      },
      {
        heading: '2. The Paxos Consensus Protocol',
        subheading: 'Proposers, Acceptors, Quorums, and Two-Phase Agreement',
        paragraphs: [
          'Leslie Lamport introduced the Paxos consensus algorithm to solve consensus in asynchronous environments with crash-recovery failures. Paxos structures nodes into three logical roles: Proposers who advocate client values, Acceptors who store consensus votes, and Learners who observe agreed values.',
          'In Phase 1a (Prepare), a proposer generates a globally unique ballot number n and sends a prepare request to a majority quorum of acceptors. In Phase 1b (Promise), acceptors agree not to accept any proposals numbered less than n, returning the highest proposal number they previously accepted.',
          'In Phase 2a (Accept), the proposer submits value v with ballot n. In Phase 2b (Accepted), if acceptors have not promised a higher ballot, they accept the proposal. A proposal reaches consensus once accepted by a strict majority quorum.'
        ],
        keyConcept: 'Paxos Quorums: Overlapping majority quorums ensure that any two quorums share at least one node, preventing split-brain states and conflicting committed values.'
      },
      {
        heading: '3. Raft: Understandable Consensus for Practical Systems',
        subheading: 'Leader Election, Log Matching Invariant, and Commit Rules',
        paragraphs: [
          'The Raft consensus algorithm was designed by Ongaro and Ousterhout as an alternative to Paxos, prioritizing intelligibility and formal decomposability. Raft decomposes consensus into three independent subproblems: leader election, log replication, and cluster safety.',
          'Time is divided into arbitrary terms identified by monotonic integers. Each term begins with an election where follower nodes transition to candidates upon election timeout. A candidate wins the election by securing majority votes, becoming the leader for that term.',
          'The leader accepts client write requests, appends entries to its local log, and broadcasts AppendEntries RPCs. An entry is committed once replicated across a majority of nodes. The Raft Log Matching Invariant guarantees that if two logs contain an entry with the same index and term, they are identical up to that index.'
        ],
        keyConcept: 'Raft Log Matching: Consistency is enforced by the leader, which overwrites conflicting follower logs to match its own authoritative sequence.'
      },
      {
        heading: '4. Byzantine Fault Tolerance and Decentralized Ledgers',
        subheading: 'Malicious Adversaries, Cryptographic Signatures, and Quorums',
        paragraphs: [
          'Crash fault tolerance protocols assume non-faulty nodes adhere strictly to protocol specifications. In contrast, Byzantine fault tolerance (BFT) accounts for arbitrary, malicious, or compromised behaviors, including equivocating messages and forged statements.',
          'Castro and Liskov introduced Practical Byzantine Fault Tolerance (PBFT), which maintains safety in asynchronous networks provided fewer than one-third of the nodes (f < n/3) are faulty or malicious. PBFT uses three consecutive phases: Pre-Prepare, Prepare, and Commit, relying on cryptographic signatures.',
          'Modern proof-of-stake blockchains adapt BFT principles to open networks, combining cryptographic consensus with economic incentives and slashing mechanisms to penalize dishonest participants.'
        ],
        keyConcept: 'Byzantine Bound: Resilient consensus against malicious participants requires a minimum of 3f + 1 nodes to tolerate f arbitrary Byzantine faults.'
      }
    ]
  },
  {
    fileName: 'Virtual_Memory_and_Paging_Architectures.pdf',
    title: 'Virtual Memory and Hardware Paging Architectures',
    pages: [
      {
        heading: '1. Virtual Memory Architecture and Address Translation',
        subheading: 'Logical Addressing, Paging, and Memory Protection',
        paragraphs: [
          'Virtual memory provides an abstraction of contiguous memory space, isolating user processes and abstracting physical RAM limitations. The Memory Management Unit (MMU) translates virtual addresses generated by the CPU into physical addresses in DRAM.',
          'A virtual address is partitioned into a Virtual Page Number (VPN) and an offset. The page size is typically 4 KB in contemporary x86-64 architectures. The page offset remains unmapped and is copied directly to the physical address, while the VPN is looked up in the process page table.',
          'Page tables also maintain permission bits: Read, Write, and Execute (NX/XD bit). Unauthorized access triggers an architectural protection fault, preventing code injection and buffer overflow exploits.'
        ],
        keyConcept: 'Address Translation: The MMU uses the VPN as an index into the page table to retrieve the Physical Frame Number (PFN), concatenating it with the page offset.'
      },
      {
        heading: '2. Multi-Level Page Tables and Translation Lookaside Buffers',
        subheading: 'Hierarchical Mapping and Hardware Translation Caching',
        paragraphs: [
          'A flat linear page table for a 64-bit address space would require petabytes of storage. Modern systems implement hierarchical multi-level page tables (such as 4-level or 5-level paging in x86-64), allocating page table directories only for mapped regions of virtual memory.',
          'Because multi-level page table traversals require multiple sequential RAM memory accesses per CPU instruction, processors incorporate a specialized high-speed hardware cache called the Translation Lookaside Buffer (TLB).',
          'A TLB hit yields physical frame translation in under one nanosecond. A TLB miss incurs a multi-cycle hardware page table walk. TLB invalidation (flushing) is required during process context switches or page remapping.'
        ],
        keyConcept: 'TLB Performance: High TLB hit rates (exceeding 98% in typical workloads) are essential to prevent page table lookups from bottlenecking instruction pipelines.'
      },
      {
        heading: '3. Page Fault Mechanics and Replacement Policies',
        subheading: 'Demand Paging, Working Set Dynamics, and Eviction Algorithms',
        paragraphs: [
          'Demand paging loads physical frames into RAM only when referenced. When a process accesses an unmapped or swapped page, the MMU encounters a clear Present bit and triggers an architectural Page Fault interrupt.',
          'The operating system kernel suspends the faulting process, allocates a physical frame, reads the required page contents from swap storage, updates the page table entry, and resumes the instruction.',
          'When physical memory is exhausted, the OS page replacement algorithm must choose a victim frame to evict. Beladys optimal algorithm (MIN) evicts the page that will not be accessed for the longest time in the future, providing a theoretical performance benchmark.'
        ],
        keyConcept: 'Demand Paging: Eliminates preloading of unused program sections, but incurs significant disk I/O latency upon initial page faults.'
      },
      {
        heading: '4. Thrashing and Working Set Management',
        subheading: 'Memory Overcommit, Swap Hell, and Working Set Sizing',
        paragraphs: [
          'When the aggregate working sets of all active processes exceed available physical DRAM, the operating system spends more time servicing page faults than executing instructions. This pathological state is termed thrashing.',
          'During thrashing, the CPU utilization collapses because all ready threads are blocked waiting for disk paging I/O. Paging queues saturate, and system throughput drops to near zero.',
          'Denning proposed the Working Set Model, defining a process working set W(t, delta) as the set of pages referenced in the preceding time window delta. The operating system monitors page fault frequencies to adjust process residency.'
        ],
        keyConcept: 'Thrashing Prevention: The OS must suspend or swap out entire processes when the sum of active working sets exceeds total physical memory frames.'
      }
    ]
  },
  {
    fileName: 'Database_Indexing_and_B_Trees.pdf',
    title: 'Database Storage Hierarchies and B+ Tree Indexing',
    pages: [
      {
        heading: '1. Relational Storage Engines and the Buffer Pool',
        subheading: 'Disk-Page Architecture, Dirty Pages, and Slotted Pages',
        paragraphs: [
          'Relational database management systems (DBMS) organize persistent tables into fixed-size disk blocks called pages, commonly 8 KB to 64 KB. The buffer pool manager caches disk pages in RAM to accelerate read and write transactions.',
          'When an update occurs, the page is modified in RAM and marked dirty. Writing dirty pages immediately to disk on every transaction commit would degrade IOPS throughput; instead, changes are appended to an append-only Write-Ahead Log (WAL), deferring disk flushing.',
          'Slotted-page layouts inside individual disk blocks allow variable-length tuples by separating row payload storage from the slot directory array located at the head of the page.'
        ],
        keyConcept: 'Write-Ahead Logging (WAL): Durability is guaranteed by flushing log records before dirty data pages are written to persistent disk.'
      },
      {
        heading: '2. B+ Tree Mechanics: Balancing, Search, and Splits',
        subheading: 'Self-Balancing Multi-Way Search Trees for Storage Engines',
        paragraphs: [
          'The B+ Tree is the standard index structure for relational database systems. Unlike binary search trees, a B+ Tree node has high fan-out (hundreds of child pointers per node), matching disk block boundaries and minimizing tree height.',
          'In a B+ Tree, all data records or heap tuple identifiers are stored exclusively in leaf nodes. Internal nodes contain only routing keys and child page pointers. Leaf nodes are linked via bidirectional pointers to facilitate efficient sequential scans.',
          'Search operations traverse from the root to the leaf in O(log_B N) disk I/Os, where B is the branching factor. When an insert overflows a leaf node, the page is split into two halves and the median key is pushed into the parent node.'
        ],
        keyConcept: 'B+ Tree Fan-Out: A branching factor of 500 allows a 3-level B+ Tree to index over 125 million records with at most 3 page lookups.'
      },
      {
        heading: '3. Hash Indexes vs. Tree Indexes and Query Optimization',
        subheading: 'Point Lookups, Range Scans, and Composite Index Selectivity',
        paragraphs: [
          'Hash indexes provide O(1) expected time complexity for point equality queries by mapping index keys through a cryptographic or multiplicative hash function into bucket arrays.',
          'However, hash indexes cannot support range queries, prefix scans, or ORDER BY operations because hashing destroys monotonic key order. B+ Trees naturally support both equality lookups and sorted range scans.',
          'Query optimizers estimate index selectivity using statistical column histograms. A non-clustered index lookup requires a secondary heap lookup unless the index is a covering index that contains all columns referenced in the SELECT clause.'
        ],
        keyConcept: 'Covering Index: An index that includes all projected and filtered query columns, eliminating secondary heap page reads.'
      }
    ]
  }
];

async function seedDemoData() {
  console.log('[Demo] Seeding GhostRead database with demo accounts, sample PDFs, and reading sessions...');

  // 1. Create or reset demo student and admin users
  const salt = bcrypt.genSaltSync(10);
  const studentPassHash = bcrypt.hashSync('demo1234', salt);
  const adminPassHash = bcrypt.hashSync('admin1234', salt);

  // Check or insert student
  let student = db.prepare('SELECT id FROM users WHERE email = ?').get('demo@ghostread.app');
  if (!student) {
    const res = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run('Alex Demo Student', 'demo@ghostread.app', studentPassHash, 'student');
    student = { id: res.lastInsertRowid };
  }

  // Check or insert admin
  let admin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@ghostread.app');
  if (!admin) {
    db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run('Prof. GhostRead Admin', 'admin@ghostread.app', adminPassHash, 'admin');
  }

  const studentId = student.id;

  // Clear previous demo documents for clean idempotent runs
  const oldDocs = db.prepare('SELECT id, file_path FROM documents WHERE user_id = ?').all(studentId);
  for (const doc of oldDocs) {
    if (fs.existsSync(doc.file_path)) {
      try { fs.unlinkSync(doc.file_path); } catch (_) {}
    }
  }
  db.prepare('DELETE FROM documents WHERE user_id = ?').run(studentId);

  // 2. Generate each PDF and insert document + sections
  const createdDocIds = [];

  for (let i = 0; i < samplePdfs.length; i++) {
    const item = samplePdfs[i];
    const pdfPath = path.join(UPLOADS_DIR, `demo-${Date.now()}-${item.fileName}`);
    console.log(`[Demo] Generating academic PDF: ${item.fileName}...`);
    await createPdfFile(pdfPath, item.title, item.pages);

    const stats = fs.statSync(pdfPath);
    const { totalPages, pages } = await extractPagesFromPdf(pdfPath);

    const docInsert = db.prepare(`
      INSERT INTO documents (user_id, title, file_name, file_path, file_size, total_pages)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const docRes = docInsert.run(studentId, item.title, path.basename(pdfPath), pdfPath, stats.size, totalPages);
    const docId = docRes.lastInsertRowid;
    createdDocIds.push(docId);

    const secInsert = db.prepare(`
      INSERT INTO sections (document_id, section_number, page_number, extracted_text, word_count, line_count, estimated_read_time)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (let p = 0; p < pages.length; p++) {
      const page = pages[p];
      const text = page.text || '';
      const words = text ? text.trim().split(/\s+/).filter(w => w.length > 0) : [];
      const lines = text ? text.split('\n').filter(l => l.trim().length > 0) : [];
      const wordCount = words.length;
      const lineCount = lines.length;
      const estimatedReadTime = wordCount > 0 ? parseFloat((wordCount / 3.5).toFixed(1)) : 1.0;

      secInsert.run(docId, p + 1, page.pageNumber || (p + 1), text, wordCount, lineCount, estimatedReadTime);
    }
  }

  console.log(`[Demo] Created ${createdDocIds.length} sample documents with sections.`);

  // 3. Seed realistic past sessions with mixed signals
  // Session 1: Document 1 (Distributed Consensus) -> Completed reading, had 1 skimmed section that got quizzed and upgraded to Reinforced!
  const doc1Id = createdDocIds[0];
  const doc1Sections = db.prepare('SELECT * FROM sections WHERE document_id = ? ORDER BY section_number ASC').all(doc1Id);

  const session1Res = db.prepare(`
    INSERT INTO reading_sessions (user_id, document_id, start_time, end_time, status)
    VALUES (?, ?, datetime('now', '-3 days'), datetime('now', '-3 days', '+20 minutes'), 'quizzed')
  `).run(studentId, doc1Id);
  const session1Id = session1Res.lastInsertRowid;

  // Insert events and classifications for Session 1:
  // Section 1: Genuinely Read
  // Section 2: Reread (backtracked)
  // Section 3: Skimmed -> Then Reinforced via Quiz
  // Section 4: Genuinely Read
  const sec1 = doc1Sections[0];
  const sec2 = doc1Sections[1];
  const sec3 = doc1Sections[2];
  const sec4 = doc1Sections[3];

  // Section 1: Read thoroughly
  db.prepare(`
    INSERT INTO reading_events (session_id, section_id, dwell_time_ms, scroll_speed_px_per_sec, relative_scroll_speed, backtrack_count, pass_number)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(session1Id, sec1.id, 45000, 120.0, 0.45, 0, 1);

  db.prepare(`
    INSERT INTO classifications (session_id, section_id, status, dwell_time_seconds, relative_scroll_speed, backtrack_count, explanation)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(session1Id, sec1.id, 'Genuinely Read', 45.0, 0.45, 0, 'Dwell time of 45.0s met expected reading range (>= 15.0s for 120 words) at steady pace.');

  // Section 2: Reread with backtrack
  db.prepare(`
    INSERT INTO reading_events (session_id, section_id, dwell_time_ms, scroll_speed_px_per_sec, relative_scroll_speed, backtrack_count, pass_number)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(session1Id, sec2.id, 28000, 140.0, 0.60, 0, 1);
  db.prepare(`
    INSERT INTO reading_events (session_id, section_id, dwell_time_ms, scroll_speed_px_per_sec, relative_scroll_speed, backtrack_count, pass_number)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(session1Id, sec2.id, 32000, 80.0, 0.35, 1, 2);

  db.prepare(`
    INSERT INTO classifications (session_id, section_id, status, dwell_time_seconds, relative_scroll_speed, backtrack_count, explanation)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(session1Id, sec2.id, 'Reread', 60.0, 0.48, 1, 'Revisited section across 2 passes with 60.0s cumulative dwell (revisit dwell 32.0s >= 4.0s threshold). Deep engagement.');

  // Section 3: Skimmed -> Upgraded to Reinforced
  db.prepare(`
    INSERT INTO reading_events (session_id, section_id, dwell_time_ms, scroll_speed_px_per_sec, relative_scroll_speed, backtrack_count, pass_number)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(session1Id, sec3.id, 4200, 680.0, 2.45, 0, 1);

  db.prepare(`
    INSERT INTO classifications (session_id, section_id, status, dwell_time_seconds, relative_scroll_speed, backtrack_count, explanation)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(session1Id, sec3.id, 'Reinforced', 4.2, 2.45, 0, 'Dwell time of 4.2s was below expected minimum, but student passed targeted micro-quiz with 100% accuracy. [Quiz Passed: Upgraded to Reinforced]');

  // Section 4: Genuinely Read
  db.prepare(`
    INSERT INTO reading_events (session_id, section_id, dwell_time_ms, scroll_speed_px_per_sec, relative_scroll_speed, backtrack_count, pass_number)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(session1Id, sec4.id, 40000, 130.0, 0.52, 0, 1);

  db.prepare(`
    INSERT INTO classifications (session_id, section_id, status, dwell_time_seconds, relative_scroll_speed, backtrack_count, explanation)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(session1Id, sec4.id, 'Genuinely Read', 40.0, 0.52, 0, 'Dwell time of 40.0s met expected reading range (>= 14.5s for 115 words) at steady pace.');

  // Seed Quiz for Session 1 Section 3
  const quiz1 = db.prepare('INSERT INTO quizzes (session_id, document_id) VALUES (?, ?)').run(session1Id, doc1Id);
  const q1 = db.prepare(`
    INSERT INTO questions (quiz_id, section_id, question_text, question_type, correct_answer, options_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(quiz1.lastInsertRowid, sec3.id, 'According to Section 3, which consensus algorithm prioritizes understandability over Paxos?', 'mcq', 'Raft', JSON.stringify(['Raft', 'Paxos', 'FLP', 'Byzantine']));
  const q2 = db.prepare(`
    INSERT INTO questions (quiz_id, section_id, question_text, question_type, correct_answer, options_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(quiz1.lastInsertRowid, sec3.id, 'Complete the sentence: "An entry is committed in Raft once replicated across a _______ of nodes."', 'cloze_mcq', 'majority', JSON.stringify(['majority', 'minority', 'cluster', 'unanimity']));

  const attempt1 = db.prepare(`
    INSERT INTO quiz_attempts (quiz_id, user_id, score, total_questions) VALUES (?, ?, ?, ?)
  `).run(quiz1.lastInsertRowid, studentId, 2, 2);

  db.prepare('INSERT INTO question_responses (attempt_id, question_id, selected_answer, is_correct) VALUES (?, ?, ?, ?)')
    .run(attempt1.lastInsertRowid, q1.lastInsertRowid, 'Raft', 1);
  db.prepare('INSERT INTO question_responses (attempt_id, question_id, selected_answer, is_correct) VALUES (?, ?, ?, ?)')
    .run(attempt1.lastInsertRowid, q2.lastInsertRowid, 'majority', 1);

  // Session 2: Document 2 (Virtual Memory) -> Has Skimmed section, Genuinely Read, and Reread
  const doc2Id = createdDocIds[1];
  const doc2Sections = db.prepare('SELECT * FROM sections WHERE document_id = ? ORDER BY section_number ASC').all(doc2Id);

  const session2Res = db.prepare(`
    INSERT INTO reading_sessions (user_id, document_id, start_time, end_time, status)
    VALUES (?, ?, datetime('now', '-1 day'), datetime('now', '-1 day', '+15 minutes'), 'completed')
  `).run(studentId, doc2Id);
  const session2Id = session2Res.lastInsertRowid;

  // Sec 1: Read, Sec 2: Skimmed, Sec 3: Reread, Sec 4: Read
  db.prepare(`
    INSERT INTO classifications (session_id, section_id, status, dwell_time_seconds, relative_scroll_speed, backtrack_count, explanation)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(session2Id, doc2Sections[0].id, 'Genuinely Read', 42.0, 0.48, 0, 'Dwell time of 42.0s met expected range (>= 16.0s for 125 words).');

  db.prepare(`
    INSERT INTO classifications (session_id, section_id, status, dwell_time_seconds, relative_scroll_speed, backtrack_count, explanation)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(session2Id, doc2Sections[1].id, 'Skimmed', 5.1, 2.80, 0, 'Dwell time of 5.1s was below expected minimum of 18.0s for 140 words, and relative scroll speed (2.80x) exceeded threshold.');

  db.prepare(`
    INSERT INTO classifications (session_id, section_id, status, dwell_time_seconds, relative_scroll_speed, backtrack_count, explanation)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(session2Id, doc2Sections[2].id, 'Reread', 55.0, 0.50, 1, 'Revisited section with 55.0s cumulative dwell and 22.0s revisit dwell.');

  db.prepare(`
    INSERT INTO classifications (session_id, section_id, status, dwell_time_seconds, relative_scroll_speed, backtrack_count, explanation)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(session2Id, doc2Sections[3].id, 'Genuinely Read', 38.0, 0.55, 0, 'Dwell time of 38.0s met expected range for 110 words.');

  console.log('[Demo] Successfully seeded demo student and historical reading sessions.');
  console.log('[Demo] Demo credentials:');
  console.log('       Student: demo@ghostread.app / demo1234');
  console.log('       Admin:   admin@ghostread.app / admin1234');
}

if (require.main === module) {
  seedDemoData().then(() => {
    process.exit(0);
  }).catch(err => {
    console.error('Error generating demo data:', err);
    process.exit(1);
  });
}

module.exports = { seedDemoData };
