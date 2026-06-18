import { bitable, FieldType } from '@lark-base-open/js-sdk';
import './styles.css';

const DEFAULT_SERVER = 'http://127.0.0.1:3100';
const STORAGE_KEY_PREFIX = 'fs-sidebar-signature';
const STATUS_PENDING = '待签字';
const STATUS_VIEWED = '已查看未签字';
const STATUS_DONE = '已签字';
const AUTO_SYNC_INTERVAL = 1000;

type FieldMeta = {
  id?: string;
  field_id?: string;
  name?: string;
  field_name?: string;
  type?: unknown;
  ui_type?: string;
};

type SignatureFlow = {
  id: string;
  name: string;
  configId: string;
  apiKey: string;
  selectedFieldIds: string[];
  signLinkFieldId: string;
  automationConfirmFieldId: string;
  automationLinkFieldId: string;
  statusFieldId: string;
  shotLinkFieldId: string;
  autoSyncEnabled: boolean;
  syncCount: number;
};

type AppState = {
  serverBase: string;
  appToken: string;
  tableId: string;
  viewId: string;
  tableName: string;
  viewName: string;
  authCode: string;
  fields: FieldMeta[];
  flows: SignatureFlow[];
  activeFlowId: string;
  selectedFieldIds: Set<string>;
  signLinkFieldId: string;
  automationConfirmFieldId: string;
  automationLinkFieldId: string;
  statusFieldId: string;
  shotLinkFieldId: string;
  configId: string;
  apiKey: string;
  autoSyncEnabled: boolean;
  syncActive: boolean;
  syncInProgress: boolean;
  syncCount: number;
  busy: boolean;
  message: { type: 'info' | 'success' | 'error'; text: string } | null;
  lastResult: string;
};

type RenderSnapshot = {
  windowScrollX: number;
  windowScrollY: number;
  fieldListScrollTop: number;
  activeElementId: string;
  selectionStart: number | null;
  selectionEnd: number | null;
};

const state: AppState = {
  serverBase: DEFAULT_SERVER,
  appToken: '',
  tableId: '',
  viewId: '',
  tableName: '',
  viewName: '',
  authCode: '',
  fields: [],
  flows: [],
  activeFlowId: '',
  selectedFieldIds: new Set(),
  signLinkFieldId: '',
  automationConfirmFieldId: '',
  automationLinkFieldId: '',
  statusFieldId: '',
  shotLinkFieldId: '',
  configId: '',
  apiKey: '',
  autoSyncEnabled: true,
  syncActive: false,
  syncInProgress: false,
  syncCount: 0,
  busy: false,
  message: { type: 'info', text: '正在读取飞书多维表格信息...' },
  lastResult: ''
};

const app = document.querySelector<HTMLDivElement>('#app')!;
let syncTimer: number | null = null;
let unsubscribeRecordAdd: (() => void) | null = null;
let unsubscribeRecordModify: (() => void) | null = null;
const pendingRecordTimers = new Map<string, number>();

function fieldId(field: FieldMeta): string {
  return String(field.id || field.field_id || '');
}

function fieldName(field: FieldMeta): string {
  return String(field.name || field.field_name || fieldId(field));
}

function createFlow(name = '门店'): SignatureFlow {
  return {
    id: createConfigId(),
    name,
    configId: '',
    apiKey: '',
    selectedFieldIds: [],
    signLinkFieldId: '',
    automationConfirmFieldId: '',
    automationLinkFieldId: '',
    statusFieldId: '',
    shotLinkFieldId: '',
    autoSyncEnabled: true,
    syncCount: 0
  };
}

function activeFlow(): SignatureFlow {
  if (!state.flows.length) {
    const flow = createFlow('门店');
    state.flows.push(flow);
    state.activeFlowId = flow.id;
  }
  let flow = state.flows.find(item => item.id === state.activeFlowId);
  if (!flow) {
    flow = state.flows[0];
    state.activeFlowId = flow.id;
  }
  return flow;
}

function applyFlowToState(flow: SignatureFlow) {
  state.activeFlowId = flow.id;
  state.configId = flow.configId || '';
  state.apiKey = flow.apiKey || '';
  state.signLinkFieldId = flow.signLinkFieldId || '';
  state.automationConfirmFieldId = flow.automationConfirmFieldId || '';
  state.automationLinkFieldId = flow.automationLinkFieldId || '';
  state.statusFieldId = flow.statusFieldId || '';
  state.shotLinkFieldId = flow.shotLinkFieldId || '';
  state.selectedFieldIds = new Set(flow.selectedFieldIds || []);
  state.autoSyncEnabled = flow.autoSyncEnabled !== false;
  state.syncCount = flow.syncCount || 0;
}

function persistStateToActiveFlow() {
  const flow = activeFlow();
  flow.configId = state.configId;
  flow.apiKey = state.apiKey;
  flow.signLinkFieldId = state.signLinkFieldId;
  flow.automationConfirmFieldId = state.automationConfirmFieldId;
  flow.automationLinkFieldId = state.automationLinkFieldId;
  flow.statusFieldId = state.statusFieldId;
  flow.shotLinkFieldId = state.shotLinkFieldId;
  flow.selectedFieldIds = Array.from(state.selectedFieldIds);
  flow.autoSyncEnabled = state.autoSyncEnabled;
  flow.syncCount = state.syncCount;
}

function flowBaseName(): string {
  return activeFlow().name.trim() || '签字';
}

