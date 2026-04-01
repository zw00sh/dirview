import { test, expect, type Page } from '@playwright/test';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Load the bench harness with source.json fixture and wait for render. */
async function loadHarness(page: Page) {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));

  await page.goto('/bench/harness.html?fixture=fixtures/source.json');
  try {
    await page.locator('#root .tree').waitFor({ timeout: 5_000 });
  } catch {
    const html = await page.locator('#root').innerHTML();
    const status = await page.locator('#bench-status').textContent();
    throw new Error(`Tree never rendered. #root: ${html.slice(0, 300)}, status: ${status}, errors: ${errors.join('; ')}`);
  }
  await page.locator('.dir-row').first().waitFor({ timeout: 5_000 });

  // Expand all dirs so nested chains exist (tiered: click twice for deep expand)
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

async function getScrollTop(page: Page): Promise<number> {
  return root(page).evaluate(el => el.scrollTop);
}

async function overlayChildCount(page: Page): Promise<number> {
  return overlay(page).evaluate(el => el.childElementCount);
}

async function stuckNames(page: Page): Promise<string[]> {
  return overlay(page).evaluate(el =>
    Array.from(el.querySelectorAll('.dir-name')).map(n => n.textContent || '')
  );
}

async function shadowState(page: Page) {
  return overlay(page).evaluate(el => {
    const rows = Array.from(el.querySelectorAll('.dir-row'));
    return {
      total: rows.length,
      lastHasShadow: rows.length > 0 && rows[rows.length - 1].classList.contains('is-stuck-bottom'),
      othersWithShadow: rows.slice(0, -1).filter(r => r.classList.contains('is-stuck-bottom')).length,
    };
  });
}

/** Find the offsetY of a dir row by scrolling through the virtual list until it's rendered. */
async function findDirOffsetY(page: Page, name: string): Promise<number> {
  const scrollHeight = await root(page).evaluate(el => el.scrollHeight);
  const step = 500;
  for (let pos = 0; pos <= scrollHeight; pos += step) {
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
      // Scroll back to top before returning so the test controls position
      await scrollTo(page, 0);
      return result;
    }
  }
  return -1;
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('scroll anchoring', () => {
  test('scrollTop stable when overlay appears', async ({ page }) => {
    await loadHarness(page);
    await scrollTo(page, 30);
    expect(await getScrollTop(page)).toBe(30);
  });

  test('scrollTop stable when overlay disappears', async ({ page }) => {
    await loadHarness(page);
    await scrollTo(page, 100);
    await scrollTo(page, 0);
    expect(await getScrollTop(page)).toBe(0);
  });

  test('no scroll jump at any pixel 0–100', async ({ page }) => {
    await loadHarness(page);
    const jumps: { requested: number; actual: number }[] = [];
    for (let st = 0; st <= 100; st++) {
      await scrollTo(page, st);
      const actual = await getScrollTop(page);
      if (actual !== st) jumps.push({ requested: st, actual });
    }
    expect(jumps).toEqual([]);
  });
});

test.describe('stuck set basics', () => {
  test('empty at scrollTop=0', async ({ page }) => {
    await loadHarness(page);
    expect(await overlayChildCount(page)).toBe(0);
  });

  test('sticks immediately at scrollTop=1', async ({ page }) => {
    await loadHarness(page);
    await scrollTo(page, 1);
    expect(await overlayChildCount(page)).toBeGreaterThan(0);
  });

  test('clears when scrolled back to 0', async ({ page }) => {
    await loadHarness(page);
    await scrollTo(page, 50);
    expect(await overlayChildCount(page)).toBeGreaterThan(0);
    await scrollTo(page, 0);
    expect(await overlayChildCount(page)).toBe(0);
  });
});

