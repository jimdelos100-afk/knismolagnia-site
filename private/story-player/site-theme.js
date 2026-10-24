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
    const map = document.querySelector('.map-panel');
    if (main && map) main.prepend(map);

    const mapToggle = document.getElementById('mapFoldButton');
    const mapContents = document.getElementById('mapContents');
    if (mapToggle && mapContents) {
      const mapKey = 'xp2-chapter-map-collapsed';
      const setMapCollapsed = collapsed => {
        mapContents.hidden = collapsed;
        mapToggle.setAttribute('aria-expanded', String(!collapsed));
        mapToggle.textContent = collapsed ? '展开地图' : '收起地图';
      };
      try { setMapCollapsed(localStorage.getItem(mapKey) === 'true'); } catch { setMapCollapsed(false); }
      mapToggle.addEventListener('click', () => {
        const collapsed = !mapContents.hidden;
        setMapCollapsed(collapsed);
        try { localStorage.setItem(mapKey, String(collapsed)); } catch { /* Browsing remains available without storage. */ }
      });
    }

    const viewport = document.getElementById('stageViewport');
    const sourceSpeaker = document.getElementById('speakerName');
    const sourceText = document.getElementById('dialogueText');
    const sourceWindow = document.getElementById('messageWindow');
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
        dialogue.hidden = !!sourceWindow?.hidden;
        speaker.textContent = sourceSpeaker.textContent || '旁白';
        text.replaceChildren(...Array.from(sourceText.childNodes, node => node.cloneNode(true)));
        if (!sourceText.textContent.trim()) text.textContent = '点击「继续阅读」开始。';
      };
      const observer = new MutationObserver(syncDialogue);
      observer.observe(sourceSpeaker, { childList: true, subtree: true, characterData: true });
      observer.observe(sourceText, { childList: true, subtree: true, characterData: true });
      if (sourceWindow) observer.observe(sourceWindow, { attributes: true, attributeFilter: ['hidden'] });
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