function flowFieldName(kind: 'confirm' | 'automation' | 'status' | 'shot'): string {
  const base = flowBaseName();
  if (base === '签字') {
    return {
      confirm: '签字确认',
      automation: '自动化签字链接',
      status: '签字状态',
      shot: '签字图片'
    }[kind];
  }
  return {
    confirm: `${base}签字确认`,
    automation: `${base}自动化签字链接`,
    status: `${base}签字状态`,
    shot: `${base}签字图片`
  }[kind];
}

function cleanServerBase(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function storageKey(): string {
  return [
    STORAGE_KEY_PREFIX,
    state.serverBase,
    state.appToken,
    state.tableId
  ].join(':');
}

function setMessage(type: 'info' | 'success' | 'error', text: string) {
  state.message = { type, text };
  render();
}

function setBusy(busy: boolean) {
  state.busy = busy;
  render();
}

function captureRenderSnapshot(): RenderSnapshot {
  const fieldList = document.querySelector<HTMLElement>('.field-list');
  const activeElement = document.activeElement;
  const editableElement = activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement
    ? activeElement
    : null;

  return {
    windowScrollX: window.scrollX,
    windowScrollY: window.scrollY,
    fieldListScrollTop: fieldList?.scrollTop || 0,
    activeElementId: activeElement instanceof HTMLElement ? activeElement.id : '',
    selectionStart: editableElement?.selectionStart ?? null,
    selectionEnd: editableElement?.selectionEnd ?? null
  };
}

function restoreRenderSnapshot(snapshot: RenderSnapshot) {
  const fieldList = document.querySelector<HTMLElement>('.field-list');
  if (fieldList) fieldList.scrollTop = snapshot.fieldListScrollTop;

  if (snapshot.activeElementId) {
    const activeElement = document.getElementById(snapshot.activeElementId);
    if (activeElement instanceof HTMLElement) {
      activeElement.focus({ preventScroll: true });
      if (
        (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) &&
        snapshot.selectionStart !== null &&
        snapshot.selectionEnd !== null
      ) {
        activeElement.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
      }
    }
  }

  window.scrollTo(snapshot.windowScrollX, snapshot.windowScrollY);
}

async function callMaybe<T>(fn: () => Promise<T> | T): Promise<T | null> {
  try {
    const value = await fn();
    return value ?? null;
  } catch {
    return null;
  }
}

async function getSelection(): Promise<any> {
  const baseAny = bitable.base as any;
  return (
    await callMaybe(() => baseAny.getSelection?.()) ||
    await callMaybe(() => (bitable as any).getSelection?.()) ||
    {}
  );
}

async function getActiveTable(selection: any): Promise<any> {
  const baseAny = bitable.base as any;
  if (selection?.tableId && baseAny.getTableById) {
    const table = await callMaybe(() => baseAny.getTableById(selection.tableId));
    if (table) return table;
  }
  const table = await callMaybe(() => baseAny.getActiveTable?.());
  if (table) return table;
  throw new Error('没有读取到当前数据表，请在飞书多维表格中打开插件。');
}

async function getActiveView(table: any, selection: any): Promise<any> {
  if (selection?.viewId && table.getViewById) {
    const view = await callMaybe(() => table.getViewById(selection.viewId));
    if (view) return view;
  }
  return await callMaybe(() => table.getActiveView?.());
}

async function getAuthCode(): Promise<string> {
  const candidates = [
    () => (bitable as any).getPersonalBaseToken?.(),
    () => (bitable as any).base?.getPersonalBaseToken?.(),
    () => (bitable as any).bridge?.getPersonalBaseToken?.(),
    () => (bitable as any).base?.getUserId?.()
  ];

  for (const getter of candidates) {
    const value = await callMaybe(getter);
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object') {
      const token = value.personalBaseToken || value.token || value.user_access_token;
      if (typeof token === 'string' && token.trim()) return token.trim();
    }
  }

  return localStorage.getItem(`${STORAGE_KEY_PREFIX}:authCode`) || '';
}

function findFieldByNames(names: string[]): string {
  const normalized = names.map(name => name.trim());
  const found = state.fields.find(field => normalized.includes(fieldName(field).trim()));
  return found ? fieldId(found) : '';
}

function isSingleSelectField(field: FieldMeta | undefined): boolean {
  if (!field) return false;
  return field.type === FieldType.SingleSelect || String(field.ui_type || '').toLowerCase().includes('singleselect');
}

function isFormulaField(field: FieldMeta | undefined): boolean {
  if (!field) return false;
  return field.type === FieldType.Formula || String(field.ui_type || '').toLowerCase().includes('formula');
}

function isWritebackLikeField(field: FieldMeta): boolean {
  const name = fieldName(field).trim();
  if ([
    '签字状态',
    '签字状态_选择',
    '签名状态',
    '状态',
    '签字链接',
    '签名链接',
    '链接',
    '自动化签字链接',
    '自动化签字链接1',
    '自动化签字链接_可用',
    '签字确认',
    '签字确认1',
    '签字图片',
    '签名图片',
    '签名截图链接',
    '截图链接'
  ].includes(name)) return true;

  return (
    name.includes('签字确认') ||
    name.includes('自动化签字链接') ||
    name.includes('签字状态') ||
    name.includes('签名状态') ||
    name.includes('签字图片') ||
    name.includes('签名图片') ||
    name.includes('签字截图链接') ||
    name.includes('签名截图链接')
  );
}

const AUTOMATION_FORMULA_FIELD_NAMES = [
  '自动化签字链接',
  '自动化签字链接1',
  '自动化签字链接_可用',
  '签字确认',
  '签字确认1'
];