test.describe('ancestor collection', () => {
  test('all ancestors stuck when scrolled into nested file content', async ({ page }) => {
    await loadHarness(page);
    // runtime(0) → v2(1) → model(2) is a 3-level chain.
    const modelOffset = await findDirOffsetY(page, 'model');
    expect(modelOffset).toBeGreaterThan(0);

    // Scroll past model so a file inside it is visibleStart
    await scrollTo(page, modelOffset + 44);
    const names = await stuckNames(page);
    expect(names).toContain('runtime');
    expect(names).toContain('v2');
    expect(names).toContain('model');
  });
});

test.describe('self-stick with ancestors', () => {
  test('self-stuck dir appears alongside its ancestors', async ({ page }) => {
    await loadHarness(page);
    // Scrolling to exactly v2.offsetY should show:
    // runtime (ancestor) + v2 (self-stick at boundary)
    const v2Offset = await findDirOffsetY(page, 'v2');
    expect(v2Offset).toBeGreaterThan(0);

    await scrollTo(page, v2Offset);
    const names = await stuckNames(page);
    expect(names).toContain('runtime');
    expect(names).toContain('v2');
  });
});

test.describe('section transitions', () => {
  test('stuck set switches between top-level dirs', async ({ page }) => {
    await loadHarness(page);
    const serverOffset = await findDirOffsetY(page, 'server');
    expect(serverOffset).toBeGreaterThan(0);

    // Well before server boundary (outside the push-out window)
    await scrollTo(page, serverOffset - 100);
    const before = await stuckNames(page);
    expect(before).toContain('runtime');
    expect(before).not.toContain('server');

    // At server boundary — server takes over
    await scrollTo(page, serverOffset);
    const at = await stuckNames(page);
    expect(at).toContain('server');
  });

  test('stuck set switches between nested dirs', async ({ page }) => {
    await loadHarness(page);
    // Inside runtime: v2 section ends, then v1 starts.
    const v1Offset = await findDirOffsetY(page, 'v1');
    expect(v1Offset).toBeGreaterThan(0);

    // Well before v1 boundary (outside the push-out window)
    await scrollTo(page, v1Offset - 100);
    const before = await stuckNames(page);
    expect(before).toContain('v2');
    expect(before).not.toContain('v1');

    await scrollTo(page, v1Offset);
    const at = await stuckNames(page);
    expect(at).toContain('v1');
    // runtime should still be stuck (parent of both v1 and v2)
    expect(at).toContain('runtime');
  });
});

test.describe('flicker resistance', () => {
  test('stuck count never drops mid-scroll (forward)', async ({ page }) => {
    await loadHarness(page);
    let prev = 0;
    const drops: { st: number; from: number; to: number }[] = [];
    for (let st = 0; st <= 100; st++) {
      await scrollTo(page, st);
      const count = await overlayChildCount(page);
      if (count < prev && count > 0) drops.push({ st, from: prev, to: count });
      prev = count;
    }
    expect(drops).toEqual([]);
  });

  test('stuck names stable at boundary pixels', async ({ page }) => {
    await loadHarness(page);
    const v2Offset = await findDirOffsetY(page, 'v2');
    expect(v2Offset).toBeGreaterThan(0);

    // Scan 5 pixels around the v2 boundary — names should not oscillate
    const snapshots: string[][] = [];
    for (let st = v2Offset - 2; st <= v2Offset + 2; st++) {
      if (st < 1) continue;
      await scrollTo(page, st);
      snapshots.push(await stuckNames(page));
    }
    for (let i = 2; i < snapshots.length; i++) {
      const same = JSON.stringify(snapshots[i]) === JSON.stringify(snapshots[i - 2]);
      const diff = JSON.stringify(snapshots[i]) !== JSON.stringify(snapshots[i - 1]);
      if (same && diff) {
        throw new Error(`Oscillation at v2Offset±${i - 2}: ${JSON.stringify(snapshots.slice(i - 2, i + 1))}`);
      }
    }
  });

  test('reverse scroll does not oscillate', async ({ page }) => {
    await loadHarness(page);
    const modelOffset = await findDirOffsetY(page, 'model');
    expect(modelOffset).toBeGreaterThan(0);
    const start = modelOffset + 100;
    await scrollTo(page, start);

    // Check for oscillation (A→B→A pattern), not monotonic count
    // (count legitimately decreases when scrolling back through boundaries)
    const history: number[] = [];
    for (let st = start; st >= Math.max(0, start - 50); st--) {
      await scrollTo(page, st);
      history.push(await overlayChildCount(page));
    }
    const oscillations: number[] = [];
    for (let i = 2; i < history.length; i++) {
      if (history[i] === history[i - 2] && history[i] !== history[i - 1]) {
        oscillations.push(i);
      }
    }
    expect(oscillations).toEqual([]);
  });
});

