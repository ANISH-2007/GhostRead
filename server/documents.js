const fs = require('fs');
const path = require('path');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const db = require('./db');

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer storage config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, `${uniqueSuffix}-${safeName}`);
  }
});

// REQ-1.1: Max 20MB
// REQ-1.3: Reject non-PDF with clear, specific error message
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 20 * 1024 * 1024 // 20 MB in bytes
  },
  fileFilter: function (req, file, cb) {
    const isPdfMime = file.mimetype === 'application/pdf';
    const isPdfExt = path.extname(file.originalname).toLowerCase() === '.pdf';
    if (!isPdfMime && !isPdfExt) {
      const err = new Error('Invalid file format: Only PDF documents (.pdf) are supported.');
      err.code = 'INVALID_FILE_TYPE';
      return cb(err, false);
    }
    cb(null, true);
  }
});

function getThresholdConfig() {
  try {
    const configPath = path.join(__dirname, '..', 'config', 'thresholds.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading thresholds.json:', e.message);
  }
  return { reading_speed: { words_per_second: 3.5 } };
}

// Helper to extract pages using pdf-parse
async function extractPagesFromPdf(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const pageTexts = [];

  function customPageRender(pageData) {
    return pageData.getTextContent().then(function(textContent) {
      let lastY, text = '';
      for (let item of textContent.items) {
        if (lastY === item.transform[5] || !lastY) {
          text += item.str;
        } else {
          text += '\n' + item.str;
        }
        lastY = item.transform[5];
      }
      pageTexts.push({
        pageNumber: pageData.pageIndex + 1,
        text: text.trim()
      });
      return text;
    });
  }

  const pdfData = await pdfParse(dataBuffer, { pagerender: customPageRender });
  
  // Sort pages by pageNumber in ascending order
  pageTexts.sort((a, b) => a.pageNumber - b.pageNumber);
  
  // In case pdf-parse didn't trigger customPageRender for any reason (fallback)
  if (pageTexts.length === 0 && pdfData.numpages > 0) {
    // Fallback: split overall text evenly across numpages
    const allText = pdfData.text || '';
    const lines = allText.split('\n');
    const linesPerPage = Math.max(1, Math.ceil(lines.length / pdfData.numpages));
    for (let i = 1; i <= pdfData.numpages; i++) {
      const pageSlice = lines.slice((i - 1) * linesPerPage, i * linesPerPage).join('\n');
      pageTexts.push({ pageNumber: i, text: pageSlice.trim() });
    }
  }

  return {
    totalPages: pdfData.numpages || pageTexts.length || 1,
    pages: pageTexts
  };
}

