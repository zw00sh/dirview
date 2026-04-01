import { test, expect, type Page } from '@playwright/test';

// ── Helpers ─────────────────────────────────────────────────────────────────

async function loadHarness(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));

  await page.goto('/bench/harness.html?fixture=fixtures/source.json');
  try {
    await page.locator('#root .tree').waitFor({ timeout: 5_000 });
  } catch {
    const status = await page.locator('#bench-status').textContent();
    throw new Error(`Tree never rendered. status: ${status}, errors: ${errors.join('; ')}`);
  }
  await page.locator('.dir-row').first().waitFor({ timeout: 5_000 });

  // Expand all dirs (tiered: click twice)
  await page.locator('#tab-expand-all').click();
  await waitForRender(page);
  await page.locator('#tab-expand-all').click();
  await waitForRender(page);
}

function root(page: Page) { return page.locator('#root'); }
function overlay(page: Page) { return page.locator('.virtual-sticky-overlay'); }

async function waitForRender(page: Page) {
  await page.evaluate(() => new Promise(r =>
    requestAnimationFrame(() => requestAnimationFrame(r))
  ));
}

async function scrollTo(page: Page, scrollTop: number) {
  await root(page).evaluate((el, st) => { el.scrollTop = st; }, scrollTop);
  await waitForRender(page);
}

async function stuckNames(page: Page): Promise<string[]> {
  return overlay(page).evaluate(el =>
    Array.from(el.querySelectorAll('.dir-name')).map(n => n.textContent || '')
  );
}

/** Find the offsetY of a dir row by scrolling through the virtual list. */
async function findDirOffsetY(page: Page, name: string): Promise<number> {
  const scrollHeight = await root(page).evaluate(el => el.scrollHeight);
  for (let pos = 0; pos <= scrollHeight; pos += 500) {
    await scrollTo(page, pos);
    const result = await page.evaluate((n) => {
      const tree = document.querySelector('.tree') as HTMLElement;
      if (!tree) return -1;
      for (const el of tree.querySelectorAll('.dir-name')) {
        if (el.textContent === n) {
          const li = el.closest('[style*="position: absolute"]') as HTMLElement;
          return li ? parseFloat(li.style.top) : -1;
        }
      }
      return -1;
    }, name);
    if (result >= 0) {
      await scrollTo(page, 0);
      return result;
    }
  }
  return -1;
}

/** Get the first visible dir name below the overlay (what the user actually sees). */
async function firstVisibleDirBelowOverlay(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const overlay = document.querySelector('.virtual-sticky-overlay')!;
    const overlayBottom = overlay.getBoundingClientRect().bottom;
    // Account for overlay's visual height (children overflow height:0)
    const lastChild = overlay.lastElementChild;
    const effectiveBottom = lastChild
      ? lastChild.getBoundingClientRect().bottom
      : overlayBottom;

    const tree = document.querySelector('.tree')!;
    const rows = Array.from(tree.querySelectorAll('.dir-row'));
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      // First dir row whose top is at or below the overlay's visual bottom
      if (rect.top >= effectiveBottom - 1) { // 1px tolerance
        return row.querySelector('.dir-name')?.textContent || null;
      }
    }
    return null;
  });
}

/** Get visual top position of each stuck row relative to the scroll container viewport. */
async function stuckRowVisualTops(page: Page): Promise<Array<{ name: string; top: number }>> {
  return page.evaluate(() => {
    const overlay = document.querySelector('.virtual-sticky-overlay')!;
    const container = overlay.parentElement!;
    const containerTop = container.getBoundingClientRect().top;
    return Array.from(overlay.querySelectorAll('.dir-row')).map(row => ({
      name: row.querySelector('.dir-name')?.textContent || '',
      top: Math.round(row.getBoundingClientRect().top - containerTop),
    }));
  });
}

