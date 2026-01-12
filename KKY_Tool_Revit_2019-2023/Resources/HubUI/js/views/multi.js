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

  const layout = div('multi-layout');
  const leftCol = div('multi-left');
  const rightCol = div('multi-right');

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

  leftCol.append(group1.wrap, group2.wrap, group3.wrap);
  rightCol.append(buildRunBar(), buildRvtSection());
  layout.append(leftCol, rightCol);
  page.append(layout);
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
    updateRunProgress(pct, payload?.message || '', payload?.detail || '');
  });

  onHost('hub:multi-done', (payload) => {
    setBusyState(false);
    ProgressDialog.update(100, '완료', '검토가 완료되었습니다.');
    setTimeout(() => ProgressDialog.hide(), 500);
    updateRunProgress(100, '완료', '검토가 완료되었습니다.');
    updateResultSummary(payload?.summary || {});
  });

  onHost('hub:multi-error', (payload) => {
    setBusyState(false);
    ProgressDialog.hide();
    updateRunProgress(0, '오류 발생', payload?.message || '');
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
    const row = div('multi-toggle-row feature-card');
    row.dataset.key = key;
    const header = div('feature-header-row');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'feature-toggle';
    toggle.addEventListener('change', () => {
      state.features[key].enabled = toggle.checked;
      row.classList.toggle('is-active', toggle.checked);
      config.panel.classList.toggle('is-open', toggle.checked);
      markStale(key);
      updateRunSummary();
    });

    const meta = div('multi-toggle-meta');
    meta.innerHTML = `<h4>${title}</h4><p>${desc}</p>`;

    const statusWrap = div('feature-status');
    const statusChip = document.createElement('span');
    statusChip.className = 'chip chip--off';
    const resultChip = document.createElement('span');
    resultChip.className = 'chip chip--result';
    resultChip.style.display = 'none';
    statusWrap.append(statusChip, resultChip);

    const actions = div('multi-toggle-actions');
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'btn-outline export-btn';
    exportBtn.textContent = '엑셀 내보내기';
    exportBtn.disabled = true;
    exportBtn.addEventListener('click', () => onExport(key));
    actions.append(statusWrap, exportBtn);

    header.append(toggle, meta, actions);
    row.append(header, config.panel);
    config.exportBtn = exportBtn;
    config.statusChip = statusChip;
    config.resultChip = resultChip;
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
    list.className = 'checklist';
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
        item.className = 'check-item';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = state.features.paramprop.paramNames.includes(p.name);
        input.addEventListener('change', () => {
          toggleListValue(state.features.paramprop.paramNames, p.name, input.checked);
          markStale('paramprop');
        });
        const text = document.createElement('span');
        text.textContent = p.name;
        item.append(input, text);
        list.append(item);
      });
    }

    buildParamPropConfig.repaint = repaint;
    return { panel };
  }

  function buildFamilyLinkConfig() {
    const panel = div('multi-config');
    const list = document.createElement('div');
    list.className = 'checklist';
    panel.append(list);

    function repaint() {
      list.innerHTML = '';
      state.familyParams.forEach((p) => {
        const item = document.createElement('label');
        item.className = 'check-item';
        const input = document.createElement('input');
        input.type = 'checkbox';
        const key = `${p.name}|${p.guid}`;
        input.checked = state.features.familylink.targets.some((t) => `${t.name}|${t.guid}` === key);
        input.addEventListener('change', () => {
          toggleTarget(p, input.checked);
          markStale('familylink');
        });
        const text = document.createElement('span');
        text.textContent = p.name;
        item.append(input, text);
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
    const section = div('multi-section rvt-panel');
    const head = div('rvt-panel-header');
    const title = document.createElement('div');
    title.className = 'rvt-panel-title';
    const badge = document.createElement('span');
    badge.className = 'chip chip--info';
    title.innerHTML = '<h3>RVT 리스트</h3>';
    title.append(badge);

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

    head.append(title, controls);
    section.append(head);

    const body = div('rvt-panel-body');
    const { table, tbody, master } = createRvtTable();
    const summary = div('multi-rvt-summary');
    const empty = div('rvt-empty');
    const emptyTitle = document.createElement('strong');
    emptyTitle.textContent = '등록된 RVT가 없습니다.';
    const emptySub = document.createElement('span');
    emptySub.textContent = 'RVT 추가로 파일을 등록하세요.';
    const emptyBtn = cardBtn('RVT 추가', () => post('hub:pick-rvt', {}));
    emptyBtn.classList.add('btn-primary');
    empty.append(emptyTitle, emptySub, emptyBtn);

    body.append(table, empty, summary);
    section.append(body);

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
      const count = state.rvtList.length;
      summary.textContent = `총 파일 수: ${count}`;
      badge.textContent = `${count}개`;
      empty.style.display = count ? 'none' : 'flex';
      syncMaster();
      btnRemove.disabled = state.rvtChecked.size === 0;
      btnClear.disabled = state.rvtList.length === 0;
      updateRunSummary();
    }

    buildRvtSection.render = renderRvtList;
    renderRvtList();
    return section;
  }

  function buildRunBar() {
    const bar = div('run-bar');
    const summary = div('run-summary');
    const status = div('run-status');
    const progressText = document.createElement('span');
    const progressDetail = document.createElement('small');
    const progressBar = document.createElement('div');
    progressBar.className = 'run-progress';
    const progressFill = document.createElement('div');
    progressFill.className = 'run-progress-fill';
    progressBar.append(progressFill);
    status.append(progressText, progressDetail, progressBar);

    const startBtn = cardBtn('검토 시작', onRun);
    startBtn.classList.add('btn-primary', 'multi-start-btn');
    bar.append(summary, status, startBtn);

    buildRunBar.startBtn = startBtn;
    buildRunBar.summary = summary;
    buildRunBar.progressText = progressText;
    buildRunBar.progressDetail = progressDetail;
    buildRunBar.progressFill = progressFill;
    updateRunSummary();
    updateRunProgress(0, '대기 중', '');
    return bar;
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
    const exportBtn = row.querySelector('button.export-btn');
    const statusChip = row.querySelector('.chip');
    const resultChip = row.querySelector('.chip--result');
    const res = state.results[key];
    exportBtn.disabled = state.busy || res.stale || res.count === 0;
    exportBtn.title = exportBtn.disabled ? '결과가 없습니다.' : '';

    const feature = state.features[key];
    const readiness = getFeatureReadiness(key, feature);
    if (statusChip) {
      statusChip.textContent = readiness.label;
      statusChip.className = `chip ${readiness.className}`;
    }
    if (resultChip) {
      if (!res.stale && res.count > 0) {
        resultChip.textContent = `결과 ${res.count}`;
        resultChip.style.display = 'inline-flex';
      } else {
        resultChip.style.display = 'none';
      }
    }
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
    if (buildRunBar.startBtn) buildRunBar.startBtn.disabled = on;
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

  function updateRunSummary() {
    if (!buildRunBar.summary) return;
    const enabledCount = FEATURE_KEYS.filter((k) => state.features[k].enabled).length;
    const rvtCount = state.rvtList.length;
    buildRunBar.summary.innerHTML = `<strong>선택 기능: ${enabledCount}개</strong><span>RVT: ${rvtCount}개</span>`;
  }

  function updateRunProgress(percent, message, detail) {
    if (!buildRunBar.progressText) return;
    buildRunBar.progressText.textContent = message || '대기 중';
    buildRunBar.progressDetail.textContent = detail || '';
    if (buildRunBar.progressFill) {
      const pct = Math.max(0, Math.min(100, Number(percent) || 0));
      buildRunBar.progressFill.style.width = `${pct}%`;
    }
  }

  function getFeatureReadiness(key, feature) {
    if (!feature?.enabled) {
      return { label: 'OFF', className: 'chip--off' };
    }
    if (key === 'pms' && !feature.pmsReady) {
      return { label: '설정 필요', className: 'chip--warn' };
    }
    if (key === 'paramprop' && (!feature.paramNames || feature.paramNames.length === 0)) {
      return { label: '설정 필요', className: 'chip--warn' };
    }
    if (key === 'familylink' && (!feature.targets || feature.targets.length === 0)) {
      return { label: '설정 필요', className: 'chip--warn' };
    }
    return { label: '준비됨', className: 'chip--ok' };
  }
}