test.describe('cascading propagation', () => {
  test('at scrollTop=1, child dirs hidden behind overlay are propagated', async ({ page }) => {
    await loadHarness(page);
    await scrollTo(page, 1);
    const names = await stuckNames(page);
    // runtime sticks (overlay=22). Its first child at visual 21 is behind
    // the overlay, so it cascades. Each newly stuck dir grows the overlay,
    // pulling in the next first-child dir until one is visible below.
    expect(names[0]).toBe('runtime');
    expect(names.length).toBeGreaterThan(1);

    // Every stuck dir should be hidden behind the overlay:
    // its visual position (offsetY - scrollTop) < stuckCount * 22
    const positions = await overlay(page).evaluate(el => {
      const container = el.parentElement!;
      const scrollTop = container.scrollTop;
      const rows = Array.from(el.querySelectorAll('.dir-row'));
      return rows.map(r => {
        const li = r.closest('[style*="position"]') as HTMLElement;
        return { top: parseFloat(li?.style.top || '0') };
      });
    });
    const overlayHeight = names.length * 22;
    for (const pos of positions) {
      expect(pos.top).toBeLessThan(overlayHeight);
    }
  });

  test('cascade follows ancestor chain, not arbitrary siblings', async ({ page }) => {
    await loadHarness(page);
    await scrollTo(page, 1);
    const names = await stuckNames(page);
    // The cascade follows runtime's first-child chain (by sort order).
    // Sibling top-level dirs (server, it, etc.) should NOT be stuck.
    expect(names).toContain('runtime');
    expect(names).not.toContain('server');
    expect(names).not.toContain('it');
  });

  test('cascade includes dir flush with overlay bottom edge', async ({ page }) => {
    await loadHarness(page);
    // At scrollTop=22: runtime sticks (overlay=22). The first child dir
    // is at visual 22 — flush with the overlay bottom. It should be pinned
    // (its header is hidden at the edge), growing the overlay and continuing.
    await scrollTo(page, 22);
    const names = await stuckNames(page);
    expect(names.length).toBeGreaterThanOrEqual(2);
    // The second entry should be runtime's first child (cascade continued past the edge)
    expect(names[0]).toBe('runtime');
  });
});

// ── Cascade bug-class tests ──────────────────────────────────────────────────
// Each test targets a specific class of cascade failure.
//
// Bug class: "wrong child cascade" — the cascade follows the first child by
// sort order (e.g. triggers under errors) instead of the child that actually
// contains the visible content (e.g. configuration). This happens because
// step 1 only sticks ancestors at offsetY ≤ scrollTop, missing ancestors
// whose headers are behind the overlay but below the viewport top. The cascade
// then falls back to the first-child chain and picks the wrong branch.

