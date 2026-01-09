// Resources/HubUI/js/views/familylink.js
import { clear, div, toast, debounce, showExcelSavedDialog } from '../core/dom.js';
import { ProgressDialog } from '../core/progress.js';
import { onHost, post } from '../core/bridge.js';
import { createRvtTable, renderRvtRows, getRvtName } from './rvtTable.js';

const DEFAULT_SCHEMA = [
  'ProjectPath',
  'HostFamilyName',
  'HostFamilyCategory',
  'NestedFamilyName',
  'NestedTypeName',
  'NestedCategory',
  'TargetParamName',
  'ExpectedGuid',
  'FoundScope',
  'NestedParamGuid',
  'NestedParamDataType',
  'AssocHostParamName',
  'HostParamGuid',
  'HostParamIsShared',
  'Issue',
  'Notes'
];

export function renderFamilyLink(root) {
  const target = root || document.getElementById('view-root') || document.getElementById('app');
  clear(target);

  const topbarEl = document.querySelector('#topbar-root .topbar') || document.querySelector('.topbar');
  if (topbarEl) topbarEl.classList.add('hub-topbar');

  const state = {
    sharedParams: [],
    selectedGuids: new Set(),
    availableChecked: new Set(),
    selectedChecked: new Set(),
    search: '',
    schema: DEFAULT_SCHEMA.slice(),
    rows: [],
    rvtPaths: [],
    rvtChecked: new Set(),
    busy: false
  };

  const page = div('familylink-page feature-shell');
  const header = div('feature-header');
  const heading = div('feature-heading');
  heading.innerHTML = `
    <span class="feature-kicker">Nested Family Association</span>
    <h2 class="feature-title">패밀리 연동 검토(복합/네스티드)</h2>
    <p class="feature-sub">Shared GUID 기준으로 네스티드 패밀리 파라미터 연동 상태를 점검합니다.</p>`;

  const runBtn = cardBtn('스캔 실행', onRun);
  const exportBtn = cardBtn('엑셀 저장…', onExport);
  exportBtn.disabled = true;

  const actions = div('feature-actions');
  actions.append(runBtn, exportBtn);
  header.append(heading, actions);
  page.append(header);

  const layout = div('familylink-layout');
  const side = div('familylink-side');
  const main = div('familylink-main');
  layout.append(side, main);
  page.append(layout);
  target.append(page);

  // Shared Param card
  const paramCard = div('familylink-card');
  paramCard.innerHTML = '<div class="familylink-card-title">Shared Parameter 선택</div>';
  const sourceLine = div('familylink-source');
  sourceLine.textContent = 'Shared Parameters: -';
  paramCard.append(sourceLine);

  const searchRow = div('familylink-row');
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = '이름 또는 그룹 검색';
  searchInput.className = 'familylink-search';
  searchInput.addEventListener('input', debounce((e) => {
    state.search = (e.target.value || '').trim();
    renderAvailableList();
  }, 120));
  searchRow.append(labelSpan('검색'), searchInput);
  paramCard.append(searchRow);

  const listGrid = div('familylink-list-grid');
  const availBox = buildListBox('공유 파라미터 목록', '그룹', 'familylink-list-box');
  const selectedBox = buildListBox('선택된 파라미터', 'GUID', 'familylink-list-box');
  listGrid.append(availBox.wrap, selectedBox.wrap);
  paramCard.append(listGrid);

  const actionRow = div('familylink-actions');
  const btnAdd = smallBtn('추가', () => {
    if (!state.availableChecked.size) {
      toast('추가할 파라미터를 선택하세요.', 'warn');
      return;
    }
    state.availableChecked.forEach(g => state.selectedGuids.add(g));
    state.availableChecked.clear();
    renderAvailableList();
    renderSelectedList();
    syncRunState();
  });
  const btnRemove = smallBtn('제거', () => {
    if (!state.selectedChecked.size) {
      toast('제거할 파라미터를 선택하세요.', 'warn');
      return;
    }
    state.selectedChecked.forEach(g => state.selectedGuids.delete(g));
    state.selectedChecked.clear();
    renderSelectedList();
    syncRunState();
  });
  const btnClear = smallBtn('비우기', () => {
    state.selectedGuids.clear();
    state.selectedChecked.clear();
    renderSelectedList();
    syncRunState();
  });
  actionRow.append(btnAdd, btnRemove, btnClear);
  paramCard.append(actionRow);

  // RVT card
  const rvtCard = div('familylink-card');
  rvtCard.innerHTML = '<div class="familylink-card-title">RVT 목록</div>';
  const rvtActions = div('familylink-actions');
  const btnAddRvt = smallBtn('RVT 추가…', () => post('familylink:pick-rvts', {}));
  const btnRemoveRvt = smallBtn('선택 제거', () => {
    if (!state.rvtChecked.size) return;
    state.rvtPaths = state.rvtPaths.filter(p => !state.rvtChecked.has(p));
    state.rvtChecked.clear();
    renderRvtList();
    syncRunState();
  });
  const btnClearRvt = smallBtn('비우기', () => {
    state.rvtPaths = [];
    state.rvtChecked.clear();
    renderRvtList();
    syncRunState();
  });
  rvtActions.append(btnAddRvt, btnRemoveRvt, btnClearRvt);
  rvtCard.append(rvtActions);

  const rvtTableWrap = div('familylink-rvt-table');
  const { table: rvtTable, tbody: rvtTbody, master: rvtMaster } = createRvtTable();
  rvtTableWrap.append(rvtTable);
  rvtCard.append(rvtTableWrap);

  side.append(paramCard, rvtCard);

  // Results panel
  const resultPanel = div('familylink-results');
  const resultHead = div('familylink-results-head');
  const resultTitle = div('familylink-results-title');
  resultTitle.textContent = '결과';
  const resultMeta = div('familylink-results-meta');
  resultMeta.textContent = '0 rows';
  resultHead.append(resultTitle, resultMeta);
  const resultBody = div('familylink-results-body');
  const resultTable = document.createElement('table');
  resultTable.className = 'familylink-table';
  const resultThead = document.createElement('thead');
  const resultTbody = document.createElement('tbody');
  resultTable.append(resultThead, resultTbody);
  resultBody.append(resultTable);
  resultPanel.append(resultHead, resultBody);
  main.append(resultPanel);

  renderAvailableList();
  renderSelectedList();
  renderRvtList();
  renderResultTable();
  syncRunState();

  // Host events
  onHost('familylink:sharedparams', handleSharedParams);
  onHost('familylink:rvts-picked', handleRvtsPicked);
  onHost('familylink:progress', handleProgress);
  onHost('familylink:result', handleResult);
  onHost('familylink:error', handleError);
  onHost('familylink:exported', handleExported);

  post('familylink:init', {});

  // handlers
  function handleSharedParams(payload) {
    state.sharedParams = Array.isArray(payload?.items) ? payload.items : [];
    sourceLine.textContent = payload?.sourcePath ? `Shared Parameters: ${payload.sourcePath}` : 'Shared Parameters: -';
    state.availableChecked.clear();
    state.selectedGuids.clear();
    state.selectedChecked.clear();
    renderAvailableList();
    renderSelectedList();
    syncRunState();
  }

  function handleRvtsPicked(payload) {
    const paths = Array.isArray(payload?.paths) ? payload.paths : [];
    const existing = new Set(state.rvtPaths.map(p => p.toLowerCase()));
    paths.forEach(p => {
      if (!p) return;
      const key = p.toLowerCase();
      if (!existing.has(key)) {
        existing.add(key);
        state.rvtPaths.push(p);
      }
    });
    renderRvtList();
    syncRunState();
  }

  function handleProgress(payload) {
    if (!payload) return;
    const pct = Math.max(0, Math.min(100, Number(payload.percent) || 0));
    const msg = payload.message || '';
    ProgressDialog.show('패밀리 연동 검토', msg || '진행 중...');
    ProgressDialog.update(pct, msg || '진행 중...', '');
    if (pct >= 100) {
      setTimeout(() => ProgressDialog.hide(), 350);
    }
  }

  function handleResult(payload) {
    state.rows = Array.isArray(payload?.rows) ? payload.rows : [];
    state.schema = Array.isArray(payload?.schema) && payload.schema.length ? payload.schema : DEFAULT_SCHEMA.slice();
    renderResultTable();
    exportBtn.disabled = state.rows.length === 0 || state.busy;
    setBusy(false);
    ProgressDialog.hide();
  }

  function handleError(payload) {
    setBusy(false);
    ProgressDialog.hide();
    const message = payload?.message || '작업 중 오류가 발생했습니다.';
    toast(message, 'err', 3200);
  }

  function handleExported(payload) {
    const ok = payload?.ok !== false && payload?.path;
    exportBtn.disabled = state.rows.length === 0 || state.busy;
    if (ok) {
      showExcelSavedDialog('엑셀/CSV 저장이 완료되었습니다.', payload.path, (p) => post('excel:open', { path: p }));
    } else {
      toast(payload?.message || '엑셀/CSV 저장 실패', 'err');
    }
  }

  function onRun() {
    if (state.busy) return;
    if (!state.rvtPaths.length) {
      toast('검토할 RVT 파일을 추가하세요.', 'warn');
      return;
    }
    const targets = state.sharedParams.filter(p => state.selectedGuids.has(p.guid));
    if (!targets.length) {
      toast('검토할 파라미터를 선택하세요.', 'warn');
      return;
    }

    setBusy(true);
    exportBtn.disabled = true;
    ProgressDialog.show('패밀리 연동 검토', '준비 중...');
    ProgressDialog.update(0, '준비 중...', '');

    const payload = {
      rvtPaths: state.rvtPaths.slice(),
      targets: targets.map(t => ({ name: t.name, guid: t.guid }))
    };
    post('familylink:run', payload);
  }

  function onExport() {
    if (state.busy || !state.rows.length) return;
    exportBtn.disabled = true;
    post('familylink:export', {});
  }

  function setBusy(on) {
    state.busy = on;
    runBtn.disabled = on;
    runBtn.textContent = on ? '스캔 중…' : '스캔 실행';
    syncRunState();
  }

  function syncRunState() {
    const hasTargets = state.selectedGuids.size > 0;
    const hasRvts = state.rvtPaths.length > 0;
    runBtn.disabled = state.busy || !(hasTargets && hasRvts);
    exportBtn.disabled = state.busy || state.rows.length === 0;
    btnRemoveRvt.disabled = state.rvtChecked.size === 0;
  }

  function renderAvailableList() {
    const filter = state.search.toLowerCase();
    const items = state.sharedParams.filter(p => {
      if (!filter) return true;
      const key = `${p.name || ''} ${p.groupName || ''}`.toLowerCase();
      return key.includes(filter);
    });
    availBox.tbody.innerHTML = '';

    if (!items.length) {
      availBox.tbody.append(emptyRow(3, '조건에 맞는 파라미터가 없습니다.'));
      return;
    }

    items.forEach(p => {
      const tr = document.createElement('tr');
      const ck = document.createElement('input');
      ck.type = 'checkbox';
      ck.checked = state.availableChecked.has(p.guid);
      ck.onchange = () => {
        if (ck.checked) state.availableChecked.add(p.guid);
        else state.availableChecked.delete(p.guid);
      };
      const tdCheck = document.createElement('td');
      tdCheck.append(ck);
      const tdName = document.createElement('td');
      tdName.textContent = p.name || '-';
      const tdGroup = document.createElement('td');
      tdGroup.textContent = p.groupName || '-';
      tr.append(tdCheck, tdName, tdGroup);
      availBox.tbody.append(tr);
    });
  }

  function renderSelectedList() {
    const selected = state.sharedParams.filter(p => state.selectedGuids.has(p.guid));
    selectedBox.tbody.innerHTML = '';

    if (!selected.length) {
      selectedBox.tbody.append(emptyRow(3, '선택된 파라미터가 없습니다.'));
      return;
    }

    selected.forEach(p => {
      const tr = document.createElement('tr');
      const ck = document.createElement('input');
      ck.type = 'checkbox';
      ck.checked = state.selectedChecked.has(p.guid);
      ck.onchange = () => {
        if (ck.checked) state.selectedChecked.add(p.guid);
        else state.selectedChecked.delete(p.guid);
      };
      const tdCheck = document.createElement('td');
      tdCheck.append(ck);
      const tdName = document.createElement('td');
      tdName.textContent = p.name || '-';
      const tdGuid = document.createElement('td');
      tdGuid.textContent = shortGuid(p.guid);
      tdGuid.title = p.guid || '';
      tr.append(tdCheck, tdName, tdGuid);
      selectedBox.tbody.append(tr);
    });
  }

  function renderRvtList() {
    const rows = state.rvtPaths.map((path, idx) => ({
      index: idx + 1,
      name: getRvtName(path, '—'),
      path,
      checked: state.rvtChecked.has(path),
      onToggle: (checked) => {
        if (checked) state.rvtChecked.add(path);
        else state.rvtChecked.delete(path);
        syncRunState();
      }
    }));

    renderRvtRows(rvtTbody, rows, '등록된 RVT가 없습니다.');
    rvtMaster.checked = rows.length > 0 && rows.every(r => r.checked);
    rvtMaster.indeterminate = rows.some(r => r.checked) && !rvtMaster.checked;
    rvtMaster.onchange = () => {
      state.rvtChecked.clear();
      if (rvtMaster.checked) rows.forEach(r => state.rvtChecked.add(r.path));
      renderRvtList();
      syncRunState();
    };
  }

  function renderResultTable() {
    resultThead.innerHTML = '';
    resultTbody.innerHTML = '';

    const headRow = document.createElement('tr');
    state.schema.forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      headRow.append(th);
    });
    resultThead.append(headRow);

    if (!state.rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = state.schema.length;
      td.className = 'familylink-empty';
      td.textContent = '결과가 없습니다. 스캔을 실행하세요.';
      tr.append(td);
      resultTbody.append(tr);
    } else {
      state.rows.forEach(row => {
        const tr = document.createElement('tr');
        state.schema.forEach(h => {
          const td = document.createElement('td');
          const val = row?.[h];
          td.textContent = val == null ? '' : String(val);
          tr.append(td);
        });
        resultTbody.append(tr);
      });
    }

    resultMeta.textContent = `${state.rows.length} rows`;
  }

  function buildListBox(title, col3Label, extraClass = '') {
    const wrap = div(`familylink-list ${extraClass}`);
    const head = div('familylink-list-title');
    head.textContent = title;
    const table = document.createElement('table');
    table.className = 'familylink-table compact';
    const thead = document.createElement('thead');
    thead.innerHTML = `<tr><th></th><th>이름</th><th>${col3Label}</th></tr>`;
    const tbody = document.createElement('tbody');
    table.append(thead, tbody);
    wrap.append(head, table);
    return { wrap, tbody };
  }

  function emptyRow(colspan, message) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = colspan;
    td.className = 'familylink-empty';
    td.textContent = message;
    tr.append(td);
    return tr;
  }

  function shortGuid(guid) {
    if (!guid) return '-';
    return String(guid).slice(0, 8);
  }
}

function cardBtn(text, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn card-btn';
  btn.textContent = text;
  btn.onclick = onClick;
  return btn;
}

function smallBtn(text, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-ghost familylink-btn';
  btn.textContent = text;
  btn.onclick = onClick;
  return btn;
}

function labelSpan(text) {
  const span = document.createElement('span');
  span.className = 'familylink-label';
  span.textContent = text;
  return span;
}