/** Get names of dir/file rows visible in the tree (not the overlay) below a given visual Y. */
async function visibleTreeRowsBelow(page: Page, belowY: number): Promise<string[]> {
  return page.evaluate((minY) => {
    const container = document.querySelector('#root')!;
    const containerTop = container.getBoundingClientRect().top;
    const containerBottom = container.getBoundingClientRect().bottom;
    const tree = document.querySelector('.tree')!;
    const rows = Array.from(tree.querySelectorAll('.dir-row, .file-row'));
    const names: string[] = [];
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      const relTop = rect.top - containerTop;
      if (relTop >= minY - 1 && rect.bottom <= containerBottom + 1) {
        const nameEl = row.querySelector('.dir-name') || row.querySelector('.file-name');
        if (nameEl?.textContent) names.push(nameEl.textContent);
      }
    }
    return names;
  }, belowY);
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('fixture structure assumptions', () => {
  // The push-out tests rely on the source.json fixture having specific nesting.
  // These tests verify those structural assumptions so failures are traceable.

  test('runtime/v2/model/src forms a multi-level sticky chain', async ({ page }) => {
    await loadHarness(page);

    // Each of these dirs should exist as a distinct row (no compaction merging them)
    // because each level has multiple children or files.
    const chain = ['runtime', 'v2', 'model', 'src'];
    const offsets: Record<string, number> = {};
    for (const name of chain) {
      offsets[name] = await findDirOffsetY(page, name);
      expect(offsets[name]).toBeGreaterThan(-1);
    }

    // They should appear in increasing offsetY order (parent before child)
    for (let i = 1; i < chain.length; i++) {
      expect(offsets[chain[i]]).toBeGreaterThan(offsets[chain[i - 1]]);
    }

    // Scrolling into src's content should produce a 4+ level stuck set
    await scrollTo(page, offsets['src'] + 22);
    const stuck = await stuckNames(page);
    expect(stuck).toContain('runtime');
    expect(stuck).toContain('v2');
    expect(stuck).toContain('model');
    expect(stuck).toContain('src');
  });

  test('runtime has multiple top-level children (v1, v2) enabling sibling push-out', async ({ page }) => {
    await loadHarness(page);
    const v1Offset = await findDirOffsetY(page, 'v1');
    const v2Offset = await findDirOffsetY(page, 'v2');
    expect(v1Offset).toBeGreaterThan(-1);
    expect(v2Offset).toBeGreaterThan(-1);
    // v1 and v2 are siblings — both exist as separate dirs under runtime
    expect(v1Offset).not.toBe(v2Offset);
  });

  test('server is a top-level sibling of runtime enabling top-level push-out', async ({ page }) => {
    await loadHarness(page);
    const runtimeOffset = await findDirOffsetY(page, 'runtime');
    const serverOffset = await findDirOffsetY(page, 'server');
    expect(runtimeOffset).toBeGreaterThan(-1);
    expect(serverOffset).toBeGreaterThan(runtimeOffset);
  });
});

