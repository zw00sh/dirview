// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { patchTreeChildren } from './index';

import './test-helpers';

// ── patchTreeChildren / patchDirLi ───────────────────────────────────────────

function makeLi(path: string, barWidth: number, countText: string, childPaths: string[] = []) {
  const li = document.createElement('li');
  li.dataset.nodePath = path;

  const row = document.createElement('div');
  row.className = 'dir-row';

  if (barWidth > 0) {
    const barWrap = document.createElement('div');
    barWrap.className = 'bar-wrap';
    barWrap.style.width = barWidth + 'px';
    const bar = document.createElement('div');
    bar.className = 'bar';
    barWrap.appendChild(bar);
    row.appendChild(barWrap);
  }

  const count = document.createElement('span');
  count.className = 'file-count';
  count.textContent = countText;
  row.appendChild(count);

  li.appendChild(row);

  if (childPaths.length) {
    const ul = document.createElement('ul');
    ul.className = 'children open';
    for (const cp of childPaths) { ul.appendChild(makeLi(cp, 10, '1')); }
    li.appendChild(ul);
  }

  return li;
}

function makeTree(items: [string, number, number, string[]?][]) {
  const ul = document.createElement('ul');
  ul.className = 'tree';
  for (const [path, barWidth, count, children] of items) {
    ul.appendChild(makeLi(path, barWidth, String(count), children || []));
  }
  return ul;
}

describe('patchTreeChildren', () => {
  it('does not duplicate unkeyed (file) children on re-patch', () => {
    const container = document.createElement('div');
    // Old tree: one dir with data-node-path, two plain <li>s (like file rows)
    const oldTree = document.createElement('ul');
    oldTree.className = 'tree';
    const dirLi = makeLi('/a', 50, '5');
    const fileLi1 = document.createElement('li');
    fileLi1.textContent = 'file1.ts';
    const fileLi2 = document.createElement('li');
    fileLi2.textContent = 'file2.ts';
    oldTree.appendChild(dirLi);
    oldTree.appendChild(fileLi1);
    oldTree.appendChild(fileLi2);
    container.appendChild(oldTree);

    // New tree: same dir (updated count) + same two files
    const newTree = document.createElement('ul');
    newTree.className = 'tree';
    newTree.appendChild(makeLi('/a', 60, '6'));
    const newFile1 = document.createElement('li');
    newFile1.textContent = 'file1.ts';
    const newFile2 = document.createElement('li');
    newFile2.textContent = 'file2.ts';
    newTree.appendChild(newFile1);
    newTree.appendChild(newFile2);

    patchTreeChildren(oldTree, newTree);

    // Must have exactly 3 children, not 5 (which would indicate duplication)
    expect(oldTree.children.length).toBe(3);
    expect(oldTree.querySelector('[data-node-path="/a"]')).toBeTruthy();
    expect(oldTree.querySelector('.file-count').textContent).toBe('6');
  });

  it('updates bar width and count for matching paths', () => {
    const container = document.createElement('div');
    const oldTree = makeTree([['/a', 50, '5']]);
    container.appendChild(oldTree);

    const newTree = makeTree([['/a', 80, '8']]);
    patchTreeChildren(oldTree, newTree);

    const li = oldTree.querySelector('[data-node-path="/a"]');
    expect(li).toBeTruthy();
    expect(li.querySelector('.bar-wrap').style.width).toBe('80px');
    expect(li.querySelector('.file-count').textContent).toBe('8');
  });

  it('inserts new nodes that did not previously exist', () => {
    const container = document.createElement('div');
    const oldTree = makeTree([['/a', 50, '5']]);
    container.appendChild(oldTree);

    const newTree = makeTree([['/a', 50, '5'], ['/b', 30, '3']]);
    patchTreeChildren(oldTree, newTree);

    expect(oldTree.querySelectorAll('[data-node-path]')).toHaveLength(2);
    expect(oldTree.querySelector('[data-node-path="/b"]')).toBeTruthy();
  });

  it('removes nodes that no longer exist in the new tree', () => {
    const container = document.createElement('div');
    const oldTree = makeTree([['/a', 50, '5'], ['/b', 30, '3']]);
    container.appendChild(oldTree);

    const newTree = makeTree([['/a', 50, '5']]);
    patchTreeChildren(oldTree, newTree);

    expect(oldTree.querySelectorAll('[data-node-path]')).toHaveLength(1);
    expect(oldTree.querySelector('[data-node-path="/b"]')).toBeNull();
  });

  it('reuses the same DOM node for matching paths', () => {
    const container = document.createElement('div');
    const oldTree = makeTree([['/a', 50, '5']]);
    container.appendChild(oldTree);
    const originalLi = oldTree.querySelector('[data-node-path="/a"]');

    const newTree = makeTree([['/a', 60, '6']]);
    patchTreeChildren(oldTree, newTree);

    const patchedLi = oldTree.querySelector('[data-node-path="/a"]');
    expect(patchedLi).toBe(originalLi); // same DOM node — not replaced
  });

  it('recurses into children <ul>', () => {
    const container = document.createElement('div');
    const oldTree = makeTree([['/a', 50, '5', ['/a/x']]]);
    container.appendChild(oldTree);

    const newTree = makeTree([['/a', 60, '6', ['/a/x', '/a/y']]]);
    patchTreeChildren(oldTree, newTree);

    const childUl = oldTree.querySelector('[data-node-path="/a"] > ul.children');
    expect(childUl).toBeTruthy();
    expect(childUl.querySelectorAll('[data-node-path]')).toHaveLength(2);
  });

  it('handles adding a bar where none existed', () => {
    const container = document.createElement('div');
    const oldTree = makeTree([['/a', 0, '—']]); // no bar (empty dir)
    container.appendChild(oldTree);

    const newTree = makeTree([['/a', 40, '4']]); // now has files
    patchTreeChildren(oldTree, newTree);

    const li = oldTree.querySelector('[data-node-path="/a"]');
    expect(li.querySelector('.bar-wrap')).toBeTruthy();
    expect(li.querySelector('.bar-wrap').style.width).toBe('40px');
  });

  it('handles removing a bar when dir becomes empty', () => {
    const container = document.createElement('div');
    const oldTree = makeTree([['/a', 40, '4']]); // has bar
    container.appendChild(oldTree);

    const newTree = makeTree([['/a', 0, '—']]); // no bar
    patchTreeChildren(oldTree, newTree);

    const li = oldTree.querySelector('[data-node-path="/a"]');
    expect(li.querySelector('.bar-wrap')).toBeNull();
  });
});
