import { clear, div, toast, setBusy, showExcelSavedDialog, chooseExcelMode } from '../core/dom.js';
import { ProgressDialog } from '../core/progress.js';
import { post, onHost } from '../core/bridge.js';
import { createRvtTable, renderRvtRows, getRvtName } from './rvtTable.js';

const FEATURE_KEYS = ['connector', 'pms', 'guid', 'paramprop', 'familylink', 'points'];

export function renderMulti(root) {
  const target = root || document.getElementById('view-root') || document.getElementById('app');
  clear(target);
  const top = document.querySelector('#topbar-root .topbar') || document.querySelector('.topbar');
  if (top) top.classList.add('hub-topbar');

  const state = {
    rvtList: [],
    rvtChecked: new Set(),
    busy: false,
    common: {
      extraParams: '',
      targetFilter: '',
      excludeEndDummy: false
    },
    features: {
      connector: { enabled: false, tol: 1.0, unit: 'inch', param: 'Comments' },
      pms: { enabled: false, ndRound: 3, tolMm: 0.01, classMatch: false, pmsReady: false },
      guid: { enabled: false, includeFamily: false, includeAnnotation: false },
      paramprop: { enabled: false, paramNames: [], group: '', isInstance: true, excludeDummy: false, ready: false },
      familylink: { enabled: false, targets: [], ready: false },
      points: { enabled: false, unit: 'ft' }
    },
    results: {},
    sharedParams: [],
    paramGroups: [],
    familyParams: []
  };

  FEATURE_KEYS.forEach((k) => {
    state.results[k] = { count: 0, stale: true };
  });

  const page = div('feature-shell multi-page');
  const header = div('feature-header multi-header');
  header.innerHTML = `
    <div class="feature-heading">
      <span class="feature-kicker">Multi RVT Hub</span>
      <h2 class="feature-title">다중 RVT 검토 허브</h2>
      <p class="feature-sub">파일별로 열고 선택된 기능을 순차 실행합니다.</p>
    </div>`;
  page.append(header);

  const group1 = buildGroupSection('납품 시 BQC 검토', '커넥터 진단 (BQC용)');
  const group2 = buildGroupSection('주기적 검토', 'PMS / GUID / 파라미터 연동');
  const group3 = buildGroupSection('유틸리티', '공유 파라미터 연동 / Point 추출');

  const group1Options = buildGroup1Options();
  group1.section.append(group1Options);
  group1.section.append(buildToggleRow('connector', '커넥터 진단', 'Parameter 값 연속성 검토', buildConnectorConfig()));
  group2.section.append(buildToggleRow('pms', 'PMS 검토', 'Segment ↔ PMS 매핑 및 사이즈 검토', buildPmsConfig()));
  group2.section.append(buildToggleRow('guid', 'GUID 검토', '공유 파라미터 GUID 불일치 검토', buildGuidConfig()));
  group2.section.append(buildToggleRow('paramprop', '파라미터 연동검토', '공유 파라미터 추가 및 연동', buildParamPropConfig()));
  group3.section.append(buildToggleRow('familylink', '공유 파라미터 추가 및 연동', '네스티드 패밀리 연동 검토', buildFamilyLinkConfig()));
  group3.section.append(buildToggleRow('points', 'Point 추출', 'Project/Survey Point 좌표 추출', buildPointsConfig()));

  page.append(group1.wrap, group2.wrap, group3.wrap, buildRvtSection(), buildFooter());
  target.append(page);

  onHost('hub:rvt-picked', (payload) => {
    const paths = Array.isArray(payload?.paths) ? payload.paths : [];
    if (!paths.length) return;
    let changed = false;
    paths.forEach((p) => {
      if (!state.rvtList.includes(p)) {
        state.rvtList.push(p);
        state.rvtChecked.add(p);
        changed = true;
      }
    });
    if (changed) {
      markAllStale();
      renderRvtList();
    }
  });

  onHost('hub:multi-progress', (payload) => {
    const basePct = Number(payload?.percent);
    const altPct = Number(payload?.phaseProgress);
    const pctValue = Number.isFinite(basePct) ? basePct : (Number.isFinite(altPct) ? altPct * 100 : 0);
    const pct = Math.max(0, Math.min(100, pctValue));
    ProgressDialog.show(payload?.title || '다중 RVT 검토', payload?.message || '');
    ProgressDialog.update(pct, payload?.message || '', payload?.detail || '');
  });

  onHost('hub:multi-done', (payload) => {
    setBusyState(false);
    ProgressDialog.update(100, '완료', '검토가 완료되었습니다.');
    setTimeout(() => ProgressDialog.hide(), 500);
    updateResultSummary(payload?.summary || {});
  });

  onHost('hub:multi-error', (payload) => {
    setBusyState(false);
    ProgressDialog.hide();
    toast(payload?.message || '배치 검토 중 오류가 발생했습니다.', 'err');
  });

  onHost('hub:multi-exported', (payload) => {
    setBusyState(false);
    const path = payload?.path;
    if (path) {
      showExcelSavedDialog('엑셀 저장 완료', path, (p) => post('excel:open', { path: p }));
    } else {
      toast(payload?.message || '엑셀 저장에 실패했습니다.', 'err');
    }
  });

  onHost('segmentpms:pms-registered', (payload) => {
    state.features.pms.pmsReady = !!payload?.path;
    syncFeatureRow('pms');
  });

  onHost('sharedparam:list', (payload) => {
    state.sharedParams = Array.isArray(payload?.definitions) ? payload.definitions : [];
    state.paramGroups = Array.isArray(payload?.targetGroups) ? payload.targetGroups : [];
    state.features.paramprop.ready = state.sharedParams.length > 0;
    repaintParamPropOptions();
  });

  onHost('familylink:sharedparams', (payload) => {
    state.familyParams = Array.isArray(payload?.items) ? payload.items : [];
    state.features.familylink.ready = state.familyParams.length > 0;
    repaintFamilyLinkOptions();
  });

  post('sharedparam:list', {});
  post('familylink:init', {});

  function buildGroupSection(title, desc) {
    const wrap = div('multi-section');
    const head = div('multi-section-title');
    head.innerHTML = `<h3>${title}</h3><span class="feature-note">${desc}</span>`;
    wrap.append(head);
    return { wrap, section: wrap };
  }

  function buildGroup1Options() {
    const panel = div('multi-group-options');
    panel.innerHTML = `<div class="section-header"><h4>그룹 공통 옵션</h4></div>`;
    const fields = div('multi-config is-open');
    const extra = makeField('추가 Parameter 값 추출', 'extra', 'PM1, PM2', 'textarea');
    const filter = makeField('검토 대상 필터', 'filter', 'ex) PM1=Value', 'text');
    const exclude = makeCheckboxField('End_ + Dummy 패밀리 제외');

    extra.input.value = state.common.extraParams;
    filter.input.value = state.common.targetFilter;
    exclude.input.checked = state.common.excludeEndDummy;

    extra.input.addEventListener('change', () => {
      state.common.extraParams = extra.input.value;
      markStale('connector');
    });
    filter.input.addEventListener('change', () => {
      state.common.targetFilter = filter.input.value;
      markStale('connector');
    });
    exclude.input.addEventListener('change', () => {
      state.common.excludeEndDummy = exclude.input.checked;
      markStale('connector');
    });

    fields.append(extra.field, filter.field, exclude.field);
    panel.append(fields);
    return panel;
  }

  function buildToggleRow(key, title, desc, config) {
    const row = div('multi-toggle-row');
    row.dataset.key = key;
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.addEventListener('change', () => {
      state.features[key].enabled = toggle.checked;
      row.classList.toggle('is-active', toggle.checked);
      config.panel.classList.toggle('is-open', toggle.checked);
      markStale(key);
    });

    const meta = div('multi-toggle-meta');
    meta.innerHTML = `<h4>${title}</h4><p>${desc}</p>`;

    const actions = div('multi-toggle-actions');
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'btn-outline';
    exportBtn.textContent = '엑셀 내보내기';
    exportBtn.disabled = true;
    exportBtn.addEventListener('click', () => onExport(key));
    actions.append(exportBtn);

    row.append(toggle, meta, actions);
    row.append(config.panel);
    config.exportBtn = exportBtn;
    syncFeatureRow(key);
    return row;
  }

  function buildConnectorConfig() {
    const panel = div('multi-config');
    const tol = makeField('허용범위', 'tol', '', 'number');
    tol.input.value = state.features.connector.tol;
    tol.input.addEventListener('change', () => {
      state.features.connector.tol = parseFloat(tol.input.value || '1') || 1;
      markStale('connector');
    });

    const unit = makeSelectField('단위', [
      { value: 'inch', label: 'inch' },
      { value: 'mm', label: 'mm' }
    ]);
    unit.select.value = state.features.connector.unit;
    unit.select.addEventListener('change', () => {
      state.features.connector.unit = unit.select.value;
      markStale('connector');
    });

    const param = makeField('파라미터', 'param', 'Comments', 'text');
    param.input.value = state.features.connector.param;
    param.input.addEventListener('change', () => {
      state.features.connector.param = param.input.value || 'Comments';
      markStale('connector');
    });

    panel.append(tol.field, unit.field, param.field);
    return { panel };
  }

  function buildPmsConfig() {
    const panel = div('multi-config');
    const ndRound = makeField('ND Round', 'ndRound', '3', 'number');
    ndRound.input.value = state.features.pms.ndRound;
    ndRound.input.addEventListener('change', () => {
      state.features.pms.ndRound = parseInt(ndRound.input.value || '3', 10) || 3;
      markStale('pms');
    });
    const tol = makeField('허용오차(mm)', 'tolMm', '0.01', 'number');
    tol.input.value = state.features.pms.tolMm;
    tol.input.addEventListener('change', () => {
      state.features.pms.tolMm = parseFloat(tol.input.value || '0.01') || 0.01;
      markStale('pms');
    });
    const classMatch = makeCheckboxField('Class 일치 여부 적용');
    classMatch.input.checked = state.features.pms.classMatch;
    classMatch.input.addEventListener('change', () => {
      state.features.pms.classMatch = classMatch.input.checked;
      markStale('pms');
    });
    const pmsBtn = document.createElement('button');
    pmsBtn.type = 'button';
    pmsBtn.className = 'btn-outline';
    pmsBtn.textContent = 'PMS Excel 등록';
    pmsBtn.addEventListener('click', () => post('segmentpms:register-pms', { unit: 'mm' }));
    const pmsField = div('field');
    pmsField.append(document.createTextNode('PMS 파일'));
    pmsField.append(pmsBtn);
    panel.append(ndRound.field, tol.field, classMatch.field, pmsField);
    return { panel };
  }

  function buildGuidConfig() {
    const panel = div('multi-config');
    const includeFamily = makeCheckboxField('패밀리 포함');
    includeFamily.input.checked = state.features.guid.includeFamily;
    includeFamily.input.addEventListener('change', () => {
      state.features.guid.includeFamily = includeFamily.input.checked;
      markStale('guid');
    });
    const includeAnno = makeCheckboxField('Annotation 패밀리 포함');
    includeAnno.input.checked = state.features.guid.includeAnnotation;
    includeAnno.input.addEventListener('change', () => {
      state.features.guid.includeAnnotation = includeAnno.input.checked;
      markStale('guid');
    });
    panel.append(includeFamily.field, includeAnno.field);
    return { panel };
  }

  function buildParamPropConfig() {
    const panel = div('multi-config');
    const groupSelect = makeSelectField('타겟 그룹', []);
    const list = document.createElement('div');
    list.className = 'multi-param-list';
    panel.append(groupSelect.field, list);

    groupSelect.select.addEventListener('change', () => {
      state.features.paramprop.group = groupSelect.select.value;
      markStale('paramprop');
    });

    const instance = makeCheckboxField('인스턴스 파라미터로 추가');
    instance.input.checked = state.features.paramprop.isInstance;
    instance.input.addEventListener('change', () => {
      state.features.paramprop.isInstance = instance.input.checked;
      markStale('paramprop');
    });

    const exclude = makeCheckboxField('End_ + Dummy 패밀리 제외');
    exclude.input.checked = state.features.paramprop.excludeDummy;
    exclude.input.addEventListener('change', () => {
      state.features.paramprop.excludeDummy = exclude.input.checked;
      markStale('paramprop');
    });

    panel.append(instance.field, exclude.field);

    function repaint() {
      groupSelect.select.innerHTML = '';
      state.paramGroups.forEach((g) => {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = g.name;
        groupSelect.select.append(opt);
      });
      if (!state.features.paramprop.group && state.paramGroups.length) {
        state.features.paramprop.group = state.paramGroups[0].id;
        groupSelect.select.value = state.features.paramprop.group;
      }
      list.innerHTML = '';
      state.sharedParams.forEach((p) => {
        const item = document.createElement('label');
        item.className = 'field';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = state.features.paramprop.paramNames.includes(p.name);
        input.addEventListener('change', () => {
          toggleListValue(state.features.paramprop.paramNames, p.name, input.checked);
          markStale('paramprop');
        });
        item.append(input, document.createTextNode(` ${p.name}`));
        list.append(item);
      });
    }

    buildParamPropConfig.repaint = repaint;
    return { panel };
  }

  function buildFamilyLinkConfig() {
    const panel = div('multi-config');
    const list = document.createElement('div');
    list.className = 'multi-param-list';
    panel.append(list);

    function repaint() {
      list.innerHTML = '';
      state.familyParams.forEach((p) => {
        const item = document.createElement('label');
        item.className = 'field';
        const input = document.createElement('input');
        input.type = 'checkbox';
        const key = `${p.name}|${p.guid}`;
        input.checked = state.features.familylink.targets.some((t) => `${t.name}|${t.guid}` === key);
        input.addEventListener('change', () => {
          toggleTarget(p, input.checked);
          markStale('familylink');
        });
        item.append(input, document.createTextNode(` ${p.name}`));
        list.append(item);
      });
    }

    buildFamilyLinkConfig.repaint = repaint;
    return { panel };
  }

  function buildPointsConfig() {
    const panel = div('multi-config');
    const unit = makeSelectField('단위', [
      { value: 'ft', label: 'Decimal Feet' },
      { value: 'm', label: 'Meters (m)' }
    ]);
    unit.select.value = state.features.points.unit;
    unit.select.addEventListener('change', () => {
      state.features.points.unit = unit.select.value;
      markStale('points');
    });
    panel.append(unit.field);
    return { panel };
  }

  function buildRvtSection() {
    const section = div('multi-section');
    const head = div('multi-section-title');
    head.innerHTML = '<h3>RVT 리스트</h3>';
    section.append(head);

    const controls = div('multi-rvt-controls');
    const btnAdd = cardBtn('RVT 추가', () => post('hub:pick-rvt', {}));
    const btnRemove = cardBtn('선택 제거', () => {
      state.rvtList = state.rvtList.filter((p) => !state.rvtChecked.has(p));
      state.rvtChecked.clear();
      markAllStale();
      renderRvtList();
    });
    const btnClear = cardBtn('목록 지우기', () => {
      state.rvtList = [];
      state.rvtChecked.clear();
      markAllStale();
      renderRvtList();
    });
    controls.append(btnAdd, btnRemove, btnClear);

    const { table, tbody, master } = createRvtTable();
    const summary = div('multi-rvt-summary');

    section.append(controls, table, summary);

    function syncMaster() {
      const allChecked = state.rvtList.length > 0 && state.rvtList.every((p) => state.rvtChecked.has(p));
      master.checked = allChecked;
    }

    master.addEventListener('change', () => {
      if (master.checked) {
        state.rvtList.forEach((p) => state.rvtChecked.add(p));
      } else {
        state.rvtChecked.clear();
      }
      renderRvtList();
    });

    function renderRvtList() {
      const rows = state.rvtList.map((path, idx) => ({
        index: idx + 1,
        path,
        name: getRvtName(path),
        checked: state.rvtChecked.has(path),
        onToggle: (checked) => {
          if (checked) state.rvtChecked.add(path);
          else state.rvtChecked.delete(path);
          syncMaster();
        }
      }));
      renderRvtRows(tbody, rows, '등록된 RVT가 없습니다.');
      summary.textContent = `총 파일 수: ${state.rvtList.length}`;
      syncMaster();
      btnRemove.disabled = state.rvtChecked.size === 0;
      btnClear.disabled = state.rvtList.length === 0;
    }

    buildRvtSection.render = renderRvtList;
    renderRvtList();
    return section;
  }

  function buildFooter() {
    const foot = div('multi-footer');
    const info = div('multi-rvt-summary');
    info.textContent = '선택한 기능을 실행합니다.';
    const startBtn = cardBtn('검토 시작', onRun);
    startBtn.classList.add('btn-primary', 'multi-start-btn');
    foot.append(info, startBtn);
    buildFooter.startBtn = startBtn;
    return foot;
  }

  function makeField(label, name, placeholder, type) {
    const field = div('field');
    const lab = document.createElement('label');
    lab.textContent = label;
    const input = type === 'textarea' ? document.createElement('textarea') : document.createElement('input');
    if (type !== 'textarea') input.type = type;
    input.placeholder = placeholder || '';
    input.name = name;
    field.append(lab, input);
    return { field, input };
  }

  function makeSelectField(label, options) {
    const field = div('field');
    const lab = document.createElement('label');
    lab.textContent = label;
    const select = document.createElement('select');
    options.forEach((opt) => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      select.append(option);
    });
    field.append(lab, select);
    return { field, select };
  }

  function makeCheckboxField(label) {
    const field = div('field');
    const wrapper = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    wrapper.append(input, document.createTextNode(` ${label}`));
    field.append(wrapper);
    return { field, input };
  }

  function cardBtn(label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-outline';
    btn.textContent = label;
    if (onClick) btn.addEventListener('click', onClick);
    return btn;
  }

  function toggleListValue(arr, value, on) {
    const idx = arr.indexOf(value);
    if (on && idx < 0) arr.push(value);
    if (!on && idx >= 0) arr.splice(idx, 1);
  }

  function toggleTarget(item, on) {
    const key = `${item.name}|${item.guid}`;
    const idx = state.features.familylink.targets.findIndex((t) => `${t.name}|${t.guid}` === key);
    if (on && idx < 0) state.features.familylink.targets.push({ name: item.name, guid: item.guid });
    if (!on && idx >= 0) state.features.familylink.targets.splice(idx, 1);
  }

  function markStale(key) {
    state.results[key].stale = true;
    state.results[key].count = 0;
    syncFeatureRow(key);
    post('hub:multi-clear', { key });
  }

  function markAllStale() {
    FEATURE_KEYS.forEach(markStale);
  }

  function syncFeatureRow(key) {
    const row = page.querySelector(`.multi-toggle-row[data-key="${key}"]`);
    if (!row) return;
    const exportBtn = row.querySelector('button.btn-outline');
    const res = state.results[key];
    exportBtn.disabled = state.busy || res.stale || res.count === 0;
  }

  function updateResultSummary(summary) {
    Object.keys(summary || {}).forEach((key) => {
      if (!state.results[key]) return;
      state.results[key].count = summary[key].rows || 0;
      state.results[key].stale = false;
      syncFeatureRow(key);
    });
  }

  function onRun() {
    const selected = FEATURE_KEYS.filter((k) => state.features[k].enabled);
    if (!selected.length) {
      toast('선택된 기능이 없습니다.', 'warn');
      return;
    }
    if (!state.rvtList.length) {
      toast('RVT 파일을 추가하세요.', 'warn');
      return;
    }
    if (state.features.pms.enabled && !state.features.pms.pmsReady) {
      toast('PMS Excel을 먼저 등록하세요.', 'warn');
      return;
    }
    if (state.features.paramprop.enabled && !state.features.paramprop.paramNames.length) {
      toast('파라미터 연동 검토에 사용할 파라미터를 선택하세요.', 'warn');
      return;
    }
    if (state.features.familylink.enabled && !state.features.familylink.targets.length) {
      toast('패밀리 연동 검토 대상 파라미터를 선택하세요.', 'warn');
      return;
    }

    setBusyState(true);
    ProgressDialog.show('다중 RVT 검토', '준비 중...');
    ProgressDialog.update(0, '준비 중...', '');
    post('hub:multi-run', buildPayload());
  }

  function buildPayload() {
    return {
      rvtPaths: state.rvtList.slice(),
      commonOptions: state.common,
      features: {
        connector: state.features.connector,
        pms: state.features.pms,
        guid: state.features.guid,
        paramprop: state.features.paramprop,
        familylink: state.features.familylink,
        points: state.features.points
      }
    };
  }

  function onExport(key) {
    setBusyState(true);
    chooseExcelMode((mode) => {
      post('hub:multi-export', { key, excelMode: mode || 'fast' });
    });
  }

  function setBusyState(on) {
    state.busy = on;
    setBusy(on);
    if (buildFooter.startBtn) buildFooter.startBtn.disabled = on;
    FEATURE_KEYS.forEach(syncFeatureRow);
    const inputs = page.querySelectorAll('input, select, textarea, button');
    inputs.forEach((el) => {
      if (el.classList.contains('multi-start-btn')) return;
      if (on) el.disabled = true;
      else if (!el.classList.contains('btn-primary')) el.disabled = false;
    });
    if (!on) renderRvtList();
  }

  function repaintParamPropOptions() {
    if (buildParamPropConfig.repaint) buildParamPropConfig.repaint();
  }

  function repaintFamilyLinkOptions() {
    if (buildFamilyLinkConfig.repaint) buildFamilyLinkConfig.repaint();
  }

  function renderRvtList() {
    if (buildRvtSection.render) buildRvtSection.render();
  }
}