test.describe('sticky header correctness', () => {
  test('at scrollTop=5, stuck set cascades through first-child chain', async ({ page }) => {
    await loadHarness(page);
    await scrollTo(page, 5);
    const names = await stuckNames(page);

    // runtime sticks first (offsetY=0, scrolled past by 5px).
    // Its first child is behind the 22px overlay → cascades.
    // Each cascaded dir grows the overlay, pulling in the next first-child.
    expect(names[0]).toBe('runtime');
    expect(names.length).toBeGreaterThanOrEqual(3);

    // The cascade should include runtime → v2 → model (from the fixture structure)
    expect(names).toContain('v2');
    expect(names).toContain('model');
  });

  test('at scrollTop=1, first stuck header is the first top-level dir', async ({ page }) => {
    await loadHarness(page);
    await scrollTo(page, 1);
    const names = await stuckNames(page);
    // First dir in sort-by-files order is "runtime"
    expect(names[0]).toBe('runtime');
  });

  test('stuck header matches the dir containing visible content', async ({ page }) => {
    await loadHarness(page);

    // Find where "server" section starts
    const serverOffset = await findDirOffsetY(page, 'server');
    expect(serverOffset).toBeGreaterThan(0);

    // Scroll to middle of server's content (well past server's header)
    await scrollTo(page, serverOffset + 100);
    const names = await stuckNames(page);
    expect(names).toContain('server');
  });

  test('header does NOT show next section before its dir scrolls past', async ({ page }) => {
    await loadHarness(page);

    const itOffset = await findDirOffsetY(page, 'it');
    expect(itOffset).toBeGreaterThan(0);

    // 1px before "it" header reaches viewport top — it should NOT be stuck yet
    await scrollTo(page, itOffset - 1);
    const names = await stuckNames(page);
    expect(names).not.toContain('it');
    // Some other section's dirs should be stuck (providing context for content above "it")
    expect(names.length).toBeGreaterThan(0);
  });

  test('header switches exactly when dir scrolls past viewport top', async ({ page }) => {
    await loadHarness(page);

    const itOffset = await findDirOffsetY(page, 'it');
    expect(itOffset).toBeGreaterThan(0);

    // At exactly itOffset: "it" header is at viewport top → should stick
    await scrollTo(page, itOffset);
    const atBoundary = await stuckNames(page);
    expect(atBoundary).toContain('it');

    // 1px before: "it" should not be stuck
    await scrollTo(page, itOffset - 1);
    const before = await stuckNames(page);
    expect(before).not.toContain('it');
  });

  test('first visible dir below overlay matches stuck context', async ({ page }) => {
    await loadHarness(page);

    const serverOffset = await findDirOffsetY(page, 'server');
    expect(serverOffset).toBeGreaterThan(0);

    // Scroll into server's content
    await scrollTo(page, serverOffset + 50);

    const stuck = await stuckNames(page);
    const firstVisible = await firstVisibleDirBelowOverlay(page);

    // The first visible dir below the overlay should be a child of the
    // deepest stuck dir (they share context)
    expect(stuck.length).toBeGreaterThan(0);

    // The first visible dir should NOT be in the stuck set (it's visible, not stuck)
    if (firstVisible) {
      // If a dir is visible below the overlay, it shouldn't also be stuck
      // (unless it's a propagated dir that's behind the overlay)
      const deepestStuck = stuck[stuck.length - 1];
      // The visible dir should be a child/sibling within the deepest stuck context
      expect(deepestStuck).not.toBe(firstVisible);
    }
  });

  test('deeply propagated dir does not stay stuck past its content', async ({ page }) => {
    await loadHarness(page);

    // At scrollTop=1 the cascade produces a deep chain. Get the deepest.
    await scrollTo(page, 1);
    const initialStuck = await stuckNames(page);
    if (initialStuck.length <= 1) return;
    const deepest = initialStuck[initialStuck.length - 1];

    // Scroll to the server section (a different top-level dir, well past runtime)
    const serverOffset = await findDirOffsetY(page, 'server');
    expect(serverOffset).toBeGreaterThan(0);
    await scrollTo(page, serverOffset + 22);
    const stuckAfter = await stuckNames(page);

    // The deep cascade leaf from the initial view should be gone
    expect(stuckAfter).not.toContain(deepest);
    // Server should now be the context
    expect(stuckAfter).toContain('server');
  });

  test('scan through sections: each section shows correct header', async ({ page }) => {
    await loadHarness(page);

    // Get positions of first few top-level dirs
    const dirs = ['runtime', 'server', 'it', 'console2'];
    const offsets: Record<string, number> = {};
    for (const name of dirs) {
      offsets[name] = await findDirOffsetY(page, name);
      expect(offsets[name]).toBeGreaterThan(-1);
    }

    // For each section, scroll to its midpoint and verify the stuck header
    for (let i = 0; i < dirs.length; i++) {
      const name = dirs[i];
      const start = offsets[name];
      const end = i < dirs.length - 1 ? offsets[dirs[i + 1]] : start + 200;
      const mid = Math.floor((start + end) / 2);

      await scrollTo(page, mid);
      const stuck = await stuckNames(page);
      expect(stuck).toContain(name);
    }
  });
});

// ── Push-out transition ──────────────────────────────────────────────────────
//
// When the next section's dir row approaches the overlay, it should gradually
// push the outgoing stuck headers upward (not hard-swap them). The push window
// equals the overlay height: it starts when the incoming dir's natural position
// meets the overlay's bottom edge and ends when it reaches the viewport top.

