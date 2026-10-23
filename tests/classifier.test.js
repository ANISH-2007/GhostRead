const { describe, it } = require('node:test');
const assert = require('node:assert');
const { classifySection } = require('../server/classifier');

describe('Comprehension Classifier (REQ-3.1 to REQ-3.4)', () => {
  const sampleThresholds = {
    reading_speed: { words_per_second: 3.5 },
    dwell_time: { min_dwell_fraction: 0.40, min_absolute_dwell_seconds: 2.0 },
    scroll_speed: { max_reading_speed_px_sec: 350.0, relative_speed_skim_threshold: 1.25 },
    reread: { min_backtrack_dwell_seconds: 4.0, min_passes: 2 },
    edge_cases: { min_words_for_text_page: 25, image_or_diagram_dwell_min_seconds: 3.0 }
  };

  it('REQ-3.1: classifies as Skimmed when relative scroll speed is high and dwell is below minimum', () => {
    // 140 words -> expected reading time = 140 / 3.5 = 40.0s. Min dwell = 40 * 0.4 = 16.0s.
    // Actual dwell: 4.5s (< 16.0s), relative speed: 2.1x (> 1.25x)
    const section = { id: 10, section_number: 1, word_count: 140, estimated_read_time: 40.0 };
    const metrics = {
      dwell_time_seconds: 4.5,
      scroll_speed_px_per_sec: 600.0,
      relative_scroll_speed: 2.1,
      backtrack_count: 0,
      passes: 1
    };

    const result = classifySection(section, metrics, sampleThresholds);
    assert.strictEqual(result.status, 'Skimmed');
    assert.ok(result.explanation.includes('below the expected minimum'));
  });

  it('REQ-3.2: classifies as Genuinely Read when dwell time and scroll pattern are within expected range', () => {
    // 140 words -> expected min dwell = 16.0s.
    // Actual dwell: 35.0s, relative speed: 0.55x (< 1.25x)
    const section = { id: 11, section_number: 2, word_count: 140, estimated_read_time: 40.0 };
    const metrics = {
      dwell_time_seconds: 35.0,
      scroll_speed_px_per_sec: 120.0,
      relative_scroll_speed: 0.55,
      backtrack_count: 0,
      passes: 1
    };

    const result = classifySection(section, metrics, sampleThresholds);
    assert.strictEqual(result.status, 'Genuinely Read');
    assert.ok(result.explanation.includes('met expected reading range'));
  });

  it('REQ-3.3: classifies as Reread when student revisits after initial pass with above-threshold second-pass dwell', () => {
    // Revisited in pass 2 with 15s second-pass dwell (>= 4.0s threshold)
    const section = { id: 12, section_number: 3, word_count: 120, estimated_read_time: 34.0 };
    const metrics = {
      dwell_time_seconds: 45.0,
      scroll_speed_px_per_sec: 110.0,
      relative_scroll_speed: 0.48,
      backtrack_count: 1,
      passes: 2,
      pass_dwells: [30.0, 15.0]
    };

    const result = classifySection(section, metrics, sampleThresholds);
    assert.strictEqual(result.status, 'Reread');
    assert.ok(result.explanation.includes('Revisited section across 2 passes'));
  });

  it('Edge case: empty page (0 words) viewed briefly is classified appropriately', () => {
    const emptySection = { id: 13, section_number: 4, word_count: 0, estimated_read_time: 1.0 };
    
    // Viewed for 4 seconds (>= 3.0s diagram/low-text minimum)
    const resSlow = classifySection(emptySection, { dwell_time_seconds: 4.0, relative_scroll_speed: 0.2 }, sampleThresholds);
    assert.strictEqual(resSlow.status, 'Genuinely Read');

    // Skipped in 0.5s (< 3.0s)
    const resFast = classifySection(emptySection, { dwell_time_seconds: 0.5, relative_scroll_speed: 3.0 }, sampleThresholds);
    assert.strictEqual(resFast.status, 'Skimmed');
  });

  it('Edge case: low-text diagram or title page (<25 words)', () => {
    const diagramSection = { id: 14, section_number: 5, word_count: 12, estimated_read_time: 3.4 };
    
    // Inspected diagram for 5.0 seconds
    const res = classifySection(diagramSection, { dwell_time_seconds: 5.0, relative_scroll_speed: 0.4 }, sampleThresholds);
    assert.strictEqual(res.status, 'Genuinely Read');
    assert.ok(res.explanation.includes('Visual/low-text section'));
  });
});