function statusOptionPayload() {
  return [
    { name: STATUS_PENDING, color: 2 },
    { name: STATUS_VIEWED, color: 1 },
    { name: STATUS_DONE, color: 3 }
  ];
}

async function refreshFields(table: any) {
  const rawFields = await callMaybe(() => table.getFieldMetaList?.());
  state.fields = Array.isArray(rawFields) ? rawFields : state.fields;
}

function findFieldByName(name: string): FieldMeta | undefined {
  return state.fields.find(field => fieldName(field).trim() === name);
}

async function addField(table: any, name: string, type: FieldType, property?: unknown, extraConfig?: Record<string, unknown>): Promise<string> {
  await table.addField({ name, type, ...(property ? { property } : {}), ...(extraConfig || {}) });
  await refreshFields(table);
  const created = findFieldByName(name);
  if (!created) throw new Error(`字段已创建但没有读取到：${name}`);
  return fieldId(created);
}

function buildAutomationFormula(): string {
  const base = cleanServerBase(state.serverBase || DEFAULT_SERVER);
  const keyPart = state.apiKey.trim() ? `&key=${encodeURIComponent(state.apiKey.trim())}` : '';
  return `"${base}/signature?configId=${state.configId}&recordId=" & RECORD_ID() & "${keyPart}"`;
}

function buildConfirmFormula(): string {
  return `HYPERLINK(${buildAutomationFormula()}, "在线签字确认")`;
}

function formulaProperty(formula: string): Record<string, unknown> {
  return {
    formula,
    formatter: 'text',
    formula_expression: formula,
    formulaString: formula
  };
}

function createConfigId(): string {
  const cryptoApi = window.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `cfg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function createFormulaField(table: any, name: string, formula: string, description: string): Promise<string> {
  await table.addField({
    name,
    type: FieldType.Formula,
    property: formulaProperty(formula),
    description: { content: description, disableSyncToFormDesc: false }
  });
  await refreshFields(table);
  const created = findFieldByName(name);
  if (!created) throw new Error(`字段已创建但没有读取到：${name}`);

  const id = fieldId(created);
  const formulaField = await callMaybe<any>(() => table.getFieldById?.(id));
  if (formulaField?.setFormula) {
    await formulaField.setFormula(formula);
  } else if (formulaField?.setProperty) {
    await formulaField.setProperty(formulaProperty(formula));
  } else {
    await table.setField?.(id, {
      name,
      type: FieldType.Formula,
      property: formulaProperty(formula),
      description: { content: description, disableSyncToFormDesc: false }
    });
  }

  await refreshFields(table);
  return id;
}

async function updateFormulaField(table: any, id: string, name: string, formula: string, description: string): Promise<void> {
  const formulaField = await callMaybe<any>(() => table.getFieldById?.(id));
  if (formulaField?.setFormula) {
    await formulaField.setFormula(formula);
  } else if (formulaField?.setProperty) {
    await formulaField.setProperty(formulaProperty(formula));
  } else {
    await table.setField?.(id, {
      name,
      type: FieldType.Formula,
      property: formulaProperty(formula),
      description: { content: description, disableSyncToFormDesc: false }
    });
  }
}

async function upsertFormulaField(table: any, name: string, formula: string, description: string): Promise<string> {
  const existing = findFieldByName(name);
  if (!existing) {
    return await createFormulaField(table, name, formula, description);
  }

  const id = fieldId(existing);
  await updateFormulaField(table, id, name, formula, description);
  await refreshFields(table);
  return id;
}

async function ensureWritebackFields(table: any) {
  await refreshFields(table);

  state.signLinkFieldId = '';
  state.automationLinkFieldId = await ensureAutomationLinkField(table);

  const shotName = flowFieldName('shot');
  const shotField = findFieldByName(shotName);
  state.shotLinkFieldId = shotField ? fieldId(shotField) : await addField(table, shotName, FieldType.Url);

  const statusName = flowFieldName('status');
  const exactStatusField = findFieldByName(statusName);
  if (isSingleSelectField(exactStatusField)) {
    state.statusFieldId = fieldId(exactStatusField);
  } else {
    const selectStatusField = state.fields.find(field => fieldName(field) === statusName && isSingleSelectField(field));
    if (selectStatusField) {
      state.statusFieldId = fieldId(selectStatusField);
    } else {
      state.statusFieldId = await addField(table, statusName, FieldType.SingleSelect, {
        options: statusOptionPayload(),
        optionsType: 0
      });
    }
  }
  await ensureStatusOptions(table);

  state.selectedFieldIds = new Set(
    Array.from(state.selectedFieldIds).filter(id => {
      const field = state.fields.find(item => fieldId(item) === id);
      return field && !isWritebackLikeField(field) && ![state.signLinkFieldId, state.automationConfirmFieldId, state.automationLinkFieldId, state.statusFieldId, state.shotLinkFieldId].includes(id);
    })
  );
  if (!state.selectedFieldIds.size) {
    state.selectedFieldIds = new Set(
      state.fields
        .map(fieldId)
        .filter(id => {
          const field = state.fields.find(item => fieldId(item) === id);
          return id && field && !isWritebackLikeField(field) && ![state.signLinkFieldId, state.automationConfirmFieldId, state.automationLinkFieldId, state.statusFieldId, state.shotLinkFieldId].includes(id);
        })
    );
  }
}

async function ensureAutomationLinkField(table: any): Promise<string> {
  const confirmName = flowFieldName('confirm');
  const automationName = flowFieldName('automation');
  const existing = findFieldByName(automationName);
  if (!state.configId) {
    state.automationConfirmFieldId = findFieldByNames([confirmName]);
    return existing ? fieldId(existing) : '';
  }

  state.automationConfirmFieldId = await upsertFormulaField(
    table,
    confirmName,
    buildConfirmFormula(),
    `${flowBaseName()}签字流程在飞书自动化消息中显示的签字入口文字。`
  );

  return await upsertFormulaField(
    table,
    automationName,
    buildAutomationFormula(),
    `${flowBaseName()}签字流程在飞书自动化消息中使用的签字链接，由公式实时拼接 recordId。`
  );
}

async function ensureStatusOptions(table: any) {
  if (!state.statusFieldId) return;
  const statusField = await callMaybe<any>(() => table.getFieldById?.(state.statusFieldId));
  if (!statusField) return;

  const options = await callMaybe<any[]>(() => statusField.getOptions?.());
  if (!Array.isArray(options)) return;
  const localStatusField = state.fields.find(field => fieldId(field) === state.statusFieldId) as any;
  if (localStatusField) {
    localStatusField.property = { ...(localStatusField.property || {}), options };
  }

  const names = new Set(options.map(option => String(option.name || option.text || '')));
  const missing = statusOptionPayload()
    .filter(option => !names.has(option.name))
    .map(option => ({ name: option.name, color: option.color }));

  if (missing.length) {
    await callMaybe(() => statusField.addOptions?.(missing));
    await refreshFields(table);
    const latestOptions = await callMaybe<any[]>(() => statusField.getOptions?.());
    const latestStatusField = state.fields.find(field => fieldId(field) === state.statusFieldId) as any;
    if (latestStatusField && Array.isArray(latestOptions)) {
      latestStatusField.property = { ...(latestStatusField.property || {}), options: latestOptions };
    }
  }
}

function loadSavedConfig() {
  const saved = localStorage.getItem(storageKey());
  if (!saved) {
    const flow = createFlow('门店');
    state.flows = [flow];
    state.activeFlowId = flow.id;
    applyFlowToState(flow);
    return;
  }

  try {
    const data = JSON.parse(saved);
    if (Array.isArray(data.flows) && data.flows.length) {
      state.flows = data.flows.map((flow: Partial<SignatureFlow>) => ({
        ...createFlow(flow.name || '门店'),
        ...flow,
        selectedFieldIds: Array.isArray(flow.selectedFieldIds) ? flow.selectedFieldIds : []
      }));
      state.activeFlowId = data.activeFlowId || state.flows[0].id;
    } else {
      state.flows = [{
        ...createFlow('签字'),
        configId: data.configId || '',
        apiKey: data.apiKey || '',
        signLinkFieldId: data.signLinkFieldId || '',
        automationConfirmFieldId: data.automationConfirmFieldId || '',
        automationLinkFieldId: data.automationLinkFieldId || '',
        statusFieldId: data.statusFieldId || '',
        shotLinkFieldId: data.shotLinkFieldId || '',
        selectedFieldIds: Array.isArray(data.selectedFieldIds) ? data.selectedFieldIds : [],
        autoSyncEnabled: typeof data.autoSyncEnabled === 'boolean' ? data.autoSyncEnabled : true
      }];
      state.activeFlowId = state.flows[0].id;
    }
    state.authCode = data.authCode || data.personalBaseToken || state.authCode;
    state.apiKey = data.apiKey || state.apiKey;
    state.serverBase = data.serverBase || state.serverBase;
    applyFlowToState(activeFlow());
  } catch {
    localStorage.removeItem(storageKey());
  }
}

function saveLocalConfig() {
  persistStateToActiveFlow();
  localStorage.setItem(storageKey(), JSON.stringify({
    flows: state.flows,
    activeFlowId: state.activeFlowId,
    authCode: state.authCode,
    apiKey: state.apiKey,
    serverBase: state.serverBase
  }));

  if (state.authCode) {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}:authCode`, state.authCode);
  }
}

