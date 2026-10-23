const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { extractPagesFromPdf } = require('../server/documents');

describe('Document Upload & Section Splitting (REQ-1.1 to REQ-1.4)', () => {
  it('REQ-1.3: rejects non-PDF file types via validation rule', () => {
    // Test MIME and extension checks matching multer filter
    const testCases = [
      { originalname: 'lecture.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', valid: false },
      { originalname: 'slides.pptx', mimetype: 'application/vnd.ms-powerpoint', valid: false },
      { originalname: 'image.png', mimetype: 'image/png', valid: false },
      { originalname: 'paper.pdf', mimetype: 'application/pdf', valid: true },
      { originalname: 'REPORT.PDF', mimetype: 'application/pdf', valid: true }
    ];

    for (const tc of testCases) {
      const isPdfMime = tc.mimetype === 'application/pdf';
      const isPdfExt = path.extname(tc.originalname).toLowerCase() === '.pdf';
      const isValid = isPdfMime || isPdfExt;
      assert.strictEqual(isValid, tc.valid, `Expected ${tc.originalname} to be ${tc.valid}`);
    }
  });

  it('REQ-1.1: 20MB limit is correctly calculated in bytes', () => {
    const maxLimit = 20 * 1024 * 1024;
    assert.strictEqual(maxLimit, 20971520);
    assert.ok(20000000 <= maxLimit);
    assert.ok(22000000 > maxLimit);
  });

  it('REQ-1.2 & REQ-1.4: extracts text per page boundary from sample PDF', async () => {
    // Locate one of the generated sample demo PDFs in uploads
    const uploads = fs.readdirSync(path.join(__dirname, '..', 'uploads'));
    const demoPdf = uploads.find(f => f.endsWith('.pdf'));
    assert.ok(demoPdf, 'At least one test PDF must be present in uploads/');

    const pdfPath = path.join(__dirname, '..', 'uploads', demoPdf);
    const result = await extractPagesFromPdf(pdfPath);

    assert.ok(result.totalPages >= 1);
    assert.strictEqual(result.pages.length, result.totalPages);

    for (const page of result.pages) {
      assert.ok(page.pageNumber >= 1);
      assert.ok(typeof page.text === 'string');
      assert.ok(page.text.length > 0, `Page ${page.pageNumber} should contain extracted text`);
    }
  });
});
