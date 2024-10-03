import ColorPicker from '/js/color/color-picker';
import {$, $create, $createLink, $remove, important, setupLivePrefs} from '/js/dom';
import {t} from '/js/localization';
import {API} from '/js/msg';
import * as prefs from '/js/prefs';
import {clamp, debounce, deepCopy, UA, UCD} from '/js/toolbox';
import '/js/color/color-converter';
import messageBox from './message-box';
// import '/js/color/color-picker.css';
// import '/js/dlg/config-dialog.css';
// import '/options/onoffswitch.css';

export default function configDialog(style) {
  const AUTOSAVE_DELAY = 400;
  let saving = false;
  let bodyStyle;

  const data = style[UCD];
  const varsHash = deepCopy(data.vars) || {};
  const varNames = Object.keys(varsHash);
  const vars = varNames.map(name => varsHash[name]);
  let varsInitial = getInitialValues(varsHash);

  const elements = [];
  const isInstaller = location.pathname.startsWith('/install-usercss.html');
  const isPopup = location.pathname.startsWith('/popup.html');
  const colorpicker = ColorPicker();
  const buttons = {};

  buildConfigForm();
  renderValues();
  vars.forEach(renderValueState);

  return messageBox.show({
    title: `${style.customName || style.name} v${data.version}`,
    className: 'config-dialog',
    contents: [
      $create('.config-heading', data.supportURL &&
        $createLink({className: '.external-support', href: data.supportURL},
          t('externalFeedback'))),
      $create('.config-body', elements),
    ],
    buttons: [{
      textContent: t('confirmSave'),
      'data-cmd': 'save',
      disabled: true,
      onclick: save,
    }, {
      textContent: t('genericResetLabel'),
      title: t('optionsReset'),
      'data-cmd': 'default',
      onclick: useDefault,
    }, {
      textContent: t('confirmClose'),
      'data-cmd': 'close',
    }],
    onshow,
  }).then(onhide);

  function getInitialValues(source) {
    const data = {};
    for (const name of varNames) {
      const va = source[name];
      data[name] = isDefault(va) ? va.default : va.value;
    }
    return data;
  }

  function onshow(box) {
    $('#message-box-buttons button').after(
      $create('label#config-autosave-wrapper', {
        title: t('configOnChangeTooltip'),
      }, [
        $create('input', {id: 'config.autosave', type: 'checkbox'}),
        t('configOnChange'),
      ]));
    setupLivePrefs(['config.autosave']);
    box.style.setProperty('--num', vars.length);
    if (isPopup && !UA.mobile) {
      adjustSizeForPopup(box);
    }
    box.on('change', onchange);
    buttons.save = $('[data-cmd="save"]', box);
    buttons.default = $('[data-cmd="default"]', box);
    buttons.close = $('[data-cmd="close"]', box);
    updateButtons();
    updateOverlayScrollbar($('#message-box-contents'));
  }

  function onhide() {
    if (bodyStyle != null) document.body.style.cssText = bodyStyle;
    colorpicker.hide();
  }

  function onchange({target, justSaved = false}) {
    // invoked after element's own onchange so 'va' contains the updated value
    const va = target.va;
    if (va) {
      va.dirty = varsInitial[va.name] !== (isDefault(va) ? va.default : va.value);
      if (prefs.get('config.autosave') && !justSaved) {
        debounce(save, AUTOSAVE_DELAY, {anyChangeIsDirty: true});
        return;
      }
      renderValueState(va);
      if (!justSaved) {
        updateButtons();
      }
    }
  }

  function updateButtons() {
    const someDirty = vars.some(va => va.dirty);
    buttons.save.disabled = !someDirty;
    buttons.default.disabled = vars.every(isDefault);
    buttons.close.textContent = t(someDirty ? 'confirmCancel' : 'confirmClose');
  }

  function updateOverlayScrollbar(el) {
    el.classList.toggle('sb-overlay',
      el.offsetWidth === el.clientWidth && el.scrollHeight > el.clientHeight);
  }

  async function save({anyChangeIsDirty = false} = {}) {
    for (let delay = 1; saving && delay < 1000; delay *= 2) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    if (saving) {
      throw 'Could not save: still saving previous results...';
    }
    if (!vars.some(va => va.dirty || anyChangeIsDirty && va.value !== va.savedValue)) {
      return;
    }
    const bgStyle = !isInstaller && await API.styles.get(style.id).catch(() => ({}));
    style = style.sections ? Object.assign({}, style) : style;
    style.enabled = true;
    style.sourceCode = null;
    style.sections = null;
    const styleVars = style[UCD].vars;
    const bgVars = isInstaller ? styleVars : (bgStyle[UCD] || {}).vars || {};
    const invalid = [];
    let numValid = 0;
    for (const va of vars) {
      const bgva = bgVars[va.name];
      let error;
      if (!bgva) {
        error = 'deleted';
        delete styleVars[va.name];
      } else if (bgva.type !== va.type) {
        error = ['type ', '*' + va.type, ' != ', '*' + bgva.type];
      } else if (
        (va.type === 'select' || va.type === 'dropdown') &&
        !isDefault(va) && bgva.options.every(o => o.name !== va.value)
      ) {
        error = `'${va.value}' not in the updated '${va.type}' list`;
      } else if (!va.dirty && (!anyChangeIsDirty || va.value === va.savedValue)) {
        continue;
      } else {
        styleVars[va.name].value = va.value;
        va.savedValue = va.value;
        numValid++;
        continue;
      }
      invalid.push(['*' + va.name, ': ', ...error].map(e =>
        e[0] === '*' && $create('b', e.slice(1)) || e));
      if (bgva) {
        styleVars[va.name].value = deepCopy(bgva);
      }
    }
    if (invalid.length) {
      onhide();
      messageBox.alert([
        $create('div', {style: 'max-width: 34em'}, t('usercssConfigIncomplete')),
        $create('ol', {style: 'text-align: left'},
          invalid.map(msg =>
            $create({tag: 'li', appendChild: msg}))),
      ], 'pre');
    }
    if (!numValid) {
      return;
    }
    saving = true;
    try {
      const newVars = isInstaller ? styleVars : await API.usercss.configVars(style.id, styleVars);
      varsInitial = getInitialValues(newVars);
      vars.forEach(va => onchange({target: va.input, justSaved: true}));
      renderValues();
      updateButtons();
      $remove('.config-error');
    } catch (errors) {
      const el = $('.config-error', messageBox.element) ||
        $('#message-box-buttons').insertAdjacentElement('afterbegin', $create('.config-error'));
      el.textContent =
        el.title = (Array.isArray(errors) ? errors : [errors])
          .map(e => e.stack || e.message || `${e}`)
          .join('\n');
    }
    saving = false;
  }

  function useDefault() {
    for (const va of vars) {
      va.value = null;
      onchange({target: va.input});
    }
    renderValues();
  }

  function isDefault(va) {
    return va.value === null || va.value === undefined || va.value === va.default;
  }

  function buildConfigForm() {
    let resetter =
      $create('a.config-reset-icon', {tabIndex: 0, title: t('genericResetLabel')},
        $create('i.i-close'));
    for (const va of vars) {
      let children;
      switch (va.type) {
        case 'color':
          children = [
            $create('.colorview-swatch.config-value', [
              va.input = $create('a.color-swatch', {
                va,
                tabIndex: 0,
                onclick: showColorpicker,
              }),
            ]),
          ];
          break;

        case 'checkbox':
          children = [
            va.input = $create('input.slider.config-value', {
              va,
              type: 'checkbox',
              onchange: updateVarOnChange,
            }),
          ];
          break;

        case 'select':
        case 'dropdown':
        case 'image':
          // TODO: a image picker input?
          children = [
            $create('.select-wrapper.config-value', [
              va.input = $create('select', {
                va,
                onchange: updateVarOnChange,
              },
              va.options.map(o =>
                $create('option', {value: o.name}, o.label))),
            ]),
          ];
          break;

        case 'range':
        case 'number': {
          const options = {
            va,
            type: va.type,
            onfocus: va.type === 'number' ? selectAllOnFocus : null,
            onblur: va.type === 'number' ? updateVarOnBlur : null,
            onchange: updateVarOnChange,
            oninput: updateVarOnChange,
            required: true,
          };
          if (typeof va.min === 'number') {
            options.min = va.min;
          }
          if (typeof va.max === 'number') {
            options.max = va.max;
          }
          if (typeof va.step === 'number' && isFinite(va.step)) {
            options.step = va.step;
          }
          children = [
            va.type === 'range' && $create('span.current-value'),
            va.input = $create('input.config-value', options),
          ];
          break;
        }

        default:
          children = [
            va.input = $create('input.config-value', {
              va,
              type: va.type,
              onchange: updateVarOnChange,
              oninput: updateVarOnChange,
              onfocus: selectAllOnFocus,
            }),
          ];

      }

      resetter = resetter.cloneNode(true);
      resetter.va = va;
      resetter.onclick = resetOnClick;

      elements.push(
        $create(`label.config-${va.type}`, [
          $create('span.config-name', t.breakWord(va.label)),
          ...children,
          resetter,
        ]));

      va.savedValue = va.value;
    }
  }

  function updateVarOnBlur() {
    this.value = isDefault(this.va) ? this.va.default : this.va.value;
  }

  function updateVarOnChange(ev) {
    let val;
    if (this.type === 'text') {
      val = this.value;
    } else if (this.type === 'range') {
      val = this.valueAsNumber;
      updateRangeCurrentValue(this.va, this.value);
    } else if (this.type === 'number') {
      if (!this.reportValidity()) return;
      val = this.valueAsNumber;
    } else {
      this.va.value = this.type !== 'checkbox' ? this.value : this.checked ? '1' : '0';
      return;
    }
    if (!Number.isNaN(val)) {
      this.va.value = val;
      if (ev.type === 'input') onchange(ev);
    }
  }

  function updateRangeCurrentValue(va, value) {
    const span = $('.current-value', va.input.closest('.config-range'));
    if (span) {
      span.textContent = value + (va.units || '');
    }
  }

  function selectAllOnFocus() {
    this.select();
  }

  function renderValues(varsToRender = vars) {
    for (const va of varsToRender) {
      if (va.input === document.activeElement) {
        continue;
      }
      const value = isDefault(va) ? va.default : va.value;
      if (va.type === 'color') {
        va.input.style.backgroundColor = value;
        if (colorpicker.options.va === va) {
          colorpicker.setColor(value);
        }
      } else if (va.type === 'checkbox') {
        va.input.checked = Number(value);
      } else if (va.type === 'range') {
        va.input.value = value;
        updateRangeCurrentValue(va, va.input.value);
      } else {
        va.input.value = value;
      }
      if (!prefs.get('config.autosave')) {
        renderValueState(va);
      }
    }
  }

  function renderValueState(va) {
    const el = va.input.closest('label');
    el.classList.toggle('dirty', Boolean(va.dirty));
    el.classList.toggle('nondefault', !isDefault(va));
    $('.config-reset-icon', el).disabled = isDefault(va);
  }

  function resetOnClick(event) {
    event.preventDefault();
    this.va.value = null;
    renderValues([this.va]);
    onchange({target: this.va.input});
  }

  function showColorpicker(event) {
    event.preventDefault();
    window.off('keydown', messageBox.listeners.key, true);
    const box = $('#message-box-contents');
    const r = this.getBoundingClientRect();
    colorpicker.show({
      va: this.va,
      color: this.va.value || this.va.default,
      top: Math.min(r.bottom, innerHeight - 220),
      right: innerWidth - r.left - 10,
      guessBrightness: box,
      callback: onColorChanged,
    });
  }

  function onColorChanged(newColor) {
    if (newColor) {
      this.va.value = newColor;
      this.va.input.style.backgroundColor = newColor;
      this.va.input.dispatchEvent(new Event('change', {bubbles: true}));
    }
    debounce(restoreEscInDialog);
  }

  function restoreEscInDialog() {
    if (!$('.colorpicker-popup') && messageBox.element) {
      window.on('keydown', messageBox.listeners.key, true);
    }
  }

  function adjustSizeForPopup(box) {
    const contents = box.firstElementChild;
    contents.style = important('max-width: none; max-height: none;');
    let {offsetWidth: width, offsetHeight: height} = contents;
    contents.style = '';

    const dpr = devicePixelRatio;
    const elPicker = document.body.appendChild(
      $create('.colorpicker-popup', {style: 'display: none!important'}));
    const PADDING = 50 / dpr;
    const MIN_WIDTH = parseFloat(getComputedStyle(elPicker).width) || 350 / dpr;
    const MIN_HEIGHT = 250 / dpr + PADDING;
    elPicker.remove();

    const bs = document.body.style;
    width = clamp(width + PADDING, MIN_WIDTH, 798 / dpr);
    height = clamp(height + PADDING, MIN_HEIGHT, parseInt(bs.maxHeight) || 598 / dpr);
    bodyStyle = bs.cssText;
    bs.cssText = bodyStyle.replace(/((min|max)-width|min-height)\s*:[^;]+|;\s*$/g, '') + `;
      min-width:${width}px !important;
      min-height:${height}px !important;`;
  }
}
