/* UI integration only; playback, resources and translations remain in the player modules. */
(() => {
  'use strict';
  const themeKey = 'knismolagnia-theme';
  const applyTheme = theme => {
    if (theme !== 'light' && theme !== 'dark') return;
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#171d25' : '#f8f7fa');
  };
  try {
    const parentTheme = window.parent !== window ? window.parent.document.documentElement.dataset.theme : null;
    applyTheme(parentTheme || localStorage.getItem(themeKey) || 'light');
  } catch { applyTheme('light'); }
  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    if (event.data?.type === 'knismolagnia-player-theme') applyTheme(event.data.theme);
  });
  window.addEventListener('storage', event => {
    if (event.key === themeKey) applyTheme(event.newValue);
  });

  function enhance() {
    const main = document.getElementById('main');
    const watch = document.querySelector('.watch-column');
    const map = document.querySelector('.map-panel');
    const canvas = document.getElementById('graphCanvas');
    if (main && watch) main.prepend(watch);

    if (map && canvas && !map.querySelector('.chapter-browser')) {
      const details = document.createElement('details');
      details.className = 'chapter-browser';
      const summary = document.createElement('summary');
      const title = document.createElement('span');
      title.textContent = '场景目录';
      const count = document.createElement('span');
      count.className = 'chapter-count';
      const expand = document.createElement('span');
      expand.className = 'chapter-expand';
      expand.setAttribute('aria-hidden', 'true');
      summary.append(title, count, expand);
      const content = document.createElement('div');
      content.className = 'chapter-content';
      while (map.firstChild) content.append(map.firstChild);
      details.append(summary, content);
      map.append(details);

      const label = document.createElement('label');
      label.className = 'chapter-search';
      label.textContent = '查找场景';
      const search = document.createElement('input');
      search.type = 'search';
      search.placeholder = '输入章节或场景名称';
      search.autocomplete = 'off';
      search.setAttribute('aria-controls', 'graphCanvas');
      label.append(search);
      const categoryLabel = document.createElement('label');
      categoryLabel.className = 'chapter-search';
      categoryLabel.textContent = '浏览内容';
      const category = document.createElement('select');
      category.setAttribute('aria-label', '选择剧情或译文资料');
      for (const [value,text] of [['story','剧情场景'],['reference','译文资料'],['all','全部内容']]) category.append(new Option(text,value));
      categoryLabel.append(category);
      const intro = content.querySelector('.map-intro');
      if (intro) intro.after(label); else content.prepend(label);
      label.before(categoryLabel);
      const empty = document.createElement('p');
      empty.className = 'chapter-empty';
      empty.textContent = '没有找到匹配的场景，请换个关键词。';
      empty.hidden = true;
      empty.setAttribute('role', 'status');
      canvas.after(empty);

      const filterScenes = () => {
        const query = search.value.trim().toLocaleLowerCase();
        const nodes = Array.from(canvas.querySelectorAll('.map-node, .graph-node'));
        let found = 0;
        for (const node of nodes) {
          const matched = (category.value === 'all' || (node.dataset.category || 'story') === category.value) && (!query || `${node.textContent} ${node.title}`.toLocaleLowerCase().includes(query));
          node.hidden = !matched;
          if (matched) found++;
        }
        count.textContent = `${found} 个${category.value === 'reference' ? '资料分组' : category.value === 'story' ? '剧情场景' : '条目'}`;
        empty.hidden = !nodes.length || found > 0;
      };
      search.addEventListener('input', filterScenes);
      category.addEventListener('change', filterScenes);
      new MutationObserver(filterScenes).observe(canvas, { childList: true });
      filterScenes();
      const wide = window.matchMedia('(min-width: 1280px)');
      details.open = wide.matches;
      wide.addEventListener('change', event => { details.open = event.matches; });
    }

    const viewport = document.getElementById('stageViewport');
    const sourceSpeaker = document.getElementById('speakerName');
    const sourceText = document.getElementById('dialogueText');
    if (viewport && sourceSpeaker && sourceText && !document.querySelector('.mobile-dialogue')) {
      const dialogue = document.createElement('section');
      dialogue.className = 'mobile-dialogue';
      dialogue.setAttribute('aria-label', '当前对白');
      const speaker = document.createElement('p');
      speaker.className = 'mobile-dialogue-speaker';
      const text = document.createElement('div');
      text.className = 'mobile-dialogue-text';
      dialogue.append(speaker, text);
      viewport.after(dialogue);
      const syncDialogue = () => {
        speaker.textContent = sourceSpeaker.textContent || '旁白';
        text.replaceChildren(...Array.from(sourceText.childNodes, node => node.cloneNode(true)));
        if (!sourceText.textContent.trim()) text.textContent = '点击「继续阅读」开始。';
      };
      const observer = new MutationObserver(syncDialogue);
      observer.observe(sourceSpeaker, { childList: true, subtree: true, characterData: true });
      observer.observe(sourceText, { childList: true, subtree: true, characterData: true });
      syncDialogue();
    }

    if (window.parent !== window) {
      let lastHeight = 0;
      let pending = false;
      const reportHeight = () => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
          pending = false;
          // Body's intrinsic content height avoids a feedback loop with iframe height.
          const height = Math.ceil(document.body.getBoundingClientRect().height);
          if (height !== lastHeight) {
            lastHeight = height;
            window.parent.postMessage({ type: 'knismolagnia-player-height', height }, window.location.origin);
          }
        });
      };
      new ResizeObserver(reportHeight).observe(document.body);
      document.addEventListener('toggle', reportHeight, true);
      window.addEventListener('load', reportHeight);
      window.parent.postMessage({ type: 'knismolagnia-player-ready' }, window.location.origin);
      reportHeight();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhance, { once: true });
  else enhance();
})();