// Handler for PDF Upload (REQ-1.1, REQ-1.2, REQ-1.3, REQ-1.4)
async function handleUpload(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Please choose a PDF document.' });
  }

  const filePath = req.file.path;
  const originalName = req.file.originalname;
  const fileSize = req.file.size;
  const userId = req.user.id;

  try {
    // REQ-1.2, REQ-1.4: Extract text and split by page
    const { totalPages, pages } = await extractPagesFromPdf(filePath);
    const thresholds = getThresholdConfig();
    const wordsPerSecond = thresholds.reading_speed?.words_per_second || 3.5;

    // Clean title from filename
    const title = originalName.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');

    const insertDoc = db.prepare(`
      INSERT INTO documents (user_id, title, file_name, file_path, file_size, total_pages)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertSection = db.prepare(`
      INSERT INTO sections (document_id, section_number, page_number, extracted_text, word_count, line_count, estimated_read_time)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = db.transaction(() => {
      const docResult = insertDoc.run(userId, title, req.file.filename, filePath, fileSize, totalPages);
      const documentId = docResult.lastInsertRowid;

      const createdSections = [];
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const sectionNumber = i + 1;
        const pageNumber = page.pageNumber || sectionNumber;
        const text = page.text || '';

        // Word and line calculations
        const words = text ? text.trim().split(/\s+/).filter(w => w.length > 0) : [];
        const wordCount = words.length;
        const lines = text ? text.split('\n').filter(l => l.trim().length > 0) : [];
        const lineCount = lines.length;
        const estimatedReadTime = wordCount > 0 ? parseFloat((wordCount / wordsPerSecond).toFixed(1)) : 1.0;

        const secResult = insertSection.run(
          documentId,
          sectionNumber,
          pageNumber,
          text,
          wordCount,
          lineCount,
          estimatedReadTime
        );

        createdSections.push({
          id: secResult.lastInsertRowid,
          document_id: documentId,
          section_number: sectionNumber,
          page_number: pageNumber,
          word_count: wordCount,
          line_count: lineCount,
          estimated_read_time: estimatedReadTime
        });
      }

      return { documentId, title, totalPages, sections: createdSections };
    })();

    return res.status(201).json({
      message: 'PDF uploaded and parsed successfully into sections.',
      document: {
        id: result.documentId,
        title: result.title,
        file_name: req.file.filename,
        original_name: originalName,
        file_size: fileSize,
        total_pages: result.totalPages,
        sections: result.sections
      }
    });

  } catch (error) {
    console.error('Error processing uploaded PDF:', error);
    // Cleanup uploaded file if parsing fails
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (_) {}
    }
    return res.status(500).json({ error: 'Failed to parse PDF document. The file may be corrupted or password-protected.' });
  }
}

// Get user documents
function listDocuments(req, res) {
  const userId = req.user.id;
  const docs = db.prepare(`
    SELECT d.*, 
      COUNT(DISTINCT s.id) as section_count,
      (SELECT COUNT(DISTINCT rs.id) FROM reading_sessions rs WHERE rs.document_id = d.id) as session_count
    FROM documents d
    LEFT JOIN sections s ON s.document_id = d.id
    WHERE d.user_id = ?
    GROUP BY d.id
    ORDER BY d.upload_date DESC
  `).all(userId);

  return res.json({ documents: docs });
}

// Get specific document by ID with sections
function getDocument(req, res) {
  const userId = req.user.id;
  const docId = req.params.id;

  const doc = db.prepare(`
    SELECT * FROM documents WHERE id = ? AND user_id = ?
  `).get(docId, userId);

  if (!doc) {
    return res.status(404).json({ error: 'Document not found or access denied.' });
  }

  const sections = db.prepare(`
    SELECT id, document_id, section_number, page_number, word_count, line_count, estimated_read_time,
           substr(extracted_text, 1, 300) as preview_text
    FROM sections
    WHERE document_id = ?
    ORDER BY section_number ASC
  `).all(docId);

  return res.json({ document: doc, sections });
}

// Stream PDF file for PDF.js viewer
function getPdfFile(req, res) {
  const userId = req.user.id;
  const docId = req.params.id;

  const doc = db.prepare(`
    SELECT file_path, file_name FROM documents WHERE id = ? AND user_id = ?
  `).get(docId, userId);

  if (!doc || !fs.existsSync(doc.file_path)) {
    return res.status(404).json({ error: 'File not found on server.' });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${doc.file_name}"`);
  const stream = fs.createReadStream(doc.file_path);
  stream.pipe(res);
}

// Delete document
function deleteDocument(req, res) {
  const userId = req.user.id;
  const docId = req.params.id;

  const doc = db.prepare('SELECT file_path FROM documents WHERE id = ? AND user_id = ?').get(docId, userId);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }

  if (fs.existsSync(doc.file_path)) {
    try { fs.unlinkSync(doc.file_path); } catch (_) {}
  }

  db.prepare('DELETE FROM documents WHERE id = ?').run(docId);
  return res.json({ message: 'Document deleted successfully' });
}

module.exports = {
  upload,
  handleUpload,
  listDocuments,
  getDocument,
  getPdfFile,
  deleteDocument,
  extractPagesFromPdf
};
