'use strict';

// These pure functions run identically in unit tests and in the offline report.
function createChartTools() {
  function segments(entries, identity, field, fallbackInterval) {
    const result = [];
    let segment = [];
    let previous = null;
    for (const entry of entries) {
      const process = entry.processes.find((item) => item.id === identity) ||
        (entry.sample?.id === identity ? entry.sample : null);
      const interval = entry.sampleIntervalSeconds || fallbackInterval;
      const value = process?.[field];
      if (!Number.isFinite(value) || (previous !== null && entry.at - previous > interval * 2500)) {
        if (segment.length) result.push(segment);
        segment = [];
      }
      if (Number.isFinite(value)) segment.push({ at: entry.at, value });
      previous = entry.at;
    }
    if (segment.length) result.push(segment);
    return result;
  }

  function thinSegment(points, limit = 1000) {
    if (points.length <= limit || limit < 4) return points;
    const selected = new Set([0, points.length - 1]);
    const buckets = Math.max(1, Math.floor((limit - 2) / 2));
    for (let bucket = 0; bucket < buckets; bucket++) {
      const start = 1 + Math.floor(bucket * (points.length - 2) / buckets);
      const end = 1 + Math.floor((bucket + 1) * (points.length - 2) / buckets);
      let low = start;
      let high = start;
      for (let index = start + 1; index < end; index++) {
        if (points[index].value < points[low].value) low = index;
        if (points[index].value > points[high].value) high = index;
      }
      selected.add(low); selected.add(high);
    }
    return [...selected].sort((left, right) => left - right).map((index) => points[index]);
  }

  return { segments, thinSegment };
}

module.exports = { createChartTools };