async function initializeContext() {
  try {
    const selection = await getSelection();
    const table = await getActiveTable(selection);
    const view = await getActiveView(table, selection);

    state.appToken = String(selection?.baseId || selection?.appToken || selection?.app_token || '');
    state.tableId = String(selection?.tableId || table.id || table.tableId || '');
    state.viewId = String(selection?.viewId || view?.id || view?.viewId || '');
    state.tableName = String(await callMaybe(() => table.getName?.()) || '当前数据表');
    state.viewName = String(await callMaybe(() => view?.getName?.()) || '当前视图');
    state.authCode = await getAuthCode();

    const rawFields = await callMaybe(() => table.getFieldMetaList?.());
    state.fields = Array.isArray(rawFields) ? rawFields : [];

    state.signLinkFieldId = findFieldByNames(['签名链接', '签字链接', '链接']);
    state.automationConfirmFieldId = findFieldByNames(['签字确认', '签字确认1']);
    state.automationLinkFieldId = findFieldByNames(['自动化签字链接', '自动化签字链接1', '自动化签字链接_可用', '签字确认']);
    state.statusFieldId = findFieldByNames(['签字状态', '签字状态_选择', '签名状态', '状态']);
    state.shotLinkFieldId = findFieldByNames(['签名截图链接', '截图链接', '签名图片']);
    state.selectedFieldIds = new Set(
      state.fields
        .filter(field => !isWritebackLikeField(field))
        .map(fieldId)
        .filter(id => id && ![state.signLinkFieldId, state.automationConfirmFieldId, state.automationLinkFieldId, state.statusFieldId, state.shotLinkFieldId].includes(id))
    );

    loadSavedConfig();
    await ensureWritebackFields(table);

    if (!state.appToken || !state.tableId) {
      setMessage('error', '未读取到 appToken 或 tableId。请确认插件运行在飞书多维表格侧边栏中。');
      return;
    }

    saveLocalConfig();
    if (state.flows.some(flow => flow.configId && flow.autoSyncEnabled !== false)) {
      await startAutoSync();
    }
    setMessage('success', '已连接当前多维表格，写回字段已自动准备。');
  } catch (error) {
    setMessage('error', error instanceof Error ? error.message : String(error));
  }
}