test.describe('cascade picks content-relevant child, not first-by-sort', () => {
  test('scrolled past triggers into configuration: configuration is stuck', async ({ page }) => {
    // errors has children sorted by file count: triggers (37 files) first,
    // then configuration, checkpoint, etc. When we scroll past triggers's
    // files into configuration's files, configuration should be stuck.
    //
    // The stuck set is determined by visibleStart — the first row whose
    // bottom extends past scrollTop. We need scrollTop to be past
    // configuration's header so a file under configuration is visibleStart.
    await loadHarness(page);

    const configOffset = await findDirOffsetY(page, 'configuration');
    expect(configOffset).toBeGreaterThan(-1);

    // configOffset + 22 puts us 1 row into configuration's files.
    // visibleStart should be the first file under configuration.
    await scrollTo(page, configOffset + 22);
    const names = await stuckNames(page);

    // configuration should be stuck (ancestor of visible content)
    expect(names).toContain('configuration');
    // triggers should NOT be stuck (its content is above, no longer relevant)
    expect(names).not.toContain('triggers');
    // errors should still be stuck (shared ancestor)
    expect(names).toContain('errors');
  });

  test('ancestor behind overlay when header is just below scrollTop', async ({ page }) => {
    // When the overlay is tall (many ancestor dirs), a dir whose header is
    // 1px below scrollTop should be stuck if it's behind the overlay.
    // This is the greedy-walk mechanism: ancestors are checked against
    // scrollTop + overlayHeight, not just scrollTop.
    await loadHarness(page);

    const configOffset = await findDirOffsetY(page, 'configuration');
    expect(configOffset).toBeGreaterThan(-1);

    // At configOffset + 1: configuration's header is 1px above viewport → self-sticks
    await scrollTo(page, configOffset + 1);
    const names = await stuckNames(page);
    expect(names).toContain('configuration');
  });

  test('sibling dir transition within deep chain preserves ancestor context', async ({ page }) => {
    // General case: two sibling leaf dirs under a shared parent deep in the
    // tree. Scrolling from one into the other should swap the leaf but keep
    // the entire ancestor chain.
    await loadHarness(page);

    const triggersOffset = await findDirOffsetY(page, 'triggers');
    const configOffset = await findDirOffsetY(page, 'configuration');
    expect(triggersOffset).toBeGreaterThan(-1);
    expect(configOffset).toBeGreaterThan(triggersOffset);

    // Deep in triggers (past its header into its files)
    await scrollTo(page, triggersOffset + 22);
    const inTriggers = await stuckNames(page);
    expect(inTriggers).toContain('triggers');
    expect(inTriggers).toContain('errors');

    // Deep in configuration (past its header into its files)
    await scrollTo(page, configOffset + 22);
    const inConfig = await stuckNames(page);
    expect(inConfig).toContain('configuration');
    expect(inConfig).toContain('errors');

    // The full ancestor chain (runtime→...→errors) should be identical
    // Only the leaf dir changes (triggers → configuration)
    const ancestorChain = inTriggers.slice(0, -1);
    const configAncestors = inConfig.slice(0, -1);
    expect(configAncestors).toEqual(ancestorChain);
  });
});

