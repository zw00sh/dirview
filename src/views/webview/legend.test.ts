// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderLegend } from './index';

import './test-helpers';

// --- renderLegend ---
describe('renderLegend', () => {
  function makeStats() {
    return [
      { name: 'TypeScript', color: '#3178c6', count: 3, pct: '75.0' },
      { name: 'CSS', color: '#563d7c', count: 1, pct: '25.0' },
    ];
  }

  it('shows raw counts by default', () => {
    const el = document.createElement('div');
    renderLegend(el, makeStats(), new Set(), () => {}, false);
    const counts = el.querySelectorAll('.legend-count');
    expect(counts[0].textContent).toBe('3');
    expect(counts[1].textContent).toBe('1');
  });

  it('shows percentages when showPct is true', () => {
    const el = document.createElement('div');
    renderLegend(el, makeStats(), new Set(), () => {}, true);
    const counts = el.querySelectorAll('.legend-count');
    expect(counts[0].textContent).toBe('75.0%');
    expect(counts[1].textContent).toBe('25.0%');
  });

  it('shows raw counts when showPct is false', () => {
    const el = document.createElement('div');
    renderLegend(el, makeStats(), new Set(), () => {}, false);
    const counts = el.querySelectorAll('.legend-count');
    expect(counts[0].textContent).toBe('3');
    expect(counts[1].textContent).toBe('1');
  });
});