async function requestJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${state.serverBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error || `请求失败：${response.status}`);
  }
  return data;
}

async function saveRemoteConfig() {
  state.serverBase = cleanServerBase(state.serverBase || DEFAULT_SERVER);
  const { table } = await getTableAndView();
  if (!state.configId) {
    state.configId = createConfigId();
  }
  await ensureWritebackFields(table);

  if (!state.authCode.trim()) {
    throw new Error('请填写多维表格授权码。后端需要它读取和写回飞书记录。');
  }
  if (!state.selectedFieldIds.size) {
    throw new Error('请至少选择一个展示字段。');
  }
  if (!state.automationLinkFieldId || !state.automationConfirmFieldId || !state.statusFieldId) {
    throw new Error('请先保存配置生成“签字确认”“自动化签字链接”和“签字状态”字段。');
  }

  const statusField = state.fields.find(field => fieldId(field) === state.statusFieldId);
  const statusOptions = (statusField as any)?.property?.options || [];
  const result = await requestJson<{ configId: string }>('/api/initConfig', {
    configId: state.configId,
    appToken: state.appToken,
    tableId: state.tableId,
    fieldIds: Array.from(state.selectedFieldIds),
    signFieldIds: {
      link: undefined,
      automationLink: state.automationLinkFieldId || undefined,
      status: state.statusFieldId,
      statusName: statusField ? fieldName(statusField) : '签字状态',
      shotLink: state.shotLinkFieldId || undefined,
      automationConfirm: state.automationConfirmFieldId || undefined,
      statusOptions: {
        pendingName: STATUS_PENDING,
        viewedName: STATUS_VIEWED,
        doneName: STATUS_DONE,
        options: statusOptions
      }
    },
    personalBaseToken: state.authCode.trim(),
    apiKey: state.apiKey.trim()
  });

  state.configId = result.configId;
  await ensureWritebackFields(table);
  persistStateToActiveFlow();
  saveLocalConfig();
  if (state.autoSyncEnabled) {
    await startAutoSync();
  } else {
    stopAutoSync();
  }
  setMessage('success', `配置已保存，configId：${state.configId}`);
}

function buildSignUrl(recordId: string): string {
  const url = new URL('/signature', state.serverBase);
  url.searchParams.set('configId', state.configId);
  url.searchParams.set('recordId', recordId);
  if (state.apiKey.trim()) url.searchParams.set('key', state.apiKey.trim());
  return url.toString();
}

async function registerTask(recordId: string): Promise<string> {
  await requestJson<{ signId: string; signUrl: string }>('/api/registerSignTask', {
    configId: state.configId,
    recordId,
    apiKey: state.apiKey.trim()
  });
  return buildSignUrl(recordId);
}

async function getTableAndView(): Promise<{ table: any; view: any; selection: any }> {
  const selection = await getSelection();
  const table = await getActiveTable(selection);
  const view = await getActiveView(table, selection);
  return { table, view, selection };
}

async function getTargetRecordIds(mode: 'current' | 'selected' | 'visible'): Promise<string[]> {
  const { table, view, selection } = await getTableAndView();

  if (mode === 'current') {
    const recordId = selection?.recordId || selection?.record_id;
    if (!recordId) throw new Error('没有读取到当前记录。请先在表格中选中一条记录。');
    return [String(recordId)];
  }

  if (mode === 'selected') {
    const uiAny = (bitable as any).ui;
    const selected = await callMaybe(() => uiAny?.selectRecordIdList?.(state.tableId, state.viewId));
    if (Array.isArray(selected) && selected.length) return selected.map(String);
    throw new Error('没有选择记录，或当前飞书环境不支持记录选择弹窗。');
  }

  const ids = await callMaybe(() => view?.getVisibleRecordIdList?.());
  if (Array.isArray(ids) && ids.length) return ids.map(String);

  const allIds = await callMaybe(() => table.getRecordIdList?.());
  if (Array.isArray(allIds) && allIds.length) return allIds.map(String);

  throw new Error('没有读取到记录列表。');
}

async function writeRecord(table: any, recordId: string, _signUrl: string) {
  await ensureStatusOptions(table);
  const statusValue = getStatusCellValue(STATUS_PENDING);
  await table.setRecord(recordId, {
    fields: {
      [state.statusFieldId]: statusValue
    }
  });
}

function getStatusCellValue(name: string): unknown {
  const statusField = state.fields.find(field => fieldId(field) === state.statusFieldId) as any;
  const options = statusField?.property?.options || [];
  const option = Array.isArray(options)
    ? options.find(item => String(item.name || item.text || '') === name)
    : null;

  if (option?.id) {
    return { id: String(option.id), text: name };
  }

  return name;
}

async function getRecordsByIds(table: any, recordIds: string[]): Promise<any[]> {
  const records = await callMaybe(() => table.getRecordsByIds?.(recordIds, true));
  if (Array.isArray(records)) return records;

  const result: any[] = [];
  for (const recordId of recordIds) {
    const record = await callMaybe(() => table.getRecordById?.(recordId, true));
    if (record) result.push({ recordId, ...record });
  }
  return result;
}