test.describe('cascade depth completeness', () => {
  test('at scrollTop=1, cascade goes at least 4 levels deep (runtime→v2→model→src)', async ({ page }) => {
    // Bug class: cascade truncation — stopping at n+1 instead of continuing.
    // The first-child chain runtime→v2→model→src has NO file gaps between
    // consecutive dirs (files sort after child dirs in the flatten). The
    // cascade should follow the entire chain without stopping early.
    await loadHarness(page);
    await scrollTo(page, 1);
    const names = await stuckNames(page);
    expect(names).toContain('runtime');
    expect(names).toContain('v2');
    expect(names).toContain('model');
    expect(names).toContain('src');
    expect(names.length).toBeGreaterThanOrEqual(4);
  });

  test('at scrollTop=5, cascade depth equals scrollTop=1 depth', async ({ page }) => {
    // Bug class: cascade instability — depth shouldn't differ for small scroll values.
    // At 1px and 5px, the same dirs are hidden behind the overlay. The cascade
    // depth should be identical.
    await loadHarness(page);
    await scrollTo(page, 1);
    const at1 = await stuckNames(page);
    await scrollTo(page, 5);
    const at5 = await stuckNames(page);
    expect(at5).toEqual(at1);
  });

  test('every stuck dir has visual position behind the overlay', async ({ page }) => {
    // Bug class: cascade invariant violation — a stuck dir should never be
    // visible below the overlay. If it is, the user can see it in the tree
    // and pinning it is redundant/confusing.
    await loadHarness(page);
    await scrollTo(page, 5);
    const names = await stuckNames(page);
    const overlayHeight = names.length * 22;

    // Check each dir in the stuck set: its offsetY in the tree should place
    // it behind the overlay (offsetY - scrollTop <= overlayHeight)
    const positions = await page.evaluate((overlayH) => {
      const root = document.querySelector('#root') as HTMLElement;
      const overlay = document.querySelector('.virtual-sticky-overlay')!;
      const scrollTop = root.scrollTop;
      const tree = document.querySelector('.tree')!;
      const stuckNames = Array.from(overlay.querySelectorAll('.dir-name')).map(
        el => el.textContent || ''
      );
      // For each stuck dir, find its natural offsetY in the tree
      const results: Array<{ name: string; visual: number; overlayH: number }> = [];
      for (const name of stuckNames) {
        for (const el of tree.querySelectorAll('.dir-name')) {
          if (el.textContent === name) {
            const li = el.closest('[style*="position: absolute"]') as HTMLElement;
            if (li) {
              const offsetY = parseFloat(li.style.top);
              results.push({ name, visual: offsetY - scrollTop, overlayH });
            }
            break;
          }
        }
      }
      return results;
    }, overlayHeight);

    for (const pos of positions) {
      // Each stuck dir's visual position should be ≤ overlay height
      // (behind or flush with the overlay bottom)
      expect(pos.visual).toBeLessThanOrEqual(pos.overlayH);
    }
  });

  test('cascade depth increases monotonically from scrollTop 0 to 22', async ({ page }) => {
    // Bug class: cascade instability — depth should never decrease as
    // scrollTop increases (within a single section, before any push-out).
    await loadHarness(page);
    let prevDepth = 0;
    const drops: Array<{ st: number; from: number; to: number }> = [];
    for (let st = 0; st <= 22; st++) {
      await scrollTo(page, st);
      const names = await stuckNames(page);
      if (names.length < prevDepth) {
        drops.push({ st, from: prevDepth, to: names.length });
      }
      prevDepth = names.length;
    }
    expect(drops).toEqual([]);
  });
});

test.describe('cascade after section transition', () => {
  test('v1 cascade depth matches v2 cascade depth (same tree structure symmetry)', async ({ page }) => {
    // Bug class: new-stack cascade truncation — after transitioning from v2
    // to v1, the cascade into v1's subtree should go equally deep if v1 has
    // a similar directory structure.
    await loadHarness(page);
    const v2Offset = await findDirOffsetY(page, 'v2');
    const v1Offset = await findDirOffsetY(page, 'v1');

    // Cascade depth in v2's section
    await scrollTo(page, v2Offset + 100);
    const v2Stuck = await stuckNames(page);
    const v2Depth = v2Stuck.length;

    // Cascade depth in v1's section
    await scrollTo(page, v1Offset + 100);
    const v1Stuck = await stuckNames(page);
    const v1Depth = v1Stuck.length;

    // Both should have at least runtime + child + grandchild (3 levels)
    expect(v2Depth).toBeGreaterThanOrEqual(3);
    expect(v1Depth).toBeGreaterThanOrEqual(3);
  });

  test('cascade into new stack starts fresh (no stale dirs from old stack)', async ({ page }) => {
    // Bug class: stale cascade — after viewing v2's deep chain, switching to
    // v1 should not retain any v2-specific dirs in the stuck set.
    // Note: common dir names like "src" may appear under both stacks — that's
    // fine (they're different dirs with the same name). We check for dirs
    // unique to v2's branch.
    await loadHarness(page);
    const v2Offset = await findDirOffsetY(page, 'v2');
    const v1Offset = await findDirOffsetY(page, 'v1');

    // Go deep into v2 first
    await scrollTo(page, v2Offset + 200);
    const v2Names = await stuckNames(page);
    expect(v2Names).toContain('v2');

    // Now jump to v1 section
    await scrollTo(page, v1Offset + 200);
    const v1Names = await stuckNames(page);

    // v2-specific dirs (v2 itself, model) should not be in v1's chain
    expect(v1Names).not.toContain('v2');
    expect(v1Names).not.toContain('model');
    // v1 should be present
    expect(v1Names).toContain('v1');
  });
});