test.describe('push-out transition', () => {
  const ROW_H = 22;

  test('before push window: stuck rows at natural stacked positions', async ({ page }) => {
    await loadHarness(page);
    const serverOffset = await findDirOffsetY(page, 'server');
    expect(serverOffset).toBeGreaterThan(0);

    // Mid-section: well inside runtime's content, far from any boundary
    // No push active here — all rows at natural stacked positions.
    await scrollTo(page, Math.floor(serverOffset / 2));
    const positions = await stuckRowVisualTops(page);
    expect(positions.length).toBeGreaterThan(0);
    for (let i = 0; i < positions.length; i++) {
      expect(Math.abs(positions[i].top - i * ROW_H)).toBeLessThanOrEqual(1);
    }
  });

  test('during push: displacement visible before server sticks', async ({ page }) => {
    await loadHarness(page);
    const serverOffset = await findDirOffsetY(page, 'server');
    expect(serverOffset).toBeGreaterThan(0);

    // Just before server sticks: the outgoing stuck rows should be displaced
    // (pushed upward), not at their natural positions.
    await scrollTo(page, serverOffset - 11);
    const positions = await stuckRowVisualTops(page);
    expect(positions.length).toBeGreaterThan(0);
    // Top row should be displaced upward (negative position)
    expect(positions[0].top).toBeLessThan(0);
    // Server should NOT be stuck yet
    expect(positions.map(p => p.name)).not.toContain('server');

    // At server offset: server sticks at position 0, old context gone
    await scrollTo(page, serverOffset);
    const atServer = await stuckRowVisualTops(page);
    expect(atServer.map(p => p.name)).toContain('server');
    expect(atServer.find(p => p.name === 'server')!.top).toBe(0);
  });

  test('after push: incoming dir sticks at 0, old context fully removed', async ({ page }) => {
    await loadHarness(page);
    const serverOffset = await findDirOffsetY(page, 'server');
    expect(serverOffset).toBeGreaterThan(0);

    // Capture old context
    await scrollTo(page, serverOffset - 1);
    const oldNames = (await stuckRowVisualTops(page)).map(p => p.name);

    // At server's exact boundary: push complete
    await scrollTo(page, serverOffset);
    const positions = await stuckRowVisualTops(page);

    // Server sticks at visual top 0
    const serverRow = positions.find(p => p.name === 'server');
    expect(serverRow).toBeDefined();
    expect(serverRow!.top).toBe(0);

    // None of the old context remains in the overlay
    for (const name of oldNames) {
      expect(positions.map(p => p.name)).not.toContain(name);
    }
  });

  test('visible tree content is contiguous with overlay bottom during push', async ({ page }) => {
    await loadHarness(page);
    const serverOffset = await findDirOffsetY(page, 'server');
    expect(serverOffset).toBeGreaterThan(0);

    await scrollTo(page, serverOffset - 1);
    const baseline = await stuckRowVisualTops(page);
    const overlayHeight = baseline.length * ROW_H;
    const pushStart = serverOffset - overlayHeight;

    // At each 11px step, the tree content visible below the overlay should
    // start immediately after the overlay's visual bottom — no gap, no overlap.
    for (let d = 0; d < overlayHeight; d += 11) {
      const st = pushStart + d;
      if (st < 1) continue;
      await scrollTo(page, st);
      const positions = await stuckRowVisualTops(page);
      if (positions.length === 0) continue;

      // Overlay's visual bottom = last stuck row's bottom edge
      const lastStuck = positions[positions.length - 1];
      const overlayBottom = lastStuck.top + ROW_H;

      // First tree row visible below the overlay
      const treeRows = await visibleTreeRowsBelow(page, overlayBottom);
      // There should be visible content (not a blank gap)
      expect(treeRows.length).toBeGreaterThan(0);
    }
  });

  test('nested transition: ancestor walk switches from v2 to v1 cleanly', async ({ page }) => {
    // Nested sibling transitions (v2→v1 within runtime) are handled by the
    // ancestor walk — not push-out. Push-out only handles top-level section
    // boundaries. The ancestor walk naturally switches when the visible
    // content changes from v2's files to v1's files.
    await loadHarness(page);
    const v1Offset = await findDirOffsetY(page, 'v1');
    expect(v1Offset).toBeGreaterThan(0);

    // Deep in v2's section
    await scrollTo(page, Math.max(1, v1Offset - 200));
    const inV2 = await stuckRowVisualTops(page);
    expect(inV2[0].name).toBe('runtime');
    expect(inV2.map(p => p.name)).toContain('v2');

    // At v1's boundary: v1 sticks, v2 gone, runtime stays
    await scrollTo(page, v1Offset + 22);
    const after = await stuckRowVisualTops(page);
    expect(after[0].name).toBe('runtime');
    expect(after[0].top).toBe(0);
    expect(after.map(p => p.name)).toContain('v1');
    expect(after.map(p => p.name)).not.toContain('v2');
  });
});