async function runWithFlow<T>(flow: SignatureFlow, fn: () => Promise<T>): Promise<T> {
  persistStateToActiveFlow();
  const previousFlowId = state.activeFlowId;
  applyFlowToState(flow);
  try {
    const result = await fn();
    persistStateToActiveFlow();
    return result;
  } finally {
    const previous = state.flows.find(item => item.id === previousFlowId);
    if (previous) applyFlowToState(previous);
  }
}

function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(cellText).join('');
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return String(obj.text || obj.name || obj.link || obj.url || obj.value || '');
  }
  return '';
}

function hasVisibleContent(record: any): boolean {
  const fields = record?.fields || {};
  return Array.from(state.selectedFieldIds).some(id => cellText(fields[id]).trim());
}

function needsSignTask(record: any): boolean {
  const fields = record?.fields || {};
  const statusValue = cellText(fields[state.statusFieldId]).trim();
  if (!hasVisibleContent(record)) return false;
  if (statusValue === STATUS_DONE) return false;
  return !statusValue;
}

async function syncRecord(recordId: string, table?: any): Promise<boolean> {
  const activeTable = table || (await getTableAndView()).table;
  const record = await callMaybe(() => activeTable.getRecordById?.(recordId, true));
  if (!record || !needsSignTask(record)) return false;

  const signUrl = await registerTask(recordId);
  await writeRecord(activeTable, recordId, signUrl);
  return true;
}