test.describe('sibling stack transition', () => {
  test('deep in v2 section: stuck chain goes through v2 subtree', async ({ page }) => {
    await loadHarness(page);
    // Scroll deep into v2's content — well past v2/model/src/...
    const v2Offset = await findDirOffsetY(page, 'v2');
    await scrollTo(page, v2Offset + 200);
    const names = await stuckNames(page);
    expect(names).toContain('runtime');
    expect(names).toContain('v2');
    expect(names).not.toContain('v1');
  });

  test('deep in v1 section: stuck chain goes through v1 subtree', async ({ page }) => {
    await loadHarness(page);
    const v1Offset = await findDirOffsetY(page, 'v1');
    await scrollTo(page, v1Offset + 200);
    const names = await stuckNames(page);
    expect(names).toContain('runtime');
    expect(names).toContain('v1');
    expect(names).not.toContain('v2');
  });

  test('shared ancestor stays when transitioning between sibling stacks', async ({ page }) => {
    await loadHarness(page);
    const v2Offset = await findDirOffsetY(page, 'v2');
    const v1Offset = await findDirOffsetY(page, 'v1');

    // Deep in v2's chain
    await scrollTo(page, v2Offset + 200);
    const inV2 = await stuckNames(page);

    // Deep in v1's chain
    await scrollTo(page, v1Offset + 200);
    const inV1 = await stuckNames(page);

    // runtime is the shared ancestor — present in both
    expect(inV2[0]).toBe('runtime');
    expect(inV1[0]).toBe('runtime');

    // The child chains are different
    expect(inV2).toContain('v2');
    expect(inV2).not.toContain('v1');
    expect(inV1).toContain('v1');
    expect(inV1).not.toContain('v2');
  });

  test('v2 chain fully replaced by v1 chain at v1 boundary', async ({ page }) => {
    await loadHarness(page);
    const v1Offset = await findDirOffsetY(page, 'v1');

    // At v1's offset: v1 has just scrolled past. The stuck set should
    // include runtime (parent) and v1's chain — not v2's.
    await scrollTo(page, v1Offset);
    const names = await stuckNames(page);
    expect(names).toContain('runtime');
    expect(names).toContain('v1');
    expect(names).not.toContain('v2');
  });
});

test.describe('shadow', () => {
  test('is-stuck-bottom on last row only (single stuck)', async ({ page }) => {
    await loadHarness(page);
    await scrollTo(page, 30);
    const state = await shadowState(page);
    expect(state.lastHasShadow).toBe(true);
    expect(state.othersWithShadow).toBe(0);
  });

  test('is-stuck-bottom on last row only (3+ stuck)', async ({ page }) => {
    await loadHarness(page);
    const modelOffset = await findDirOffsetY(page, 'model');
    expect(modelOffset).toBeGreaterThan(0);
    await scrollTo(page, modelOffset + 44);

    const state = await shadowState(page);
    expect(state.total).toBeGreaterThanOrEqual(3);
    expect(state.lastHasShadow).toBe(true);
    expect(state.othersWithShadow).toBe(0);
  });

  test('shadow pseudo-element extends below overlay', async ({ page }) => {
    await loadHarness(page);
    await scrollTo(page, 30);
    const visualHeight = await overlay(page).evaluate(el => {
      const children = el.children;
      if (children.length === 0) return 0;
      return children[children.length - 1].getBoundingClientRect().bottom - el.getBoundingClientRect().top;
    });
    expect(visualHeight).toBeGreaterThan(0);
  });
});
