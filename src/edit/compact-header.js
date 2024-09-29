import {$, $$, $create, important} from '/js/dom';
import * as prefs from '/js/prefs';
import editor from './editor';

export default function CompactHeader() {
  // Set up mini-header on scroll
  const {isUsercss} = editor;
  const el = $create({
    style: important(`
      top: 0;
      height: 1px;
      position: absolute;
      visibility: hidden;
    `),
  });
  const scroller = isUsercss ? $('.CodeMirror-scroll') : document.body;
  const xoRoot = isUsercss ? scroller : undefined;
  const xo = new IntersectionObserver(onScrolled, {root: xoRoot});
  const elInfo = $('h1 a');
  scroller.appendChild(el);
  onCompactToggled(editor.mqCompact);
  editor.mqCompact.on('change', onCompactToggled);

  /** @param {MediaQueryList} mq */
  function onCompactToggled(mq) {
    for (const el of $$('details[data-pref]')) {
      el.open = mq.matches ? false :
        el.classList.contains('ignore-pref') ? el.open :
          prefs.get(el.dataset.pref);
    }
    if (mq.matches) {
      xo.observe(el);
      $('#basic-info-name').after(elInfo);
    } else {
      xo.disconnect();
      $('h1').append(elInfo);
    }
  }

  /** @param {IntersectionObserverEntry[]} entries */
  function onScrolled(entries) {
    const h = $('#header');
    const sticky = !entries.pop().intersectionRatio;
    if (!isUsercss) scroller.style.paddingTop = sticky ? h.offsetHeight + 'px' : '';
    h.classList.toggle('sticky', sticky);
  }
}