async function syncAllRecords(): Promise<number> {
  if (!state.configId || state.syncInProgress) return 0;
  state.syncInProgress = true;
  try {
    const { table, view } = await getTableAndView();
    const visibleIds = await callMaybe(() => view?.getVisibleRecordIdList?.());
    const ids = (Array.isArray(visibleIds) && visibleIds.length ? visibleIds : await callMaybe(() => table.getRecordIdList?.()) || [])
      .map(String)
      .filter(Boolean);

    const records = await getRecordsByIds(table, ids);
    let changed = 0;
    for (const record of records) {
      const recordId = String(record.recordId || record.id || '');
      if (!recordId) continue;
      try {
        if (needsSignTask(record)) {
          const signUrl = await registerTask(recordId);
          await writeRecord(table, recordId, signUrl);
          changed += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        state.lastResult = `${recordId} -> 失败：${message}`;
        console.warn('[signature-sync] 同步记录失败', recordId, error);
      }
    }

    state.syncCount += changed;
    if (changed) {
      state.lastResult = `本次自动补齐 ${changed} 条签字状态，累计 ${state.syncCount} 条。`;
      setMessage('success', `已自动补齐 ${changed} 条签字状态。`);
    }
    return changed;
  } finally {
    state.syncInProgress = false;
  }
}

async function syncAllFlows(): Promise<number> {
  const flows = [...state.flows].filter(flow => flow.autoSyncEnabled !== false && flow.configId);
  let totalChanged = 0;
  for (const flow of flows) {
    totalChanged += await runWithFlow(flow, syncAllRecords);
  }
  return totalChanged;
}

function scheduleRecordSync(recordId: string) {
  if (!recordId) return;
  const oldTimer = pendingRecordTimers.get(recordId);
  if (oldTimer) window.clearTimeout(oldTimer);
  const timer = window.setTimeout(async () => {
    pendingRecordTimers.delete(recordId);
    try {
      let changed = 0;
      for (const flow of state.flows.filter(item => item.autoSyncEnabled !== false && item.configId)) {
        const didSync = await runWithFlow(flow, () => syncRecord(recordId));
        if (didSync) {
          flow.syncCount += 1;
          changed += 1;
        }
      }
      if (changed) {
        state.lastResult = `已为记录 ${recordId} 准备 ${changed} 个签字流程。`;
        setMessage('success', `已准备 ${changed} 个签字流程，签字入口由公式字段生成。`);
      }
    } catch (error) {
      setMessage('error', error instanceof Error ? error.message : String(error));
    }
  }, 700);
  pendingRecordTimers.set(recordId, timer);
}

async function startAutoSync() {
  if (state.syncActive) return;
  const { table } = await getTableAndView();
  state.syncActive = true;

  unsubscribeRecordAdd = table.onRecordAdd?.((event: any) => {
    const recordId = Array.isArray(event?.data) ? event.data[0] : event?.data;
    scheduleRecordSync(String(recordId || ''));
  }) || null;

  unsubscribeRecordModify = table.onRecordModify?.((event: any) => {
    const recordId = event?.data?.recordId;
    const changedFields = event?.data?.fieldIds || [];
    if ([state.signLinkFieldId, state.statusFieldId, state.shotLinkFieldId].some(id => changedFields.includes(id))) return;
    scheduleRecordSync(String(recordId || ''));
  }) || null;

  syncTimer = window.setInterval(() => {
    syncAllFlows().catch(error => console.warn('[signature-sync] 自动检查失败', error));
  }, AUTO_SYNC_INTERVAL);

  await syncAllFlows();
  render();
}

function stopAutoSync() {
  if (syncTimer) window.clearInterval(syncTimer);
  syncTimer = null;
  unsubscribeRecordAdd?.();
  unsubscribeRecordModify?.();
  unsubscribeRecordAdd = null;
  unsubscribeRecordModify = null;
  state.syncActive = false;
}

async function generateLinks(mode: 'current' | 'selected' | 'visible') {
  if (!state.configId) {
    await saveRemoteConfig();
  }

  const { table } = await getTableAndView();
  const recordIds = await getTargetRecordIds(mode);
  const results: string[] = [];
  let success = 0;

  for (const recordId of recordIds) {
    try {
      const signUrl = await registerTask(recordId);
      await writeRecord(table, recordId, signUrl);
      results.push(`${recordId} -> ${signUrl}`);
      success += 1;
    } catch (error) {
      results.push(`${recordId} -> 失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  state.lastResult = results.join('\n');
  saveLocalConfig();
  setMessage('success', `已处理 ${recordIds.length} 条记录，成功 ${success} 条。`);
}

function optionList() {
  return state.fields.map(field => {
    const id = fieldId(field);
    const name = fieldName(field);
    return `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`;
  }).join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function render() {
  const snapshot = captureRenderSnapshot();
  const message = state.message
    ? `<div class="message ${state.message.type}">${escapeHtml(state.message.text)}</div>`
    : '';

  app.innerHTML = `
    <main class="app">
      <header class="topbar">
        <div class="title-group">
          <span class="eyebrow">Signature Workflow</span>
          <h1 class="title">签名确认</h1>
          <p class="subtitle">${escapeHtml(state.tableName || '飞书多维表格')} · ${escapeHtml(state.viewName || '当前视图')}</p>
        </div>
        <span class="status-pill ${state.configId ? 'is-ready' : ''}">
          <span class="status-dot"></span>
          ${state.configId ? (state.syncActive ? '自动同步中' : '已配置') : '未配置'}
        </span>
      </header>

      ${message}

      <section class="panel">
        <div class="panel-title">
          <span>签字流程</span>
          <button class="mini-btn" id="addFlow" ${state.busy ? 'disabled' : ''}>新增</button>
        </div>
        <div class="grid">
          <div class="field">
            <label for="activeFlowId">当前流程</label>
            <select class="select" id="activeFlowId">
              ${state.flows.map(flow => `
                <option value="${escapeHtml(flow.id)}" ${flow.id === state.activeFlowId ? 'selected' : ''}>
                  ${escapeHtml(flow.name || '未命名流程')}${flow.configId ? ' · 已保存' : ' · 未保存'}
                </option>
              `).join('')}
            </select>
          </div>
          <div class="field">
            <label for="flowName">流程名称</label>
            <input class="input" id="flowName" value="${escapeHtml(flowBaseName())}" placeholder="例如：门店、司机、仓库" />
            <span class="muted">字段会按流程名生成，例如“门店签字状态”“司机签字图片”。</span>
          </div>
          <button class="btn danger" id="deleteFlow" ${state.busy || state.flows.length <= 1 ? 'disabled' : ''}>删除当前流程</button>
        </div>
      </section>

      <section class="panel">
        <div class="panel-title">服务器</div>
        <div class="grid">
          <div class="field">
            <label for="serverBase">后端域名</label>
            <input class="input" id="serverBase" value="${escapeHtml(state.serverBase)}" />
          </div>
          <div class="field">
            <label for="apiKey">API key 设置</label>
            <input class="input" id="apiKey" type="password" value="${escapeHtml(state.apiKey)}" placeholder="请输入管理员提供的 API key" />
            <span class="muted">Key 会写入签字链接。次数型 Key 会在签字成功提交时扣 1 次。</span>
          </div>
          <div class="field">
            <label for="authCode">多维表格授权码</label>
            <textarea class="textarea" id="authCode" placeholder="请粘贴从自定义插件中获取的授权码">${escapeHtml(state.authCode)}</textarea>
            <span class="muted">只有多维表格管理员/所有者有权限获取授权码，请勿公开传播。</span>
          </div>
          <div class="summary compact">
            <span><b>appToken</b>${escapeHtml(state.appToken || '未读取')}</span>
            <span><b>tableId</b>${escapeHtml(state.tableId || '未读取')}</span>
            <span><b>当前configId</b>${escapeHtml(state.configId || '保存当前流程后生成')}</span>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-title">自动生成</div>
        <div class="grid">
          <label class="switch-row">
            <input type="checkbox" id="autoSyncEnabled" ${state.autoSyncEnabled ? 'checked' : ''} />
            <span>
              <span class="switch-title">新增/填写记录后自动准备签字状态</span>
              <span class="muted">插件会自动准备“签字确认”“自动化签字链接”“签字状态”“签字图片”。</span>
            </span>
          </label>
          <div class="summary field-summary">
            <span><b>状态</b>${escapeHtml(fieldName(state.fields.find(field => fieldId(field) === state.statusFieldId) || {}) || '未准备')}</span>
            <span><b>入口</b>${escapeHtml(fieldName(state.fields.find(field => fieldId(field) === state.automationConfirmFieldId) || {}) || '未准备')}</span>
            <span><b>自动化</b>${escapeHtml(fieldName(state.fields.find(field => fieldId(field) === state.automationLinkFieldId) || {}) || '未准备')}</span>
            <span><b>图片</b>${escapeHtml(fieldName(state.fields.find(field => fieldId(field) === state.shotLinkFieldId) || {}) || '未准备')}</span>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-title">
          <span>签字人可见字段</span>
          <span class="muted">${state.selectedFieldIds.size}/${state.fields.length}</span>
        </div>
        <div class="field-list">
          ${state.fields.map(field => {
            const id = fieldId(field);
            return `
              <label class="check-row">
                <input type="checkbox" class="display-field" value="${escapeHtml(id)}" ${state.selectedFieldIds.has(id) ? 'checked' : ''} />
                <span class="check-text">
                  <span class="check-name">${escapeHtml(fieldName(field))}</span>
                  <span class="check-meta">${escapeHtml(id)}</span>
                </span>
              </label>
            `;
          }).join('') || '<div class="muted">未读取到字段。</div>'}
        </div>
      </section>

      <section class="panel">
        <div class="panel-title">签字任务</div>
        <div class="actions">
          <button class="btn btn-primary" id="saveConfig" ${state.busy ? 'disabled' : ''}>保存配置并开始</button>
          <button class="btn" id="syncNow" ${state.busy || !state.configId ? 'disabled' : ''}>立即同步</button>
          <button class="btn" id="generateCurrent" ${state.busy ? 'disabled' : ''}>当前记录</button>
          <button class="btn" id="generateVisible" ${state.busy ? 'disabled' : ''}>当前视图</button>
        </div>
      </section>

      ${state.lastResult ? `
        <section class="panel">
          <div class="panel-title">最近结果</div>
          <textarea class="textarea" readonly>${escapeHtml(state.lastResult)}</textarea>
        </section>
      ` : ''}
    </main>
  `;

  bindForm();
  restoreRenderSnapshot(snapshot);
}

function syncFormValues() {
  const active = activeFlow();
  active.name = document.querySelector<HTMLInputElement>('#flowName')?.value.trim() || active.name || '门店';
  state.serverBase = cleanServerBase((document.querySelector<HTMLInputElement>('#serverBase')?.value || DEFAULT_SERVER));
  state.apiKey = document.querySelector<HTMLInputElement>('#apiKey')?.value.trim() || '';
  state.authCode = document.querySelector<HTMLTextAreaElement>('#authCode')?.value.trim() || '';
  state.autoSyncEnabled = document.querySelector<HTMLInputElement>('#autoSyncEnabled')?.checked ?? state.autoSyncEnabled;
  state.selectedFieldIds = new Set(
    Array.from(document.querySelectorAll<HTMLInputElement>('.display-field:checked')).map(input => input.value)
  );
  persistStateToActiveFlow();
}

function bindForm() {
  document.querySelector('#addFlow')?.addEventListener('click', async () => {
    syncFormValues();
    stopAutoSync();
    const nextIndex = state.flows.length + 1;
    const flow = createFlow(nextIndex === 2 ? '司机' : `流程${nextIndex}`);
    state.flows.push(flow);
    applyFlowToState(flow);
    const { table } = await getTableAndView();
    await ensureWritebackFields(table);
    saveLocalConfig();
    setMessage('success', `已新增流程：${flow.name}`);
    render();
  });

  document.querySelector('#deleteFlow')?.addEventListener('click', async () => {
    if (state.flows.length <= 1) return;
    stopAutoSync();
    state.flows = state.flows.filter(flow => flow.id !== state.activeFlowId);
    applyFlowToState(state.flows[0]);
    saveLocalConfig();
    setMessage('success', '已删除当前流程。本操作不会删除飞书表格中的字段。');
    render();
  });

  document.querySelector<HTMLSelectElement>('#activeFlowId')?.addEventListener('change', async event => {
    syncFormValues();
    stopAutoSync();
    const flowId = (event.target as HTMLSelectElement).value;
    const flow = state.flows.find(item => item.id === flowId);
    if (flow) {
      applyFlowToState(flow);
      const { table } = await getTableAndView();
      await ensureWritebackFields(table);
      saveLocalConfig();
      setMessage('success', `已切换到流程：${flow.name}`);
      if (state.flows.some(item => item.configId && item.autoSyncEnabled !== false)) {
        await startAutoSync();
      } else {
        render();
      }
    }
  });

  document.querySelector<HTMLInputElement>('#flowName')?.addEventListener('change', async () => {
    syncFormValues();
    state.configId = '';
    state.automationConfirmFieldId = '';
    state.automationLinkFieldId = '';
    state.statusFieldId = '';
    state.shotLinkFieldId = '';
    persistStateToActiveFlow();
    const { table } = await getTableAndView();
    await ensureWritebackFields(table);
    saveLocalConfig();
    render();
  });

  document.querySelector('#saveConfig')?.addEventListener('click', async () => {
    syncFormValues();
    setBusy(true);
    try {
      await saveRemoteConfig();
    } catch (error) {
      setMessage('error', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  });

  const run = (mode: 'current' | 'selected' | 'visible') => async () => {
    syncFormValues();
    setBusy(true);
    setMessage('info', '正在准备签字任务...');
    try {
      await generateLinks(mode);
    } catch (error) {
      setMessage('error', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  document.querySelector('#generateCurrent')?.addEventListener('click', run('current'));
  document.querySelector('#generateVisible')?.addEventListener('click', run('visible'));

  document.querySelector('#syncNow')?.addEventListener('click', async () => {
    syncFormValues();
    setBusy(true);
    setMessage('info', '正在同步已有记录...');
    try {
      await syncAllFlows();
      setMessage('success', '同步检查完成。');
    } catch (error) {
      setMessage('error', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  });

  document.querySelectorAll<HTMLInputElement>('.display-field').forEach(input => {
    input.addEventListener('change', () => {
      syncFormValues();
      saveLocalConfig();
      render();
    });
  });

  document.querySelector<HTMLInputElement>('#autoSyncEnabled')?.addEventListener('change', async () => {
    syncFormValues();
    saveLocalConfig();
    if (state.flows.some(flow => flow.configId && flow.autoSyncEnabled !== false)) {
      await startAutoSync();
    } else {
      stopAutoSync();
      render();
    }
  });
}

render();
initializeContext();
