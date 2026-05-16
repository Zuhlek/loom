import type { Bookmark } from '../types.js';

export function render(bookmarks: Bookmark[], root: HTMLElement): void {
  // Full re-render: clear and rebuild.
  while (root.firstChild) root.removeChild(root.firstChild);

  if (bookmarks.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No bookmarks yet. Save your first one above.';
    root.appendChild(p);
    return;
  }

  const ul = document.createElement('ul');
  ul.className = 'bookmarks';

  for (const b of bookmarks) {
    const li = document.createElement('li');

    const titleWrap = document.createElement('div');
    const a = document.createElement('a');
    a.setAttribute('href', b.url);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
    a.textContent = b.title;
    titleWrap.appendChild(a);

    const urlEl = document.createElement('span');
    urlEl.className = 'url';
    urlEl.textContent = b.url;
    titleWrap.appendChild(urlEl);

    li.appendChild(titleWrap);

    const del = document.createElement('button');
    del.type = 'button';
    del.setAttribute('data-action', 'delete');
    del.setAttribute('data-id', String(b.id));
    del.textContent = 'Delete';
    li.appendChild(del);

    ul.appendChild(li);
  }

  root.appendChild(ul);
}
