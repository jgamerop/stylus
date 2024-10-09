/**
 * This file must be loaded in a <script> tag placed after all the <link> tags
 * that contain dark themes so that the stylesheets are loaded by the time this script runs.
 * The CSS must use `@media screen and (prefers-color-scheme: dark), dark {}` that also works
 * in old browsers and ensures CSS loads before the first paint, then we toggle the media here,
 * which also happens before the first paint unless the browser "yields", but that's abnormal
 * and not even a problem in the most popular case of using system dark/light mode.
 */
import {$, $create} from '/js/dom-base';
import {getCssMediaRuleByName} from '/js/dom-util';
import * as msg from '/js/msg';
import {API} from '/js/msg';
import {FIREFOX, MF_ICON_EXT, MF_ICON_PATH} from '/js/toolbox';
import '/css/global.css';
import '/css/global-dark.css';

export const MEDIA_ON = 'screen';
export const MEDIA_OFF = 'not all';
const MEDIA_NAME = 'dark';
const map = {[MEDIA_ON]: true, [MEDIA_OFF]: false};

(async () => {
  let isDark, isVivaldi;
  if (window === top) ({isDark, isVivaldi} = await API.info.get());
  else isDark = parent.document.documentElement.dataset.uiTheme === 'dark';
  toggle(isDark);
  msg.onExtension(e => {
    if (e.method === 'colorScheme') {
      isDark = e.value;
      toggle(isDark);
    }
  });
  // Add favicon in FF and Vivaldi
  if (window === top
  && (FIREFOX || isVivaldi)
  && location.pathname !== '/popup.html') {
    document.head.append(...[32, 16].map(size => $create('link', {
      rel: 'icon',
      href: `${MF_ICON_PATH}${isDark ? '' : 'light/'}${size}${MF_ICON_EXT}`,
      sizes: size + 'x' + size,
    })));
  }
})();

function toggle(isDark) {
  $.root.dataset.uiTheme = isDark ? 'dark' : 'light';
  getCssMediaRuleByName(MEDIA_NAME, m => {
    if (map[m[0]] !== isDark) {
      m.mediaText = `${isDark ? MEDIA_ON : MEDIA_OFF},${MEDIA_NAME}`;
    }
  });
}