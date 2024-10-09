import {worker} from '/edit/linter/store';
import {$, $create, $createLink, messageBox} from '/js/dom';
import {t, template} from '/js/localization';
import {chromeSync} from '/js/storage-util';
import {tryJSONparse} from '/js/toolbox';
import editor from '../editor';
import {helpPopup, showCodeMirrorPopup} from '../util';
import {DEFAULTS} from './defaults';
import {getIssues} from './reports';

/** @type {{csslint:{}, stylelint:{}}} */
const RULES = {};
const KNOWN_RULES = {};
const defaultConfig = {};
let cmDlg;
let knownRules;
let isStylelint;
let linter;
let popup;

$('#lint-help').onclick = showLintHelp;
$('#linter-settings', template.EditorSettings).onclick = showLintConfig;

async function showLintConfig() {
  linter = await getLinter();
  if (!linter) {
    return;
  }
  // TODO: replace with JSON.parse()
  await import('/js/jsonlint-bundle');
  const config = await chromeSync.getLZValue(chromeSync.LZ_KEY[linter]);
  const title = t('linterConfigPopupTitle', isStylelint ? 'Stylelint' : 'CSSLint');
  const activeRules = new Set(getActiveRules());
  isStylelint = linter === 'stylelint';
  knownRules = KNOWN_RULES[linter] || (
    KNOWN_RULES[linter] = new Set((
      isStylelint
        ? Object.keys(RULES[linter])
        : RULES[linter].map(r => r.id)
    ).sort()));
  for (let cfg of [
    config,
    !defaultConfig[linter] && DEFAULTS[linter],
  ].filter(Boolean)) {
    const missingRules = new Set(knownRules);
    cfg = isStylelint ? cfg.rules : cfg;
    for (const id in cfg) {
      if (cfg[id] && knownRules.has(id)) {
        missingRules.delete(id);
      } else if (/^[a-z]+(-[a-z]+)*$/.test(id)) {
        // Deleting unknown rules that look like a valid id but allow unusual ids for user comments
        delete cfg[id];
      }
    }
    for (const id of missingRules) {
      cfg[id] = isStylelint ? false : 0;
    }
  }
  defaultConfig[linter] = stringifyConfig(DEFAULTS[linter]);
  popup = showCodeMirrorPopup(title, null, {
    extraKeys: {'Ctrl-Enter': onConfigSave},
    hintOptions: {hint},
    lint: true,
    mode: 'application/json',
    value: config ? stringifyConfig(config) : defaultConfig[linter],
  });
  popup._contents.appendChild(
    $create('div', [
      $create('p', [
        $createLink(
          isStylelint
            ? 'https://stylelint.io/user-guide/rules/'
            : 'https://github.com/CSSLint/csslint/wiki/Rules-by-ID',
          t('linterRulesLink')),
        linter === 'csslint' ? ' ' + t('linterCSSLintSettings') : '',
      ]),
      $create('.buttons', [
        $create('button.save', {onclick: onConfigSave, title: 'Ctrl-Enter'},
          t('styleSaveLabel')),
        $create('button.cancel', {onclick: onConfigCancel}, t('confirmClose')),
        $create('button.reset', {onclick: onConfigReset, title: t('linterResetMessage')},
          t('genericResetLabel')),
      ]),
    ]));
  cmDlg = popup.codebox;
  cmDlg.focus();
  cmDlg.addOverlay({
    token(stream) {
      const tok = stream.baseToken();
      if (tok && tok.type === 'string property') {
        const id = stream.string.substr(stream.pos + 1, tok.size - 2);
        if (knownRules.has(id)) {
          stream.pos += tok.size;
          return 'string-2 known-linter-rule' + (activeRules.has(id) ? ' active-linter-rule' : '');
        }
      }
      stream.pos += tok ? tok.size : 1e9;
    },
  });
  cmDlg.on('changes', updateConfigButtons);
  updateConfigButtons();
  popup.onClose.add(onConfigClose);
}

async function showLintHelp() {
  const target = await getLinter();
  const baseUrl = target === 'stylelint'
    ? 'https://stylelint.io/user-guide/rules/'
    : '';
  let headerLink, makeItem;
  if (target === 'csslint') {
    headerLink = $createLink('https://github.com/CSSLint/csslint/wiki/Rules', 'CSSLint');
    makeItem = ruleID => {
      for (const rule of RULES.csslint) {
        if (rule.id === ruleID) {
          return $create('li', [
            $create('b', ruleID + ': '),
            rule.url ? $createLink(rule.url, rule.name) : $create('span', `"${rule.name}"`),
            $create('p', rule.desc),
          ]);
        }
      }
    };
  } else {
    headerLink = $createLink(baseUrl, 'stylelint');
    makeItem = rule =>
      $create('li',
        rule === 'CssSyntaxError' ? rule : $createLink(baseUrl + rule, rule));
  }
  const header = t('linterIssuesHelp', '\x01').split('\x01');
  helpPopup.show(t('linterIssues'),
    $create([
      header[0], headerLink, header[1],
      $create('ul.rules', getActiveRules().map(makeItem)),
      $create('button', {onclick: showLintConfig}, t('configureStyle')),
    ]));
}

