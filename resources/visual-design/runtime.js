(() => {
  const root = document.querySelector('.visual-project');
  if (!root) return;
  const main = root.querySelector('.sample-main');
  const status = root.querySelector('.visual-status');
  const say = text => { if (status) status.textContent = text; };
  const closeSelect = select => {
    select.querySelector('[role=listbox]').hidden = true;
    select.querySelector('[data-select-toggle]').setAttribute('aria-expanded', 'false');
  };
  const openSelect = select => {
    root.querySelectorAll('.visual-select').forEach(other => { if (other !== select) closeSelect(other); });
    select.querySelector('[role=listbox]').hidden = false;
    select.querySelector('[data-select-toggle]').setAttribute('aria-expanded', 'true');
    select.querySelector('[aria-selected=true]')?.focus();
  };
  if (root.dataset.devicePolicy === 'auto') {
    const media = matchMedia('(max-width:640px)');
    const sync = () => { root.dataset.device = media.matches ? 'mobile' : 'web'; };
    sync();
    media.addEventListener('change', sync);
  }
  root.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.matches('[data-select-toggle]')) {
      const select = target.closest('.visual-select');
      if (select.querySelector('[role=listbox]').hidden) openSelect(select);
      else closeSelect(select);
    }
    if (target.matches('[role=option]')) {
      const select = target.closest('.visual-select');
      select.querySelectorAll('[role=option]').forEach(option => option.setAttribute('aria-selected', String(option === target)));
      select.querySelector('[data-select-label]').textContent = target.textContent;
      closeSelect(select);
      select.querySelector('[data-select-toggle]').focus();
      say(target.textContent);
    }
    if (target.matches('[data-open-dialog]')) root.querySelector('dialog')?.showModal();
    if (target.matches('[data-close-dialog]')) root.querySelector('dialog')?.close();
    if (target.matches('[data-action]')) say(target.dataset.action);
    if (target.matches('.visual-nav')) {
      root.querySelectorAll('.visual-nav').forEach(button => button.removeAttribute('aria-current'));
      target.setAttribute('aria-current', 'page');
      say(target.textContent);
    }
  });
  root.addEventListener('keydown', event => {
    const select = event.target.closest('.visual-select');
    if (!select) return;
    const list = select.querySelector('[role=listbox]');
    const options = [...list.querySelectorAll('[role=option]')];
    if (event.key === 'Escape' && !list.hidden) {
      event.preventDefault();
      event.stopPropagation();
      closeSelect(select);
      select.querySelector('[data-select-toggle]').focus();
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const wasHidden = list.hidden;
      if (wasHidden) openSelect(select);
      let index = options.indexOf(document.activeElement);
      index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
        : wasHidden ? Math.max(0, index) : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options[index]?.focus();
    }
  });
  document.addEventListener('click', event => root.querySelectorAll('.visual-select').forEach(select => {
    if (!select.contains(event.target)) closeSelect(select);
  }));
  document.addEventListener('focusin', event => root.querySelectorAll('.visual-select').forEach(select => {
    if (!select.contains(event.target)) closeSelect(select);
  }));
  root.querySelectorAll('.gallery-range input[type=range]').forEach(input => {
    const sync = () => {
      const min = Number(input.min || 0), max = Number(input.max || 100);
      const progress = max > min ? Math.max(0, Math.min(100, (Number(input.value) - min) / (max - min) * 100)) : 0;
      input.closest('.gallery-range').querySelector('i').style.width = `${progress}%`;
      const output = input.closest('.gallery-range-label')?.querySelector('output');
      if (output) output.textContent = `${input.value}%`;
    };
    input.addEventListener('input', sync);
    sync();
  });
  root.querySelectorAll('form').forEach(form => {
    form.noValidate = true;
    form.addEventListener('submit', event => {
      event.preventDefault();
      let first;
      form.querySelectorAll('input,textarea').forEach(input => {
        const valid = input.checkValidity();
        input.setAttribute('aria-invalid', String(!valid));
        if (!valid && !first) first = input;
      });
      if (first) {
        first.focus();
        say(document.documentElement.lang === 'en' ? 'Please check the highlighted fields.' : '请检查标记的输入项。');
      } else say('✓');
    });
  });
  if (main) {
    let frame;
    main.addEventListener('scroll', () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => parent.postMessage({ type: 'visual-preview-scroll', top: main.scrollTop }, '*'));
    });
    window.addEventListener('message', event => {
      if (event.source === parent && event.data?.type === 'visual-preview-restore' && Number.isFinite(event.data.top)) main.scrollTop = Math.max(0, event.data.top);
    });
  }
})();