function getActiveRules() {
  const all = [...getIssues()].map(issue => issue.rule);
  const uniq = new Set(all);
  return [...uniq];
}

function getLexicalDepth(lexicalState) {
  let depth = 0;
  while ((lexicalState = lexicalState.prev)) {
    depth++;
  }
  return depth;
}

async function getLinter() {
  const val = editor.getCurrentLinter();
  if (val && !RULES[val]) {
    RULES[val] = await worker.getRules(val);
  }
  return val;
}

function hint(cm) {
  const rules = RULES[linter];
  let ruleIds, options;
  if (isStylelint) {
    ruleIds = Object.keys(rules);
    options = rules;
  } else {
    ruleIds = rules.map(r => r.id);
    options = {};
  }
  const cursor = cm.getCursor();
  const {start, end, string, type, state: {lexical}} = cm.getTokenAt(cursor);
  const {line, ch} = cursor;

  const quoted = string.startsWith('"');
  const leftPart = string.slice(quoted ? 1 : 0, ch - start).trim();
  const depth = getLexicalDepth(lexical);

  const search = cm.getSearchCursor(/"([-\w]+)"/, {line, ch: start - 1});
  let [, prevWord] = search.find(true) || [];
  let words = [];

  if (depth === 1 && isStylelint) {
    words = quoted ? ['rules'] : [];
  } else if ((depth === 1 || depth === 2) && type && type.includes('property')) {
    words = ruleIds;
  } else if (depth === 2 || depth === 3 && lexical.type === ']') {
    words = !quoted ? ['true', 'false', 'null'] :
      ruleIds.includes(prevWord) && options[prevWord]?.[0] || [];
  } else if (depth === 4 && prevWord === 'severity') {
    words = ['error', 'warning'];
  } else if (depth === 4) {
    words = ['ignore', 'ignoreAtRules', 'except', 'severity'];
  } else if (depth === 5 && lexical.type === ']' && quoted) {
    while (prevWord && !ruleIds.includes(prevWord)) {
      prevWord = (search.find(true) || [])[1];
    }
    words = options[prevWord]?.slice(-1)[0] || ruleIds;
  }
  return {
    list: words.filter(word => word.startsWith(leftPart)),
    from: {line, ch: start + (quoted ? 1 : 0)},
    to: {line, ch: string.endsWith('"') ? end - 1 : end},
  };
}

function onConfigCancel() {
  helpPopup.close();
  editor.closestVisible().focus();
}

function onConfigClose() {
  cmDlg = null;
}

function onConfigReset(event) {
  event.preventDefault();
  cmDlg.setValue(defaultConfig[linter]);
  cmDlg.focus();
  updateConfigButtons();
}

async function onConfigSave(event) {
  if (event instanceof Event) {
    event.preventDefault();
  }
  const json = tryJSONparse(cmDlg.getValue());
  if (!json) {
    showLinterErrorMessage(linter, t('linterJSONError'));
    cmDlg.focus();
    return;
  }
  const cfg = isStylelint ? json.rules : json;
  for (const id in cfg) {
    if (!cfg[id]) delete cfg[id];
  }
  chromeSync.setLZValue(chromeSync.LZ_KEY[linter], json);
  cmDlg.markClean();
  cmDlg.focus();
  updateConfigButtons();
}

function stringifyConfig(config) {
  return JSON.stringify(config, null, 2)
    .replace(/,\n\s+{\n\s+("severity":\s"\w+")\n\s+}/g, ', {$1}');
}

async function showLinterErrorMessage(title, contents) {
  await messageBox.show({
    title,
    contents,
    className: 'danger center lint-config',
    buttons: [t('confirmOK')],
  });
  popup?.codebox?.focus();
}

function updateConfigButtons() {
  $('.save', popup).disabled = cmDlg.isClean();
  $('.reset', popup).disabled = cmDlg.getValue() === defaultConfig[linter];
  $('.cancel', popup).textContent = t(cmDlg.isClean() ? 'confirmClose' : 'confirmCancel');
}