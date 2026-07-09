import { bitable, FieldType } from '@lark-base-open/js-sdk';
import './styles.css';

const DEFAULT_SERVER = 'https://liupanqing.asia';
const STORAGE_KEY_PREFIX = 'fs-sidebar-signature';
const STATUS_PENDING = '待签字';
const STATUS_VIEWED = '已查看未签字';
const STATUS_DONE = '已签字';
const AUTO_SYNC_INTERVAL = 1000;
const LICENSE_REFRESH_INTERVAL = 15000;
const PLUGIN_SETTINGS_REFRESH_INTERVAL = 15000;
const PLUGIN_OFFICIAL_URL = 'https://liupanqing.asia';
const LAST_CONFIG_STORAGE_KEY = `${STORAGE_KEY_PREFIX}:last-config`;

type FieldMeta = {
  id?: string;
  field_id?: string;
  name?: string;
  field_name?: string;
  type?: unknown;
  ui_type?: string;
  property?: Record<string, unknown>;
  description?: unknown;
};

type SignatureFlow = {
  id: string;
  name: string;
  roleName?: string;
  savedName?: string;
  configId: string;
  apiKey: string;
  selectedFieldIds: string[];
  signLinkFieldId: string;
  automationConfirmFieldId: string;
  automationLinkFieldId: string;
  statusFieldId: string;
  shotLinkFieldId: string;
  imageAttachmentFieldId: string;
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
  imageAttachmentFieldId: string;
  configId: string;
  apiKey: string;
  autoSyncEnabled: boolean;
  syncActive: boolean;
  syncInProgress: boolean;
  syncCount: number;
  busy: boolean;
  orderPreviewOpen: boolean;
  orderPreviewSaving: boolean;
  orderPreviewSaved: boolean;
  dragFieldId: string;
  message: { type: 'info' | 'success' | 'error'; text: string } | null;
  lastResult: string;
  guestAuthorizationDetailVisible: boolean;
  license: {
    type: 'unknown' | 'trial' | 'count' | 'duration' | 'permanent';
    title: string;
    detail: string;
    officialUrl: string;
    imagePreviewEnabled: boolean;
    authorizationDetailVisible: boolean;
    updatedAt: string;
  } | null;
};

type RenderSnapshot = {
  windowScrollX: number;
  windowScrollY: number;
  fieldListScrollTop: number;
  activeElementId: string;
  selectionStart: number | null;
  selectionEnd: number | null;
};

type SavedConfigCandidate = {
  source: 'remote' | 'local';
  label: string;
  storageKey?: string;
  data: any;
  updatedAt?: string;
  priority: number;
};

type KeyValidationResult = {
  ok: boolean;
  error?: string;
  data?: any;
};

type RestoreConfigResult = {
  restored: boolean;
  warning: string;
  selectedSource: string;
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
  imageAttachmentFieldId: '',
  configId: '',
  apiKey: '',
  autoSyncEnabled: true,
  syncActive: false,
  syncInProgress: false,
  syncCount: 0,
  busy: false,
  orderPreviewOpen: false,
  orderPreviewSaving: false,
  orderPreviewSaved: false,
  dragFieldId: '',
  message: { type: 'info', text: '正在读取飞书多维表格信息...' },
  lastResult: '',
  guestAuthorizationDetailVisible: true,
  license: null
};

const app = document.querySelector<HTMLDivElement>('#app')!;
let syncTimer: number | null = null;
let licenseTimer: number | null = null;
let pluginSettingsTimer: number | null = null;
let licenseRequestSeq = 0;
let unsubscribeRecordAdd: (() => void) | null = null;
let unsubscribeRecordModify: (() => void) | null = null;
let unsubscribeFieldAdd: (() => void) | null = null;
const pendingRecordTimers = new Map<string, number>();
let remoteConfigSaveTimer: number | null = null;
let restoredConfigWarning = '';
let backgroundFlowRunDepth = 0;
let renderRequestedDuringBackgroundFlow = false;
let pendingConfigSaveAfterBackground = false;
let pendingConfigSaveNeedsRemote = false;
let orderPreviewCloseTimer: number | null = null;
const imagePreviewFeatureCache = new Map<string, { enabled: boolean; checkedAt: number }>();
const imagePreviewRetryAfter = new Map<string, number>();

function fieldId(field: FieldMeta): string {
  return String(field.id || field.field_id || '');
}

function fieldName(field: FieldMeta): string {
  return String(field.name || field.field_name || fieldId(field));
}

function createFlow(name = '未命名流程'): SignatureFlow {
  return {
    id: createConfigId(),
    name: normalizeFlowRoleName(name) || name.trim() || '未命名流程',
    roleName: normalizeFlowRoleName(name) || name.trim() || '未命名流程',
    savedName: '',
    configId: '',
    apiKey: '',
    selectedFieldIds: [],
    signLinkFieldId: '',
    automationConfirmFieldId: '',
    automationLinkFieldId: '',
    statusFieldId: '',
    shotLinkFieldId: '',
    imageAttachmentFieldId: '',
    autoSyncEnabled: true,
    syncCount: 0
  };
}

function ensureUniqueFlowIds(flows: Partial<SignatureFlow>[]): boolean {
  const seen = new Set<string>();
  let changed = false;
  for (const flow of flows) {
    let id = String(flow.id || '').trim();
    if (!id || seen.has(id)) {
      do {
        id = createConfigId();
      } while (seen.has(id));
      flow.id = id;
      changed = true;
    } else if (flow.id !== id) {
      flow.id = id;
      changed = true;
    }
    seen.add(id);
  }
  return changed;
}

function activeFlow(): SignatureFlow {
  if (!state.flows.length) {
    const flow = createFlow();
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
  state.imageAttachmentFieldId = flow.imageAttachmentFieldId || '';
  state.selectedFieldIds = new Set(flow.selectedFieldIds || []);
  state.autoSyncEnabled = flow.autoSyncEnabled !== false;
  state.syncCount = flow.syncCount || 0;
}

function persistStateToActiveFlow() {
  const flow = activeFlow();
  flow.name = normalizeFlowRoleName(flow.name) || flow.name.trim() || '未命名流程';
  flow.roleName = normalizeFlowRoleName(flow.name);
  flow.configId = state.configId;
  flow.apiKey = state.apiKey;
  flow.signLinkFieldId = state.signLinkFieldId;
  flow.automationConfirmFieldId = state.automationConfirmFieldId;
  flow.automationLinkFieldId = state.automationLinkFieldId;
  flow.statusFieldId = state.statusFieldId;
  flow.shotLinkFieldId = state.shotLinkFieldId;
  flow.imageAttachmentFieldId = state.imageAttachmentFieldId;
  flow.selectedFieldIds = Array.from(state.selectedFieldIds);
  flow.autoSyncEnabled = state.autoSyncEnabled;
  flow.syncCount = state.syncCount;
}

function flowBaseName(): string {
  return activeFlow().name.trim() || '签字';
}

type FlowFieldKind = 'confirm' | 'automation' | 'status' | 'shot' | 'imageAttachment';

function fieldNameForFlowBase(base: string, kind: FlowFieldKind): string {
  const cleanBase = base.trim() || '签字';
  if (cleanBase === '签字') {
    return {
      confirm: '签字确认',
      automation: '自动化签字链接',
      status: '签字状态',
      shot: '签字结果链接',
      imageAttachment: '签字图片预览'
    }[kind];
  }
  return {
    confirm: `${cleanBase}签字确认`,
    automation: `${cleanBase}自动化签字链接`,
    status: `${cleanBase}签字状态`,
    shot: `${cleanBase}签字结果链接`,
    imageAttachment: `${cleanBase}签字图片预览`
  }[kind];
}

function normalizeFlowRoleName(value: string): string {
  let role = String(value || '').trim().replace(/\s+/g, '');
  if (!role) return '';
  const suffixes = [
    '自动化签字链接',
    '自动化签名链接',
    '签字结果链接',
    '签名结果链接',
    '签字图片预览',
    '签名图片预览',
    '签字状态',
    '签名状态',
    '签字确认',
    '签名确认',
    '签字图片',
    '签名图片',
    '签字链接',
    '签名链接',
    '自动化链接',
    '结果链接',
    '状态',
    '链接',
    '图片预览',
    '图片'
  ].sort((a, b) => b.length - a.length);

  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of suffixes) {
      if (role.endsWith(suffix)) {
        role = role.slice(0, -suffix.length).trim();
        changed = true;
      }
    }
  }

  while (role.endsWith('签字') || role.endsWith('签名')) {
    role = role.slice(0, -2).trim();
  }
  return role;
}

function inferFlowRoleFromFieldNames(names: string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) {
    const role = normalizeFlowRoleName(name);
    if (!role || ['签字', '签名', '状态', '链接', '图片', '自动化'].includes(role)) continue;
    counts.set(role, (counts.get(role) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0], 'zh-Hans-CN'))[0]?.[0] || '';
}

function inferFlowRoleFromBindings(flow: Partial<SignatureFlow>): string {
  const ids = [
    flow.statusFieldId,
    flow.automationLinkFieldId,
    flow.signLinkFieldId,
    flow.shotLinkFieldId,
    flow.imageAttachmentFieldId,
    flow.automationConfirmFieldId
  ].map(item => String(item || '').trim()).filter(Boolean);
  const names = ids
    .map(id => state.fields.find(field => fieldId(field) === id))
    .filter(Boolean)
    .map(field => fieldName(field as FieldMeta));
  return inferFlowRoleFromFieldNames(names);
}

function findDuplicateFlowName(flows: Partial<SignatureFlow>[], currentFlowId = ''): string {
  const seen = new Set<string>();
  for (const flow of flows) {
    if (currentFlowId && flow.id === currentFlowId) continue;
    const role = normalizeFlowRoleName(flow.name || flow.savedName || '');
    if (!role) continue;
    if (seen.has(role)) return role;
    seen.add(role);
  }
  return '';
}

function repairDuplicateFlowNamesFromBindings(flows: Partial<SignatureFlow>[]): boolean {
  return false;
}

function normalizeFlowList(): boolean {
  const idChanged = ensureUniqueFlowIds(state.flows);
  const nameChanged = repairDuplicateFlowNamesFromBindings(state.flows);
  let activeChanged = false;
  if (!state.flows.some(flow => flow.id === state.activeFlowId) && state.flows[0]) {
    state.activeFlowId = state.flows[0].id;
    activeChanged = true;
  }
  return idChanged || nameChanged || activeChanged;
}

function ensureActiveFlowNameIsUnique() {
  ensureUniqueFlowIds(state.flows);
  repairDuplicateFlowNamesFromBindings(state.flows);
  const flow = activeFlow();
  const role = normalizeFlowRoleName(flow.name);
  if (!role || role === '未命名流程') {
    throw new Error('请先填写流程名称，例如：门店、司机、财务、特殊情况。');
  }
  const duplicated = state.flows.some(item => item.id !== flow.id && normalizeFlowRoleName(item.name || item.savedName || '') === role);
  if (duplicated) {
    throw new Error(`已存在“${role}”签字流程，请不要重复创建或改成同名。请选择已有流程修改，或换一个不同名称。`);
  }
  flow.name = role;
  flow.roleName = role;
}

function syncFlowNameFromInput(): boolean {
  const input = document.querySelector<HTMLInputElement>('#flowName');
  if (!input) return false;
  const flow = activeFlow();
  const rawName = input.value.trim();
  const role = normalizeFlowRoleName(rawName);
  const currentRole = normalizeFlowRoleName(flow.name || flow.savedName || '');

  if (!role || role === '未命名流程') {
    throw new Error('请先填写流程名称，例如：门店、司机、财务、特殊情况。');
  }
  if (role === currentRole) {
    input.value = flow.name || role;
    return false;
  }

  const duplicated = state.flows.some(item => item.id !== flow.id && normalizeFlowRoleName(item.name || item.savedName || '') === role);
  if (duplicated) {
    throw new Error(`已存在“${role}”签字流程，请不要改成同名。请切换到已有流程修改，或换一个不同名称。`);
  }

  flow.name = role;
  flow.roleName = role;
  input.value = role;
  return true;
}

function sanitizeSavedFlowsForRestore(data: any): any {
  const next = cloneConfigData(data);
  if (!Array.isArray(next?.flows) || !next.flows.length) return next;

  ensureUniqueFlowIds(next.flows);
  repairDuplicateFlowNamesFromBindings(next.flows);
  return next;
}

function flowFieldName(kind: FlowFieldKind): string {
  return fieldNameForFlowBase(flowBaseName(), kind);
}

function previousFlowFieldName(kind: FlowFieldKind): string {
  const flow = activeFlow();
  return fieldNameForFlowBase(flow.savedName || flow.name || '签字', kind);
}

function cleanServerBase(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function isValidServerBase(value: string): boolean {
  try {
    const url = new URL(cleanServerBase(value));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`无法连接签字后端，请确认服务器正常后重试（${message}）。`);
  }
  const text = await response.text();
  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (response.status === 404) {
        throw new Error('后端功能正在更新，请等待服务器重启完成后再重试。');
      }
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        throw new Error('后端服务正在重启，请稍后重试。');
      }
      throw new Error(`后端返回了异常内容（HTTP ${response.status}），请稍后重试。`);
    }
  }
  if (!response.ok) {
    const error = new Error(data.error || `请求失败：${response.status}`);
    (error as any).code = data.code || '';
    (error as any).status = response.status;
    (error as any).payload = data;
    throw error;
  }
  return data;
}

async function loadPluginSettings(options: { rerenderOnChange?: boolean } = {}) {
  const previousGuestAuthorizationDetailVisible = state.guestAuthorizationDetailVisible;
  const candidates = Array.from(new Set([
    cleanServerBase(state.serverBase || ''),
    DEFAULT_SERVER
  ].filter(Boolean)));

  for (const base of candidates) {
    try {
      const data = await fetchJson<{
        backendBaseUrl?: string;
        officialUrl?: string;
        guestAuthorizationDetailVisible?: boolean;
      }>(`${base}/api/plugin/settings`, { cache: 'no-store' });
      const backendBaseUrl = cleanServerBase(data.backendBaseUrl || base);
      if (isValidServerBase(backendBaseUrl)) {
        state.serverBase = backendBaseUrl;
      }
      state.guestAuthorizationDetailVisible = data.guestAuthorizationDetailVisible !== false;
      if (
        options.rerenderOnChange
        && previousGuestAuthorizationDetailVisible !== state.guestAuthorizationDetailVisible
      ) {
        render();
      }
      return;
    } catch (error) {
      console.warn('[signature-settings] 读取全局后端域名失败', base, error);
    }
  }

  state.serverBase = cleanServerBase(DEFAULT_SERVER);
}

function refreshPluginSettingsInBackground() {
  loadPluginSettings({ rerenderOnChange: true })
    .catch(error => console.warn('[signature-settings] 刷新展示设置失败', error));
}

function startPluginSettingsRefreshTimer() {
  if (pluginSettingsTimer) window.clearInterval(pluginSettingsTimer);
  pluginSettingsTimer = window.setInterval(
    refreshPluginSettingsInBackground,
    PLUGIN_SETTINGS_REFRESH_INTERVAL
  );
}

function storageKey(): string {
  return [
    STORAGE_KEY_PREFIX,
    state.serverBase,
    state.appToken,
    state.tableId
  ].join(':');
}

function storageFallbackKeys(): string[] {
  return [
    storageKey(),
    state.appToken && state.tableId ? `${STORAGE_KEY_PREFIX}:${state.appToken}:${state.tableId}` : '',
    state.tableId ? `${STORAGE_KEY_PREFIX}:table:${state.tableId}` : '',
    LAST_CONFIG_STORAGE_KEY
  ].filter(Boolean);
}

function parseSavedConfig(value: string): any | null {
  try {
    const data = JSON.parse(value);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function configMatchesCurrentTable(key: string, data: any): boolean {
  if (!state.tableId) return false;
  if (data?.tableId && String(data.tableId) === state.tableId) return true;
  if (state.appToken && key.endsWith(`:${state.appToken}:${state.tableId}`)) return true;
  return key.endsWith(`:${state.tableId}`) || key.includes(state.tableId);
}

function readSavedConfigText(): { key: string; value: string } | null {
  const exactKeys = storageFallbackKeys().filter(key => key !== LAST_CONFIG_STORAGE_KEY);
  for (const key of exactKeys) {
    const value = localStorage.getItem(key);
    if (value) return { key, value };
  }

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index) || '';
    if (!key.startsWith(`${STORAGE_KEY_PREFIX}:`) || key === LAST_CONFIG_STORAGE_KEY) continue;
    const value = localStorage.getItem(key);
    if (!value) continue;
    const data = parseSavedConfig(value);
    if (data && Array.isArray(data.flows) && configMatchesCurrentTable(key, data)) {
      return { key, value };
    }
  }

  const lastValue = localStorage.getItem(LAST_CONFIG_STORAGE_KEY);
  if (lastValue) {
    const data = parseSavedConfig(lastValue);
    if (data && Array.isArray(data.flows) && (!data.tableId || String(data.tableId) === state.tableId)) {
      return { key: LAST_CONFIG_STORAGE_KEY, value: lastValue };
    }
  }

  return null;
}

function hasConfigShape(data: any): boolean {
  return Boolean(data && typeof data === 'object' && (
    (Array.isArray(data.flows) && data.flows.length) ||
    data.configId ||
    data.apiKey ||
    Array.isArray(data.selectedFieldIds)
  ));
}

function configSavedTime(candidate: SavedConfigCandidate): number {
  const value = candidate.data?.savedAt || candidate.updatedAt || '';
  const time = value ? new Date(String(value)).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function cloneConfigData(data: any): any {
  return JSON.parse(JSON.stringify(data || {}));
}

function collectConfigApiKeys(data: any): string[] {
  const keys = new Set<string>();
  const topLevelKey = String(data?.apiKey || '').trim();
  if (topLevelKey) keys.add(topLevelKey);
  if (Array.isArray(data?.flows)) {
    for (const flow of data.flows) {
      const key = String(flow?.apiKey || '').trim();
      if (key) keys.add(key);
    }
  }
  return Array.from(keys);
}

function clearInvalidApiKeysFromConfig(data: any, invalidKeys: Set<string>) {
  if (!invalidKeys.size) return;
  if (invalidKeys.has(String(data?.apiKey || '').trim())) {
    data.apiKey = '';
  }
  if (Array.isArray(data?.flows)) {
    data.flows = data.flows.map((flow: any) => {
      if (invalidKeys.has(String(flow?.apiKey || '').trim())) {
        return { ...flow, apiKey: '' };
      }
      return flow;
    });
  }
}

function collectLocalSavedConfigCandidates(): SavedConfigCandidate[] {
  const candidates: SavedConfigCandidate[] = [];
  const seen = new Set<string>();
  const exactKeys = storageFallbackKeys().filter(key => key !== LAST_CONFIG_STORAGE_KEY);

  function addCandidate(key: string, value: string, priority: number, label: string) {
    const data = parseSavedConfig(value);
    if (!hasConfigShape(data)) return;
    const signature = `${key}\n${value}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    candidates.push({
      source: 'local',
      label,
      storageKey: key,
      data,
      updatedAt: data.savedAt,
      priority
    });
  }

  exactKeys.forEach((key, index) => {
    const value = localStorage.getItem(key);
    if (value) addCandidate(key, value, 90 - index, '本机当前表格配置');
  });

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index) || '';
    if (!key.startsWith(`${STORAGE_KEY_PREFIX}:`) || key === LAST_CONFIG_STORAGE_KEY) continue;
    if (exactKeys.includes(key)) continue;
    const value = localStorage.getItem(key);
    if (!value) continue;
    const data = parseSavedConfig(value);
    if (hasConfigShape(data) && configMatchesCurrentTable(key, data)) {
      addCandidate(key, value, 50, '本机同表格历史配置');
    }
  }

  const lastValue = localStorage.getItem(LAST_CONFIG_STORAGE_KEY);
  if (lastValue) {
    const data = parseSavedConfig(lastValue);
    if (hasConfigShape(data) && (!data.tableId || String(data.tableId) === state.tableId)) {
      addCandidate(LAST_CONFIG_STORAGE_KEY, lastValue, 20, '本机最后一次配置');
    }
  }

  return candidates;
}

async function loadRemoteSidebarConfigCandidate(): Promise<SavedConfigCandidate | null> {
  if (!state.appToken || !state.tableId || !state.authCode.trim()) return null;

  const data = await requestJson<{ found: boolean; config?: any; updatedAt?: string }>('/api/plugin/sidebar-config/load', {
    appToken: state.appToken,
    tableId: state.tableId,
    personalBaseToken: state.authCode.trim()
  });

  if (!data.found || !hasConfigShape(data.config)) return null;
  return {
    source: 'remote',
    label: '服务器保存配置',
    data: data.config,
    updatedAt: data.updatedAt || data.config?.savedAt,
    priority: 200
  };
}

function savedConfigPayload() {
  return {
    version: 2,
    savedAt: new Date().toISOString(),
    appToken: state.appToken,
    tableId: state.tableId,
    tableName: state.tableName,
    flows: state.flows.map(flow => ({
      ...flow,
      shotLinkFieldId: flow.shotLinkFieldId || '',
      roleName: normalizeFlowRoleName(flow.roleName || flow.name || flow.savedName || '')
    })),
    activeFlowId: state.activeFlowId,
    authCode: state.authCode,
    apiKey: state.apiKey,
    imagePreviewEnabled: isImagePreviewFeatureEnabled(),
    serverBase: state.serverBase
  };
}

function isImagePreviewFeatureEnabled(): boolean {
  return state.license?.imagePreviewEnabled === true;
}

function isAuthorizationDetailVisible(): boolean {
  return state.license
    ? state.license.authorizationDetailVisible !== false
    : state.guestAuthorizationDetailVisible;
}

function rememberImagePreviewFeature(apiKey: string, enabled: boolean) {
  const key = apiKey.trim();
  if (!key) return;
  imagePreviewFeatureCache.set(key, { enabled, checkedAt: Date.now() });
}

async function isImagePreviewFeatureEnabledForActiveKey(): Promise<boolean> {
  const key = state.apiKey.trim();
  if (!key) return false;
  const cached = imagePreviewFeatureCache.get(key);
  if (cached && Date.now() - cached.checkedAt < LICENSE_REFRESH_INTERVAL * 2) {
    return cached.enabled;
  }
  try {
    const data = await requestJson<any>('/api/key-admin/key-summary', { key });
    const enabled = data?.owner?.features?.imagePreview === true || data?.features?.imagePreview === true;
    rememberImagePreviewFeature(key, enabled);
    return enabled;
  } catch {
    rememberImagePreviewFeature(key, false);
    return false;
  }
}

function setMessage(type: 'info' | 'success' | 'error', text: string) {
  state.message = { type, text };
  render();
}

function setBusy(busy: boolean) {
  state.busy = busy;
  render();
}

function clearOrderPreviewCloseTimer() {
  if (!orderPreviewCloseTimer) return;
  window.clearTimeout(orderPreviewCloseTimer);
  orderPreviewCloseTimer = null;
}

function openOrderPreview() {
  clearOrderPreviewCloseTimer();
  state.orderPreviewOpen = true;
  state.orderPreviewSaving = false;
  state.orderPreviewSaved = false;
  state.dragFieldId = '';
  render();
}

function closeOrderPreview() {
  if (state.orderPreviewSaving) return;
  clearOrderPreviewCloseTimer();
  state.orderPreviewOpen = false;
  state.orderPreviewSaving = false;
  state.orderPreviewSaved = false;
  state.dragFieldId = '';
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

function scrollPanelToTop() {
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    document.scrollingElement?.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    document.querySelector<HTMLElement>('.app')?.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
  });
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

function findFieldByNamesMatching(names: string[], matcher: (field: FieldMeta) => boolean): string {
  const normalized = names.map(name => name.trim());
  const found = state.fields.find(field => normalized.includes(fieldName(field).trim()) && matcher(field));
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

function isUrlField(field: FieldMeta | undefined): boolean {
  if (!field) return false;
  const uiType = String(field.ui_type || '').toLowerCase();
  return field.type === FieldType.Url || uiType === 'url' || uiType.includes('url');
}

function isAttachmentField(field: FieldMeta | undefined): boolean {
  if (!field) return false;
  return field.type === FieldType.Attachment || String(field.ui_type || '').toLowerCase().includes('attachment');
}

function isFieldNotFoundError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error || '');
  const code = typeof error === 'object' && error ? String((error as { code?: unknown }).code || '') : '';
  return code === '10213998' || /field not found|字段不存在/i.test(text);
}

function isSetFieldRejectedError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error || '');
  const code = typeof error === 'object' && error ? String((error as { code?: unknown }).code || '') : '';
  return code === '4' || /set field error/i.test(text);
}

function hasFieldId(id: string): boolean {
  return Boolean(id && state.fields.some(field => fieldId(field) === id));
}

function flowWritebackFieldIds(flow: SignatureFlow): string[] {
  return Array.from(new Set([
    flow.signLinkFieldId,
    flow.automationConfirmFieldId,
    flow.automationLinkFieldId,
    flow.statusFieldId,
    flow.shotLinkFieldId,
    flow.imageAttachmentFieldId
  ].filter(Boolean)));
}

function currentFlowWritebackIds(): string[] {
  return Array.from(new Set([
    state.signLinkFieldId,
    state.automationConfirmFieldId,
    state.automationLinkFieldId,
    state.statusFieldId,
    state.shotLinkFieldId,
    state.imageAttachmentFieldId
  ].filter(Boolean)));
}

function orderedFieldsForDisplayList(): FieldMeta[] {
  const byId = new Map(state.fields.map(field => [fieldId(field), field]));
  const selected = Array.from(state.selectedFieldIds)
    .map(id => byId.get(id))
    .filter(Boolean) as FieldMeta[];
  const selectedSet = new Set(selected.map(field => fieldId(field)));
  const rest = state.fields.filter(field => !selectedSet.has(fieldId(field)));
  return [...selected, ...rest];
}

function selectedFieldsInOrder(): FieldMeta[] {
  const byId = new Map(state.fields.map(field => [fieldId(field), field]));
  return Array.from(state.selectedFieldIds)
    .map(id => byId.get(id))
    .filter(Boolean) as FieldMeta[];
}

function previewValueForField(field: FieldMeta): string {
  const name = fieldName(field);
  if (/日期/.test(name)) return '2026/07/03';
  if (/时间/.test(name)) return '2026/07/03 20:30:39';
  if (/数量|箱数|桶数/.test(name)) return '1';
  if (/判断|预定|预约/.test(name)) return '预定时间内';
  if (/门店|经销部|客户/.test(name)) return '示例门店';
  if (/负责人|人员|司机|客服|申请人/.test(name)) return '示例人员';
  return '示例内容';
}

function moveSelectedFieldNear(dragFieldId: string, targetFieldId: string, placement: 'before' | 'after') {
  if (!dragFieldId || !targetFieldId || dragFieldId === targetFieldId) return;
  const ids = Array.from(state.selectedFieldIds);
  const from = ids.indexOf(dragFieldId);
  const to = ids.indexOf(targetFieldId);
  if (from < 0 || to < 0) return;
  ids.splice(from, 1);
  const targetIndex = ids.indexOf(targetFieldId);
  ids.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, dragFieldId);
  state.selectedFieldIds = new Set(ids);
  state.dragFieldId = '';
  state.orderPreviewSaved = false;
  persistStateToActiveFlow();
  saveLocalConfig();
  render();
}

function moveSelectedFieldToBottom(dragFieldId: string) {
  if (!dragFieldId) return;
  const ids = Array.from(state.selectedFieldIds);
  const from = ids.indexOf(dragFieldId);
  if (from < 0 || from === ids.length - 1) return;
  ids.splice(from, 1);
  ids.push(dragFieldId);
  state.selectedFieldIds = new Set(ids);
  state.dragFieldId = '';
  state.orderPreviewSaved = false;
  persistStateToActiveFlow();
  saveLocalConfig();
  render();
}

function isFieldUsedByOtherFlow(fieldIdValue: string, currentFlowId: string): boolean {
  return state.flows
    .filter(flow => flow.id !== currentFlowId)
    .some(flow => flowWritebackFieldIds(flow).includes(fieldIdValue));
}

async function deleteFlowFields(table: any, flow: SignatureFlow): Promise<{ deleted: string[]; skipped: string[]; failed: string[] }> {
  await refreshFields(table);
  const deleted: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  const knownIds = new Set<string>();
  const flowNames = new Set<FlowFieldKind>(['confirm', 'automation', 'status', 'shot', 'imageAttachment']);
  const fieldCandidates = new Map<string, FieldMeta>();

  for (const id of flowWritebackFieldIds(flow)) {
    const field = state.fields.find(item => fieldId(item) === id);
    if (field) fieldCandidates.set(id, field);
    knownIds.add(id);
  }

  for (const kind of flowNames) {
    const currentName = fieldNameForFlowBase(flow.name, kind);
    const savedName = fieldNameForFlowBase(flow.savedName || flow.name, kind);
    for (const name of [currentName, savedName]) {
      const field = findFieldByName(name);
      if (field) {
        const id = fieldId(field);
        if (!knownIds.has(id)) fieldCandidates.set(id, field);
      }
    }
  }

  for (const [id, field] of fieldCandidates) {
    const name = fieldName(field);
    if (!id || isFieldUsedByOtherFlow(id, flow.id)) {
      skipped.push(name || id);
      continue;
    }
    try {
      const ok = await table.deleteField?.(id);
      if (ok === false) {
        failed.push(name || id);
      } else {
        deleted.push(name || id);
      }
    } catch (error) {
      if (isFieldNotFoundError(error)) {
        deleted.push(name || id);
      } else {
        console.warn('[signature-flow] 删除流程字段失败', name || id, error);
        failed.push(name || id);
      }
    }
  }

  await refreshFields(table);
  return { deleted, skipped, failed };
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
    '签字结果链接',
    '签名结果链接',
    '签字图片',
    '签名图片',
    '签字图片预览',
    '签名图片预览',
    '签名截图链接',
    '截图链接'
  ].includes(name)) return true;

  return (
    name.includes('签字确认') ||
    name.includes('自动化签字链接') ||
    name.includes('签字状态') ||
    name.includes('签名状态') ||
    name.includes('签字结果链接') ||
    name.includes('签名结果链接') ||
    name.includes('签字图片') ||
    name.includes('签名图片') ||
    name.includes('签字图片预览') ||
    name.includes('签名图片预览') ||
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

async function ensureSingleSelectField(table: any, name: string, existingId = ''): Promise<string> {
  const reusable = (existingId ? state.fields.find(field => fieldId(field) === existingId) : undefined) || findFieldByName(name);

  if (reusable) {
    const id = fieldId(reusable);
    try {
      await updateSingleSelectField(table, id, name);
      const updated = state.fields.find(field => fieldId(field) === id);
      if (!isSingleSelectField(updated)) {
        throw new Error(`字段“${name}”必须是单选字段，请删除错误字段后重新保存配置。`);
      }
      return id;
    } catch (error) {
      if (!isFieldNotFoundError(error)) throw error;
      await refreshFields(table);
      const renamed = findFieldByName(name);
      if (renamed) {
        const renamedId = fieldId(renamed);
        await updateSingleSelectField(table, renamedId, name);
        const updated = state.fields.find(field => fieldId(field) === renamedId);
        if (!isSingleSelectField(updated)) {
          throw new Error(`字段“${name}”必须是单选字段，请删除错误字段后重新保存配置。`);
        }
        return renamedId;
      }
    }
  }

  const id = await addField(table, name, FieldType.SingleSelect, {
    options: statusOptionPayload(),
    optionsType: 0
  });
  const created = state.fields.find(field => fieldId(field) === id);
  if (!isSingleSelectField(created)) {
    throw new Error(`字段“${name}”创建失败：没有生成单选字段。`);
  }
  return id;
}

async function ensureAttachmentField(table: any, name: string, existingId = ''): Promise<string> {
  const reusable = (existingId ? state.fields.find(field => fieldId(field) === existingId) : undefined) || findFieldByName(name);

  if (reusable) {
    const id = fieldId(reusable);
    if (!isAttachmentField(reusable)) {
      throw new Error(`字段“${name}”必须是附件字段，请删除错误字段后重新保存配置。`);
    }
    try {
      await updateAttachmentField(table, id, name);
      return id;
    } catch (error) {
      if (!isFieldNotFoundError(error)) throw error;
      await refreshFields(table);
      const renamed = findFieldByName(name);
      if (renamed) {
        const renamedId = fieldId(renamed);
        if (!isAttachmentField(renamed)) {
          throw new Error(`字段“${name}”必须是附件字段，请删除错误字段后重新保存配置。`);
        }
        await updateAttachmentField(table, renamedId, name);
        return renamedId;
      }
    }
  }

  const id = await addField(table, name, FieldType.Attachment, { onlyMobile: false });
  const created = state.fields.find(field => fieldId(field) === id);
  if (!isAttachmentField(created)) {
    throw new Error(`字段“${name}”创建失败：没有生成附件字段。`);
  }
  return id;
}

async function ensureUrlField(table: any, name: string, existingId = ''): Promise<string> {
  const reusable = (existingId ? state.fields.find(field => fieldId(field) === existingId) : undefined) || findFieldByName(name);

  if (reusable) {
    const id = fieldId(reusable);
    if (!isUrlField(reusable)) {
      throw new Error(`字段“${name}”必须是链接字段，请删除错误字段后重新保存配置。`);
    }
    try {
      await updateUrlField(table, id, name);
      return id;
    } catch (error) {
      if (!isFieldNotFoundError(error)) throw error;
      await refreshFields(table);
      const renamed = findFieldByName(name);
      if (renamed) {
        const renamedId = fieldId(renamed);
        if (!isUrlField(renamed)) {
          throw new Error(`字段“${name}”必须是链接字段，请删除错误字段后重新保存配置。`);
        }
        await updateUrlField(table, renamedId, name);
        return renamedId;
      }
    }
  }

  const id = await addField(table, name, FieldType.Url);
  const created = state.fields.find(field => fieldId(field) === id);
  if (!isUrlField(created)) {
    throw new Error(`字段“${name}”创建失败：没有生成链接字段。`);
  }
  return id;
}

function buildAutomationFormula(): string {
  if (!state.apiKey.trim()) return '""';
  const base = cleanServerBase(state.serverBase || DEFAULT_SERVER);
  return `"${base}/signature?configId=${state.configId}&recordId=" & RECORD_ID()`;
}

function buildConfirmFormula(): string {
  return `HYPERLINK(${buildAutomationFormula()}, "在线签字确认")`;
}

function formulaProperty(formula: string): Record<string, unknown> {
  return {
    formula,
    formatter: 'text'
  };
}

function formulaFromMeta(field: FieldMeta | null | undefined): string {
  const property = field?.property || {};
  const candidates = [
    property.formula,
    property.formula_expression,
    property.formulaString,
    (field as Record<string, unknown> | null | undefined)?.formula,
    (field as Record<string, unknown> | null | undefined)?.formula_expression,
    (field as Record<string, unknown> | null | undefined)?.formulaString
  ];
  const found = candidates.find(value => typeof value === 'string' && value.trim());
  return typeof found === 'string' ? found : '';
}

function formulaContainsPublicKey(formula: string): boolean {
  return /[?&]key\s*=/i.test(formula);
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || '未知错误');
}

function isApiKeySaveError(error: unknown): boolean {
  const code = typeof error === 'object' && error ? String((error as { code?: unknown }).code || '') : '';
  if (code === 'SIGN_FIELD_MAPPING_INVALID' || code === 'SIGN_STATUS_FIELD_MISSING' || code === 'SIGN_FIELD_ROLE_MISMATCH') {
    return false;
  }
  const text = errorText(error);
  if (/签字字段配置|字段配置|字段绑定|字段已失效|绑定到其他角色|SIGN_FIELD/i.test(text)) return false;
  return /api\s*key|key|授权后台|授权.*key|过期|次数|未授权/i.test(text);
}

function isPreviewSyncPendingError(error: unknown): boolean {
  const text = errorText(error);
  return /签字回执尚未生成|签字任务不存在|签名任务不存在|图片预览当前不可用|签字尚未完成/.test(text);
}

async function getFormulaFieldMeta(table: any, id: string): Promise<FieldMeta | null> {
  const directMeta = await callMaybe<FieldMeta>(() => table.getFieldMetaById?.(id));
  if (directMeta) return directMeta;

  const field = await callMaybe<any>(() => table.getFieldById?.(id));
  const fieldMeta = await callMaybe<FieldMeta>(() => field?.getMeta?.());
  if (fieldMeta) return fieldMeta;

  await refreshFields(table);
  return state.fields.find(item => fieldId(item) === id) || null;
}

async function readFormulaText(table: any, id: string): Promise<string> {
  const field = await callMaybe<any>(() => table.getFieldById?.(id));
  const directFormula = await callMaybe<string>(() => field?.getFormula?.());
  if (typeof directFormula === 'string' && directFormula.trim()) return directFormula;

  const meta = await getFormulaFieldMeta(table, id);
  return formulaFromMeta(meta);
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
  if (formulaField?.setFormula) await formulaField.setFormula(formula);

  await refreshFields(table);
  const currentFormula = await readFormulaText(table, id);
  if (formulaContainsPublicKey(currentFormula)) {
    throw new Error(`字段“${name}”创建后仍包含旧 key 参数，已停止保存，避免继续生成不安全链接。`);
  }
  return id;
}

async function updateFormulaField(table: any, id: string, name: string, formula: string, description: string): Promise<void> {
  const errors: string[] = [];
  const formulaField = await callMaybe<any>(() => table.getFieldById?.(id));
  let updated = false;

  if (formulaField?.setFormula) {
    try {
      await formulaField.setFormula(formula);
      updated = true;
    } catch (error) {
      errors.push(`setFormula: ${errorText(error)}`);
    }
  }

  if (table.setField) {
    const latestMeta = await getFormulaFieldMeta(table, id);
    const latestProperty = latestMeta?.property || {};
    try {
      await table.setField(id, {
        name,
        type: FieldType.Formula,
        property: {
          ...latestProperty,
          ...formulaProperty(formula)
        },
        description: { content: description, disableSyncToFormDesc: false }
      });
      updated = true;
    } catch (error) {
      errors.push(`setField: ${errorText(error)}`);
    }
  }

  await refreshFields(table);
  const currentFormula = await readFormulaText(table, id);
  if (formulaContainsPublicKey(currentFormula)) {
    throw new Error(`字段“${name}”还是旧公式，里面仍包含 key 参数。已停止保存，避免生成不安全链接。请确认已安装最新测试插件后重试；如果仍失败，把这个错误发我：${errors.join('；') || '未读取到飞书返回错误'}`);
  }
  if (!updated && !currentFormula) {
    throw new Error(`字段“${name}”公式更新失败，飞书没有返回可验证的新公式。请确认当前账号有表格字段管理权限后重试。${errors.length ? `错误：${errors.join('；')}` : ''}`);
  }
}

async function disableFormulaFieldIfExists(table: any, kind: 'confirm' | 'automation', reason: string): Promise<void> {
  const name = flowFieldName(kind);
  const id = existingFlowFieldId(kind);
  if (!id) return;
  await updateFormulaField(
    table,
    id,
    name,
    '""',
    `${flowBaseName()}签字流程当前没有有效 API key，已暂停生成签字入口。${reason}`
  );
  if (kind === 'confirm') state.automationConfirmFieldId = id;
  if (kind === 'automation') state.automationLinkFieldId = id;
}

async function revokeCurrentFlowServerKey(reason: string): Promise<void> {
  if (!state.configId || !state.authCode.trim()) return;
  await requestJson<{ success: boolean }>('/api/plugin/config-key/revoke', {
    configId: state.configId,
    appToken: state.appToken,
    tableId: state.tableId,
    personalBaseToken: state.authCode.trim(),
    reason
  });
}

async function revokeCurrentFlowAuthorization(table: any, reason: string): Promise<void> {
  stopAutoSync();
  await refreshFields(table);
  await disableFormulaFieldIfExists(table, 'confirm', reason);
  await disableFormulaFieldIfExists(table, 'automation', reason);
  await revokeCurrentFlowServerKey(reason);
  state.apiKey = '';
  state.license = null;
  persistStateToActiveFlow();
  activeFlow().savedName = flowBaseName();
  saveLocalConfig();
  await saveRemoteSidebarConfig();
}

function existingFlowFieldId(kind: FlowFieldKind): string {
  const currentName = flowFieldName(kind);
  const previousName = previousFlowFieldName(kind);
  const names = Array.from(new Set([currentName, previousName]));
  const currentId = {
    confirm: state.automationConfirmFieldId,
    automation: state.automationLinkFieldId,
    status: state.statusFieldId,
    shot: state.shotLinkFieldId,
    imageAttachment: state.imageAttachmentFieldId
  }[kind];

  const currentField = currentId ? state.fields.find(field => fieldId(field) === currentId) : undefined;
  if (currentField) {
    const currentFieldName = fieldName(currentField).trim();
    if (kind === 'confirm' || kind === 'automation') {
      if (names.includes(currentFieldName) && isFormulaField(currentField)) return currentId;
    }
    if (kind === 'status') {
      if (names.includes(currentFieldName) && isSingleSelectField(currentField)) return currentId;
    }
    if (kind === 'shot') {
      if (names.includes(currentFieldName) && isUrlField(currentField)) return currentId;
    }
    if (kind === 'imageAttachment') {
      if (names.includes(currentFieldName) && isAttachmentField(currentField)) return currentId;
    }
  }

  if (kind === 'confirm' || kind === 'automation') {
    return findFieldByNamesMatching(names, isFormulaField);
  }
  if (kind === 'status') {
    return findFieldByNamesMatching(names, isSingleSelectField);
  }
  if (kind === 'shot') {
    return findFieldByNamesMatching(names, isUrlField);
  }
  if (kind === 'imageAttachment') {
    return findFieldByNamesMatching(names, isAttachmentField);
  }
  return findFieldByNames(names);
}

async function updateUrlField(table: any, id: string, name: string): Promise<void> {
  const field = state.fields.find(item => fieldId(item) === id);
  if (field && isUrlField(field)) {
    await refreshFields(table);
    return;
  }
  if (field) {
    throw new Error(`字段“${name}”必须是链接字段，请删除错误字段后重新保存配置。`);
  }
  await refreshFields(table);
}

async function updateAttachmentField(table: any, id: string, name: string): Promise<void> {
  const field = await callMaybe<any>(() => table.getFieldById?.(id));
  await callMaybe(() => field?.setOnlyMobile?.(false));
  await refreshFields(table);
}

async function updateSingleSelectField(table: any, id: string, name: string): Promise<void> {
  const field = state.fields.find(item => fieldId(item) === id);
  if (!isSingleSelectField(field)) {
    throw new Error(`字段“${name}”必须是单选字段，请删除错误字段后重新保存配置。`);
  }
  await refreshFields(table);
}

async function upsertFormulaField(table: any, name: string, formula: string, description: string, existingId = ''): Promise<string> {
  const existing = (existingId ? state.fields.find(field => fieldId(field) === existingId) : undefined) || findFieldByName(name);
  if (!existing) {
    return await createFormulaField(table, name, formula, description);
  }

  const id = fieldId(existing);
  try {
    await updateFormulaField(table, id, name, formula, description);
    await refreshFields(table);
    return id;
  } catch (error) {
    if (!isFieldNotFoundError(error)) throw error;
    await refreshFields(table);
    const renamed = findFieldByName(name);
    if (renamed) {
      const renamedId = fieldId(renamed);
      await updateFormulaField(table, renamedId, name, formula, description);
      await refreshFields(table);
      return renamedId;
    }
    return await createFormulaField(table, name, formula, description);
  }
}

async function ensureWritebackFields(table: any, imagePreviewEnabledOverride = isImagePreviewFeatureEnabled()) {
  await refreshFields(table);
  const imagePreviewEnabled = imagePreviewEnabledOverride;

  state.signLinkFieldId = '';
  state.automationLinkFieldId = await ensureAutomationLinkField(table);

  const statusName = flowFieldName('status');
  const existingStatusId = existingFlowFieldId('status');
  state.statusFieldId = await ensureSingleSelectField(table, statusName, existingStatusId);
  await ensureStatusOptions(table);

  const resultLinkName = flowFieldName('shot');
  const existingResultLinkId = existingFlowFieldId('shot');
  state.shotLinkFieldId = await ensureUrlField(table, resultLinkName, existingResultLinkId);

  if (imagePreviewEnabled) {
    const imageAttachmentName = flowFieldName('imageAttachment');
    const existingImageAttachmentId = existingFlowFieldId('imageAttachment');
    state.imageAttachmentFieldId = await ensureAttachmentField(table, imageAttachmentName, existingImageAttachmentId);
  } else {
    state.imageAttachmentFieldId = existingFlowFieldId('imageAttachment') || '';
  }

  const writebackIds = currentFlowWritebackIds();

  state.selectedFieldIds = new Set(
    Array.from(state.selectedFieldIds).filter(id => {
      const field = state.fields.find(item => fieldId(item) === id);
      return field && !writebackIds.includes(id);
    })
  );
  if (!state.selectedFieldIds.size) {
    state.selectedFieldIds = new Set(
      state.fields
        .map(fieldId)
        .filter(id => {
          const field = state.fields.find(item => fieldId(item) === id);
          return id && field && !isWritebackLikeField(field) && !writebackIds.includes(id);
        })
    );
  }
}

async function repairWritebackFields(table: any, imagePreviewEnabledOverride = isImagePreviewFeatureEnabled()) {
  await ensureWritebackFields(table, imagePreviewEnabledOverride);
  persistStateToActiveFlow();
  saveLocalConfig();
}

async function ensureAutomationLinkField(table: any): Promise<string> {
  const confirmName = flowFieldName('confirm');
  const automationName = flowFieldName('automation');
  const existingAutomationId = existingFlowFieldId('automation');
  const existingConfirmId = existingFlowFieldId('confirm');
  if (!state.configId) {
    state.automationConfirmFieldId = existingConfirmId || findFieldByNames([confirmName]);
    return existingAutomationId || '';
  }

  state.automationConfirmFieldId = await upsertFormulaField(
    table,
    confirmName,
    buildConfirmFormula(),
    `${flowBaseName()}签字流程在飞书自动化消息中显示的签字入口文字。`,
    existingConfirmId
  );

  return await upsertFormulaField(
    table,
    automationName,
    buildAutomationFormula(),
    `${flowBaseName()}签字流程在飞书自动化消息中使用的签字链接，由公式实时拼接 recordId。`,
    existingAutomationId
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

function normalizeSavedFlow(flow: Partial<SignatureFlow>): SignatureFlow {
  const base = createFlow(flow.name || '未命名流程');
  const roleName = normalizeFlowRoleName(flow.roleName || flow.name || flow.savedName || '');
  return {
    ...base,
    ...flow,
    id: String(flow.id || base.id),
    name: roleName || flow.name || '未命名流程',
    roleName: roleName || flow.roleName || flow.name || '未命名流程',
    savedName: flow.savedName || flow.name || '',
    selectedFieldIds: Array.isArray(flow.selectedFieldIds) ? flow.selectedFieldIds : []
  };
}

function applySavedConfigData(data: any): boolean {
  if (!data || typeof data !== 'object') return false;

  if (Array.isArray(data.flows) && data.flows.length) {
    state.flows = data.flows.map(normalizeSavedFlow);
    ensureUniqueFlowIds(state.flows);
    repairDuplicateFlowNamesFromBindings(state.flows);
    state.activeFlowId = state.flows.some(flow => flow.id === data.activeFlowId) ? data.activeFlowId : state.flows[0].id;
  } else if (data.configId || data.apiKey || Array.isArray(data.selectedFieldIds)) {
    state.flows = [{
      ...createFlow('签字'),
      configId: data.configId || '',
      apiKey: data.apiKey || '',
      signLinkFieldId: data.signLinkFieldId || '',
      automationConfirmFieldId: data.automationConfirmFieldId || '',
      automationLinkFieldId: data.automationLinkFieldId || '',
      statusFieldId: data.statusFieldId || '',
      shotLinkFieldId: data.shotLinkFieldId || '',
      imageAttachmentFieldId: data.imageAttachmentFieldId || '',
      selectedFieldIds: Array.isArray(data.selectedFieldIds) ? data.selectedFieldIds : [],
      autoSyncEnabled: typeof data.autoSyncEnabled === 'boolean' ? data.autoSyncEnabled : true
    }];
    ensureUniqueFlowIds(state.flows);
    state.activeFlowId = state.flows[0].id;
  } else {
    return false;
  }

  state.authCode = data.authCode || data.personalBaseToken || state.authCode;
  state.apiKey = data.apiKey || state.apiKey;
  applyFlowToState(activeFlow());
  return true;
}

function ensureDefaultFlow() {
  const flow = createFlow();
  state.flows = [flow];
  state.activeFlowId = flow.id;
  applyFlowToState(flow);
}

function hasRunnableFlow(): boolean {
  return state.flows.some(flow => flow.configId && flow.apiKey.trim() && flow.autoSyncEnabled !== false);
}

async function saveRemoteSidebarConfig() {
  if (!state.appToken || !state.tableId || !state.authCode.trim()) return;
  normalizeFlowList();
  persistStateToActiveFlow();
  await requestJson<{ success: boolean; updatedAt?: string }>('/api/plugin/sidebar-config/save', {
    appToken: state.appToken,
    tableId: state.tableId,
    personalBaseToken: state.authCode.trim(),
    config: savedConfigPayload()
  });
}

async function syncBackendConfig(): Promise<void> {
  if (
    !state.configId ||
    !state.authCode.trim() ||
    !state.apiKey.trim() ||
    !state.automationLinkFieldId ||
    !state.automationConfirmFieldId ||
    !state.statusFieldId ||
    !state.selectedFieldIds.size
  ) {
    return;
  }

  const statusField = state.fields.find(field => fieldId(field) === state.statusFieldId);
  const statusOptions = (statusField as any)?.property?.options || [];
  const result = await requestJson<{ configId: string }>('/api/initConfig', {
    configId: state.configId,
    appToken: state.appToken,
    tableId: state.tableId,
    fieldIds: Array.from(state.selectedFieldIds),
    signFieldIds: {
      roleName: flowBaseName(),
      link: undefined,
      automationLink: state.automationLinkFieldId || undefined,
      status: state.statusFieldId,
      statusName: statusField ? fieldName(statusField) : flowFieldName('status'),
      shotLink: state.shotLinkFieldId || undefined,
      imageAttachment: state.imageAttachmentFieldId || undefined,
      automationConfirm: state.automationConfirmFieldId || undefined,
      statusOptions: {
        pendingName: STATUS_PENDING,
        viewedName: STATUS_VIEWED,
        doneName: STATUS_DONE,
        options: statusOptions
      }
    },
    personalBaseToken: state.authCode.trim(),
    apiKey: state.apiKey.trim(),
    roleName: flowBaseName()
  });
  state.configId = result.configId;
}

function scheduleRemoteSidebarConfigSave() {
  if (!state.appToken || !state.tableId || !state.authCode.trim()) return;
  if (remoteConfigSaveTimer) window.clearTimeout(remoteConfigSaveTimer);
  remoteConfigSaveTimer = window.setTimeout(() => {
    remoteConfigSaveTimer = null;
    if (backgroundFlowRunDepth > 0) {
      scheduleRemoteSidebarConfigSave();
      return;
    }
    saveRemoteSidebarConfig().catch(error => console.warn('[signature-config] 保存侧边栏配置失败', error));
  }, 500);
}

function saveLocalConfig(options: { skipRemote?: boolean } = {}) {
  if (backgroundFlowRunDepth > 0) {
    persistStateToActiveFlow();
    pendingConfigSaveAfterBackground = true;
    if (!options.skipRemote) pendingConfigSaveNeedsRemote = true;
    return;
  }
  normalizeFlowList();
  persistStateToActiveFlow();
  const payload = JSON.stringify(savedConfigPayload());
  for (const key of storageFallbackKeys()) {
    localStorage.setItem(key, payload);
  }

  if (state.authCode) {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}:authCode`, state.authCode);
  }

  if (!options.skipRemote) {
    scheduleRemoteSidebarConfigSave();
  }

  restartLicenseRefreshTimer();
}

async function initializeContext() {
  try {
    await loadPluginSettings();
    startPluginSettingsRefreshTimer();

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
    state.shotLinkFieldId = findFieldByNames(['签字结果链接', '签名结果链接', '签字图片', '签名图片']);
    state.imageAttachmentFieldId = findFieldByNames(['签字图片预览', '签名图片预览']);
    state.selectedFieldIds = new Set(
      state.fields
        .filter(field => !isWritebackLikeField(field))
        .map(fieldId)
        .filter(id => id && ![state.signLinkFieldId, state.automationConfirmFieldId, state.automationLinkFieldId, state.statusFieldId, state.shotLinkFieldId, state.imageAttachmentFieldId].includes(id))
    );

    const restoreResult = await restoreBestSavedConfig();
    restoredConfigWarning = restoreResult.warning;
    await refreshLicenseSummary({ silent: true });

    // 打开插件时只恢复配置，不自动创建、改名或同步写回字段。
    // 字段变更只允许在用户点击“保存配置并开始”后发生，避免刷新面板时串改其他角色。
    if (state.configId || activeFlow().savedName) {
      persistStateToActiveFlow();
    }

    if (!state.appToken || !state.tableId) {
      setMessage('error', '未读取到 appToken 或 tableId。请确认插件运行在飞书多维表格侧边栏中。');
      return;
    }

    saveLocalConfig();
    if (state.flows.some(flow => flow.configId && flow.apiKey.trim() && flow.autoSyncEnabled !== false)) {
      await startAutoSync();
    }
    setMessage(restoredConfigWarning ? 'info' : 'success', restoredConfigWarning || '已连接当前多维表格，写回字段已自动准备。');
  } catch (error) {
    setMessage('error', error instanceof Error ? error.message : String(error));
  }
}

async function requestJson<T>(path: string, body: unknown): Promise<T> {
  return await fetchJson<T>(`${state.serverBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function formatDateTime(value: unknown): string {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function normalizeLicenseSummary(data: any): NonNullable<AppState['license']> {
  const authorization = data?.authorization || {};
  const type = authorization.type || 'unknown';
  const officialUrl = PLUGIN_OFFICIAL_URL;
  const updatedAt = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const imagePreviewEnabled = data?.owner?.features?.imagePreview === true || data?.features?.imagePreview === true;
  const authorizationDetailVisible = data?.owner?.features?.authorizationDetailVisible !== false && data?.features?.authorizationDetailVisible !== false;

  if (type === 'trial') {
    const total = Number(authorization.totalUseLimit || 30);
    const remaining = Number(authorization.remainingUses ?? Math.max(0, total - Number(authorization.usedCount || 0)));
    return {
      type,
      title: `体验签字${total}次`,
      detail: `当前剩余 ${remaining} 次，签字成功后会自动刷新。`,
      officialUrl,
      imagePreviewEnabled,
      authorizationDetailVisible,
      updatedAt
    };
  }

  if (type === 'count') {
    const remaining = Number(authorization.remainingUses ?? 0);
    return {
      type,
      title: `剩余${remaining}次`,
      detail: '次数授权，每次签字成功提交后扣 1 次。',
      officialUrl,
      imagePreviewEnabled,
      authorizationDetailVisible,
      updatedAt
    };
  }

  if (type === 'duration') {
    const expiresAt = formatDateTime(authorization.expiresAt) || String(authorization.title || '').replace(/^到期：/, '');
    return {
      type,
      title: '到期日期和时间',
      detail: expiresAt || '未读取到到期时间',
      officialUrl,
      imagePreviewEnabled,
      authorizationDetailVisible,
      updatedAt
    };
  }

  if (type === 'permanent') {
    return {
      type,
      title: '永久',
      detail: '永久授权，不限制签字次数。',
      officialUrl,
      imagePreviewEnabled,
      authorizationDetailVisible,
      updatedAt
    };
  }

  return {
    type: 'unknown',
    title: authorization.title || '未读取到授权',
    detail: authorization.detail || '请确认 API key 是否正确。',
    officialUrl,
    imagePreviewEnabled,
    authorizationDetailVisible,
    updatedAt
  };
}

async function refreshLicenseSummary(options: { silent?: boolean } = {}) {
  if (!state.apiKey.trim()) {
    state.license = null;
    if (!options.silent) render();
    return;
  }

  const requestSeq = ++licenseRequestSeq;
  try {
    const data = await requestJson<any>('/api/key-admin/key-summary', { key: state.apiKey.trim() });
    if (requestSeq !== licenseRequestSeq) return;
    state.license = normalizeLicenseSummary(data);
    rememberImagePreviewFeature(state.apiKey.trim(), state.license.imagePreviewEnabled);
  } catch (error) {
    if (requestSeq !== licenseRequestSeq) return;
    state.license = {
      type: 'unknown',
      title: 'key 已失效或未授权',
      detail: error instanceof Error ? error.message : String(error),
      officialUrl: PLUGIN_OFFICIAL_URL,
      imagePreviewEnabled: false,
      authorizationDetailVisible: true,
      updatedAt: new Date().toLocaleTimeString('zh-CN', { hour12: false })
    };
    rememberImagePreviewFeature(state.apiKey.trim(), false);
  }

  if (!options.silent) render();
}

async function validateApiKeyForRestore(apiKey: string): Promise<KeyValidationResult> {
  const key = apiKey.trim();
  if (!key) return { ok: false, error: '空 key' };
  try {
    const data = await requestJson<any>('/api/key-admin/key-summary', { key });
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function evaluateConfigCandidate(candidate: SavedConfigCandidate) {
  const data = sanitizeSavedFlowsForRestore(candidate.data);
  const keys = collectConfigApiKeys(data);
  const validKeys = new Set<string>();
  const invalidKeys = new Map<string, string>();

  for (const key of keys) {
    const result = await validateApiKeyForRestore(key);
    if (result.ok) {
      validKeys.add(key);
    } else {
      invalidKeys.set(key, result.error || 'key 已失效');
    }
  }

  clearInvalidApiKeysFromConfig(data, new Set(invalidKeys.keys()));
  return {
    candidate,
    data,
    validKeyCount: validKeys.size,
    invalidKeyCount: invalidKeys.size,
    invalidReasons: Array.from(invalidKeys.values())
  };
}

async function restoreBestSavedConfig(): Promise<RestoreConfigResult> {
  const candidates: SavedConfigCandidate[] = [];
  try {
    const remote = await loadRemoteSidebarConfigCandidate();
    if (remote) candidates.push(remote);
  } catch (error) {
    console.warn('[signature-config] 后端配置恢复失败，尝试本地缓存', error);
  }
  candidates.push(...collectLocalSavedConfigCandidates());

  if (!candidates.length) {
    ensureDefaultFlow();
    return { restored: false, warning: '', selectedSource: '' };
  }

  const evaluated = await Promise.all(candidates.map(evaluateConfigCandidate));
  evaluated.sort((a, b) => {
    if (b.validKeyCount !== a.validKeyCount) return b.validKeyCount - a.validKeyCount;
    const timeDiff = configSavedTime(b.candidate) - configSavedTime(a.candidate);
    if (timeDiff !== 0) return timeDiff;
    return b.candidate.priority - a.candidate.priority;
  });

  const selected = evaluated[0];
  const applied = applySavedConfigData(selected.data);
  if (!applied) {
    ensureDefaultFlow();
    return { restored: false, warning: '', selectedSource: '' };
  }

  const invalidOnly = selected.validKeyCount === 0 && selected.invalidKeyCount > 0;
  const partialInvalid = selected.validKeyCount > 0 && selected.invalidKeyCount > 0;
  const reason = selected.invalidReasons[0] || 'key 已失效或次数已用完';
  const warning = invalidOnly
    ? `已恢复表格配置，但上次保存的 API key 不可用（${reason}），已自动清空，请填写新 key 后保存配置。`
    : partialInvalid
      ? `已恢复可用配置，其中部分流程的旧 API key 不可用（${reason}），已自动清空对应流程 key。`
      : '';

  saveLocalConfig({ skipRemote: true });
  if (selected.validKeyCount > 0) {
    refreshLicenseSummary({ silent: true }).catch(error => console.warn('[signature-license] 初始化授权状态失败', error));
    restartLicenseRefreshTimer();
  }
  return { restored: true, warning, selectedSource: selected.candidate.label };
}

function restartLicenseRefreshTimer() {
  if (licenseTimer) window.clearInterval(licenseTimer);
  licenseTimer = null;
  if (!state.apiKey.trim()) return;
  licenseTimer = window.setInterval(() => {
    refreshLicenseSummary({ silent: false }).catch(error => console.warn('[signature-license] 授权状态刷新失败', error));
  }, LICENSE_REFRESH_INTERVAL);
}

async function saveRemoteConfig() {
  state.serverBase = cleanServerBase(state.serverBase || DEFAULT_SERVER);
  const { table } = await getTableAndView();
  const flow = activeFlow();
  ensureActiveFlowNameIsUnique();
  if (!state.authCode.trim()) {
    throw new Error('请填写多维表格授权码。后端需要它读取和写回飞书记录。');
  }
  if (!state.apiKey.trim()) {
    await revokeCurrentFlowAuthorization(table, '未填写 API key');
    throw new Error('未填写 API key，已撤销当前流程旧授权，并清空表格里的签字入口链接。请填写有效 key 后重新保存。');
  }
  const keyCheck = await validateApiKeyForRestore(state.apiKey);
  if (!keyCheck.ok) {
    const reason = keyCheck.error || 'API key 无效或已过期';
    await revokeCurrentFlowAuthorization(table, reason);
    throw new Error(`${reason}。已撤销当前流程旧授权，并清空表格里的签字入口链接。请填写有效 key 后重新保存。`);
  }
  if (!state.selectedFieldIds.size) {
    throw new Error('请至少选择一个展示字段。');
  }
  if (!state.configId) {
    state.configId = createConfigId();
  }

  await refreshLicenseSummary();
  await ensureWritebackFields(table);

  if (!state.automationLinkFieldId || !state.automationConfirmFieldId || !state.statusFieldId) {
    throw new Error('请先保存配置生成“签字确认”“自动化签字链接”和“签字状态”字段。');
  }

  try {
    await syncBackendConfig();
    await ensureWritebackFields(table);
    await syncBackendConfig();
  } catch (error) {
    if (isApiKeySaveError(error)) {
      const reason = errorText(error);
      await revokeCurrentFlowAuthorization(table, reason);
      throw new Error(`${reason}。已撤销当前流程旧授权，并清空表格里的签字入口链接。请填写有效 key 后重新保存。`);
    }
    throw error;
  }
  persistStateToActiveFlow();
  activeFlow().savedName = flowBaseName();
  saveLocalConfig();
  await saveRemoteSidebarConfig();
  if (state.autoSyncEnabled) {
    await startAutoSync();
  } else {
    stopAutoSync();
  }
  setMessage('success', `配置已保存，configId：${state.configId}`);
}

function buildSignUrl(recordId: string): string {
  if (!state.apiKey.trim()) {
    throw new Error('请先填写 API key 并保存配置。');
  }
  const url = new URL('/signature', state.serverBase);
  url.searchParams.set('configId', state.configId);
  url.searchParams.set('recordId', recordId);
  return url.toString();
}

async function registerTask(recordId: string): Promise<string> {
  if (!state.apiKey.trim()) {
    throw new Error('请先填写 API key 并保存配置。');
  }
  await syncBackendConfig();
  await requestJson<{ signId: string; signUrl: string }>('/api/registerSignTask', {
    configId: state.configId,
    recordId,
    apiKey: state.apiKey.trim()
  });
  await refreshLicenseSummary();
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
  const setPendingStatus = async () => {
    const statusValue = getStatusCellValue(STATUS_PENDING);
    await table.setRecord(recordId, {
      fields: {
        [state.statusFieldId]: statusValue
      }
    });
  };

  try {
    await setPendingStatus();
  } catch (error) {
    if (!isFieldNotFoundError(error)) throw error;
    await repairWritebackFields(table);
    await ensureStatusOptions(table);
    await setPendingStatus();
  }
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
  backgroundFlowRunDepth += 1;
  applyFlowToState(flow);
  try {
    const result = await fn();
    persistStateToActiveFlow();
    return result;
  } finally {
    const previous = state.flows.find(item => item.id === previousFlowId);
    if (previous) applyFlowToState(previous);
    backgroundFlowRunDepth = Math.max(0, backgroundFlowRunDepth - 1);
    if (backgroundFlowRunDepth === 0 && pendingConfigSaveAfterBackground) {
      const needsRemote = pendingConfigSaveNeedsRemote;
      pendingConfigSaveAfterBackground = false;
      pendingConfigSaveNeedsRemote = false;
      saveLocalConfig({ skipRemote: !needsRemote });
    }
    if (backgroundFlowRunDepth === 0 && renderRequestedDuringBackgroundFlow) {
      renderRequestedDuringBackgroundFlow = false;
      render();
    }
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

function hasCellValue(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof File || value instanceof Blob) return true;
  return Boolean(cellText(value).trim());
}

function firstUrlFromCell(value: unknown): string {
  const visited = new Set<unknown>();
  const pickUrl = (input: unknown): string => {
    if (input == null) return '';
    if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean') {
      const match = String(input).match(/https?:\/\/[^\s"'<>]+/);
      return match ? match[0] : '';
    }
    if (Array.isArray(input)) {
      for (const item of input) {
        const found = pickUrl(item);
        if (found) return found;
      }
      return '';
    }
    if (typeof input === 'object') {
      if (visited.has(input)) return '';
      visited.add(input);
      const obj = input as Record<string, unknown>;
      for (const key of ['content', 'link', 'url', 'text', 'value', 'name']) {
        const found = pickUrl(obj[key]);
        if (found) return found;
      }
      for (const item of Object.values(obj)) {
        const found = pickUrl(item);
        if (found) return found;
      }
    }
    return '';
  };
  return pickUrl(value);
}

async function syncImagePreviewForRecord(table: any, record: any, recordId: string): Promise<boolean> {
  const imagePreviewEnabled = await isImagePreviewFeatureEnabledForActiveKey();
  if (!imagePreviewEnabled) return false;
  if (
    !state.imageAttachmentFieldId ||
    !hasFieldId(state.imageAttachmentFieldId)
  ) {
    await repairWritebackFields(table, true);
  }
  if (!state.imageAttachmentFieldId) return false;

  const fields = record?.fields || {};
  if (hasCellValue(fields[state.imageAttachmentFieldId])) return false;

  const retryKey = `${state.configId}:${recordId}:${state.imageAttachmentFieldId}`;
  if ((imagePreviewRetryAfter.get(retryKey) || 0) > Date.now()) return false;

  try {
    const result = await requestJson<{ updated?: boolean; status?: string }>('/api/plugin/image-preview/sync', {
      configId: state.configId,
      recordId,
      key: state.apiKey.trim()
    });
    if (!result.updated) return false;

    const refreshed = await callMaybe(() => table.getRecordById?.(recordId, true));
    if (!hasCellValue(refreshed?.fields?.[state.imageAttachmentFieldId])) {
      throw new Error('飞书后端未确认图片预览附件写入结果。');
    }
    imagePreviewRetryAfter.delete(retryKey);
    return true;
  } catch (error) {
    imagePreviewRetryAfter.set(retryKey, Date.now() + 60_000);
    throw error;
  }
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

type RecordSyncResult = {
  taskChanged: boolean;
  previewChanged: boolean;
};

async function syncRecord(recordId: string, table?: any): Promise<RecordSyncResult> {
  const activeTable = table || (await getTableAndView()).table;
  let record = await callMaybe(() => activeTable.getRecordById?.(recordId, true));
  if (!record) return { taskChanged: false, previewChanged: false };

  let taskChanged = false;
  if (needsSignTask(record)) {
    const signUrl = await registerTask(recordId);
    await writeRecord(activeTable, recordId, signUrl);
    taskChanged = true;
    record = await callMaybe(() => activeTable.getRecordById?.(recordId, true)) || record;
  }

  let previewChanged = false;
  try {
    previewChanged = await syncImagePreviewForRecord(activeTable, record, recordId);
  } catch (error) {
    if (!isPreviewSyncPendingError(error)) throw error;
  }
  return { taskChanged, previewChanged };
}

async function syncAllRecords(): Promise<RecordSyncResult & { previewErrors: number }> {
  if (!state.configId || state.syncInProgress) return { taskChanged: false, previewChanged: false, previewErrors: 0 };
  state.syncInProgress = true;
  try {
    const { table, view } = await getTableAndView();
    const visibleIds = await callMaybe(() => view?.getVisibleRecordIdList?.());
    const ids = (Array.isArray(visibleIds) && visibleIds.length ? visibleIds : await callMaybe(() => table.getRecordIdList?.()) || [])
      .map(String)
      .filter(Boolean);

    const records = await getRecordsByIds(table, ids);
    let taskChangedCount = 0;
    let previewChangedCount = 0;
    let previewErrors = 0;
    for (const record of records) {
      const recordId = String(record.recordId || record.id || '');
      if (!recordId) continue;
      try {
        if (needsSignTask(record)) {
          const signUrl = await registerTask(recordId);
          await writeRecord(table, recordId, signUrl);
          taskChangedCount += 1;
        }
        if (await syncImagePreviewForRecord(table, record, recordId)) {
          previewChangedCount += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isPreviewSyncPendingError(error)) {
          previewErrors += 1;
          continue;
        }
        if (message.includes('图片') || message.includes('附件')) {
          previewErrors += 1;
        }
        state.lastResult = `${recordId} -> 失败：${message}`;
        console.warn('[signature-sync] 同步记录失败', recordId, error);
      }
    }

    state.syncCount += taskChangedCount;
    if (taskChangedCount || previewChangedCount) {
      const resultText = [
        taskChangedCount ? `补齐 ${taskChangedCount} 条签字状态` : '',
        previewChangedCount ? `生成 ${previewChangedCount} 个图片预览附件` : ''
      ].filter(Boolean).join('，');
      state.lastResult = `本次自动同步：${resultText}。累计准备签字状态 ${state.syncCount} 条。`;
      setMessage('success', `已自动同步：${resultText}。`);
    }
    if (!taskChangedCount && !previewChangedCount && previewErrors) {
      setMessage('info', `有 ${previewErrors} 个图片预览暂未生成，后端会在下次同步时重试，原图片链接仍可正常使用。`);
    }
    return {
      taskChanged: taskChangedCount > 0,
      previewChanged: previewChangedCount > 0,
      previewErrors
    };
  } finally {
    state.syncInProgress = false;
  }
}

async function syncAllFlows(): Promise<{ taskChanged: number; previewChanged: number; previewErrors: number }> {
  const flows = [...state.flows].filter(flow => flow.autoSyncEnabled !== false && flow.configId && flow.apiKey.trim());
  let taskChanged = 0;
  let previewChanged = 0;
  let previewErrors = 0;
  for (const flow of flows) {
    const result = await runWithFlow(flow, syncAllRecords);
    if (result.taskChanged) taskChanged += 1;
    if (result.previewChanged) previewChanged += 1;
    previewErrors += result.previewErrors;
  }
  return { taskChanged, previewChanged, previewErrors };
}

function scheduleRecordSync(recordId: string) {
  if (!recordId) return;
  const oldTimer = pendingRecordTimers.get(recordId);
  if (oldTimer) window.clearTimeout(oldTimer);
  const timer = window.setTimeout(async () => {
    pendingRecordTimers.delete(recordId);
    try {
      let changed = 0;
      let previews = 0;
      for (const flow of state.flows.filter(item => item.autoSyncEnabled !== false && item.configId && item.apiKey.trim())) {
        const result = await runWithFlow(flow, () => syncRecord(recordId));
        if (result.taskChanged) {
          flow.syncCount += 1;
          changed += 1;
        }
        if (result.previewChanged) previews += 1;
      }
      if (changed || previews) {
        state.lastResult = `已为记录 ${recordId} 准备 ${changed} 个签字流程，生成 ${previews} 个图片预览附件。`;
        setMessage('success', `已处理记录：签字流程 ${changed} 个，图片预览 ${previews} 个。`);
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
    if ([state.signLinkFieldId, state.statusFieldId, state.imageAttachmentFieldId].some(id => changedFields.includes(id))) return;
    scheduleRecordSync(String(recordId || ''));
  }) || null;

  unsubscribeFieldAdd = table.onFieldAdd?.(() => {
    window.setTimeout(async () => {
      try {
        await refreshFields(table);
        render();
      } catch (error) {
        console.warn('[signature-flow] 字段列表刷新失败', error);
      }
    }, 400);
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
  unsubscribeFieldAdd?.();
  unsubscribeRecordAdd = null;
  unsubscribeRecordModify = null;
  unsubscribeFieldAdd = null;
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
  if (backgroundFlowRunDepth > 0) {
    renderRequestedDuringBackgroundFlow = true;
    return;
  }
  normalizeFlowList();
  const snapshot = captureRenderSnapshot();
  const message = state.message
    ? `<div class="message ${state.message.type}">${escapeHtml(state.message.text)}</div>`
    : '';
  const licenseOfficialUrl = PLUGIN_OFFICIAL_URL;
  const imagePreviewEnabled = isImagePreviewFeatureEnabled();
  const guestMarketingMode = !state.license && state.guestAuthorizationDetailVisible === false;
  const displayImagePreviewEnabled = imagePreviewEnabled || guestMarketingMode;
  const imagePreviewStatus = state.license
    ? (imagePreviewEnabled ? '已开启' : '请登录官网设置')
    : (guestMarketingMode ? '已开启' : '填写 API key 后显示');
  const licenseDetailVisible = isAuthorizationDetailVisible();
  const licenseDetail = state.license?.detail || '填写 API key 后显示授权详情。';
  const licenseTitle = state.license?.title || (guestMarketingMode ? '免费全功能' : '填写 API key 后显示授权次数');
  const imagePreviewDescription = guestMarketingMode
    ? '免费全功能开放中；填写有效 API key 后即可正式使用。'
    : (imagePreviewEnabled ? '授权已开启；签字完成后由后端自动上传飞书图片附件。' : '如需开启，请登录官网后台设置。');
  const license = `
      <section class="license-hero">
        <div class="license-official-row">
          <span>插件官网</span>
          <a href="${escapeHtml(licenseOfficialUrl)}" target="_blank" rel="noreferrer">${escapeHtml(licenseOfficialUrl)}</a>
        </div>
        <div class="license-status-row ${state.license ? 'has-license' : 'is-empty'}">
          <div>
            <span class="license-label">授权次数</span>
            <strong>${escapeHtml(licenseTitle)}</strong>
            ${licenseDetailVisible ? `<p>${escapeHtml(licenseDetail)}</p>` : ''}
          </div>
          <button class="mini-btn license-refresh-btn" id="refreshLicense" ${state.busy || !state.apiKey.trim() ? 'disabled' : ''}>刷新授权</button>
        </div>
        <div class="feature-status-row ${displayImagePreviewEnabled ? 'is-enabled' : ''}">
          <div>
            <span class="license-label">图片预览增强</span>
            <strong>${escapeHtml(imagePreviewStatus)}</strong>
            <p>${escapeHtml(imagePreviewDescription)}</p>
          </div>
          <button class="mini-btn" id="openImagePreviewSettings" ${state.busy ? 'disabled' : ''}>官网设置</button>
        </div>
        ${state.license?.updatedAt ? `<div class="license-updated">最近刷新：${escapeHtml(state.license.updatedAt)}</div>` : ''}
      </section>
    `;

  const orderSaveLabel = state.orderPreviewSaving ? '保存中...' : state.orderPreviewSaved ? '保存成功' : '保存排序';
  const orderSaveClass = state.orderPreviewSaving ? 'is-loading' : state.orderPreviewSaved ? 'is-saved' : '';
  const orderSaveHint = state.orderPreviewSaved
    ? '已同步到签字链接，窗口将自动关闭。'
    : '拖动字段后点击保存，真实签字链接会按这里的顺序展示。';
  const orderPreviewModal = state.orderPreviewOpen ? `
      <div class="order-preview-backdrop ${state.orderPreviewSaving ? 'is-busy' : ''}" id="orderPreviewBackdrop">
        <div class="order-preview-dialog" role="dialog" aria-modal="true">
          <div class="order-preview-header ${state.orderPreviewSaving ? 'is-saving' : ''} ${state.orderPreviewSaved ? 'is-saved' : ''}">
            <div>
              <strong>签字页排序预览</strong>
              <span>${escapeHtml(orderSaveHint)}</span>
            </div>
            <div class="order-preview-actions">
              <button class="mini-btn order-close-btn" id="closeOrderPreview" ${state.orderPreviewSaving ? 'disabled' : ''}>关闭</button>
              <button class="mini-btn order-save-btn ${orderSaveClass}" id="saveOrderPreview" ${state.orderPreviewSaving || !state.selectedFieldIds.size ? 'disabled' : ''}>
                ${orderSaveLabel}
              </button>
            </div>
          </div>
          <div class="order-phone-preview">
            <div class="order-phone-topbar">
              <span></span>
              <strong>签字确认</strong>
              <span></span>
            </div>
            <div class="order-phone-hero">
              <div>
                <h2>六盘情</h2>
                <p>源自六盘 · 情系万家</p>
              </div>
            </div>
            <div class="order-info-card">
              <h3>信息确认</h3>
              <div class="order-preview-fields">
                ${selectedFieldsInOrder().map(field => {
                  const id = fieldId(field);
                  return `
                    <div class="order-preview-row" draggable="true" data-field-id="${escapeHtml(id)}">
                      <span class="order-drag-handle">拖动</span>
                      <span class="order-preview-name">${escapeHtml(fieldName(field))}</span>
                      <strong class="order-preview-value">${escapeHtml(previewValueForField(field))}</strong>
                    </div>
                  `;
                }).join('') || '<div class="order-empty">请先勾选签字人可见字段。</div>'}
                ${selectedFieldsInOrder().length ? '<div class="order-drop-bottom" id="orderDropBottom">拖到这里放到最后</div>' : ''}
              </div>
            </div>
            <div class="order-sign-card">
              <h3>签名区域</h3>
              <div class="order-sign-box">
                <span>请签名</span>
                <em>预览区，仅用于排序</em>
              </div>
            </div>
          </div>
        </div>
      </div>
    ` : '';

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

      ${license}

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
                  ${escapeHtml(flow.name || '未命名流程')}${flow.configId ? ' · 已保存' : ' · 待保存'}
                </option>
              `).join('')}
            </select>
          </div>
          <div class="field">
            <label for="flowName">流程名称</label>
            <input class="input" id="flowName" value="${escapeHtml(flowBaseName())}" placeholder="例如：门店、司机、仓库、客户签收" />
            <span class="muted">可随时修改名称，点击“保存配置并开始”后会同步更新表格里的签字字段，不需要手动删除重建。</span>
          </div>
          <button class="btn danger" id="deleteFlow" ${state.busy ? 'disabled' : ''}>删除当前流程</button>
        </div>
      </section>

      <section class="panel">
        <div class="panel-title">服务器</div>
        <div class="grid">
          <div class="field">
            <label for="serverBase">服务器连接</label>
            <div class="locked-value" id="serverBase">云端服务已由管理员统一配置</div>
            <span class="muted">后端域名由管理员在总后台统一配置，客户侧不能修改。</span>
          </div>
          <div class="field">
            <label for="apiKey">API key 设置</label>
            <input class="input" id="apiKey" type="password" value="${escapeHtml(state.apiKey)}" placeholder="请输入管理员提供的 API key" />
            <span class="muted">Key 只保存在服务器配置里，不会出现在客户签字链接中。次数型 Key 会在签字成功提交时扣 1 次。</span>
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
              <span class="muted">插件会自动准备“签字确认”“自动化签字链接”“签字状态”和“签字结果链接”。图片预览增强开启后，会额外生成表格内图片预览。</span>
            </span>
          </label>
          <label class="switch-row">
            <input type="checkbox" id="imagePreviewToggle" ${imagePreviewEnabled ? 'checked' : ''} />
            <span>
              <span class="switch-title">图片预览增强</span>
              <span class="muted">${imagePreviewEnabled ? '已开启：签字完成后自动生成图片预览附件。' : '如需开启，请登录官网后台设置。'}</span>
            </span>
          </label>
          <div class="summary field-summary">
            <span><b>状态</b>${escapeHtml(fieldName(state.fields.find(field => fieldId(field) === state.statusFieldId) || {}) || '未准备')}</span>
            <span><b>入口</b>${escapeHtml(fieldName(state.fields.find(field => fieldId(field) === state.automationConfirmFieldId) || {}) || '未准备')}</span>
            <span><b>自动化</b>${escapeHtml(fieldName(state.fields.find(field => fieldId(field) === state.automationLinkFieldId) || {}) || '未准备')}</span>
            <span><b>结果链接</b>${escapeHtml(fieldName(state.fields.find(field => fieldId(field) === state.shotLinkFieldId) || {}) || '未准备')}</span>
            <span><b>图片预览</b>${escapeHtml(imagePreviewEnabled ? (fieldName(state.fields.find(field => fieldId(field) === state.imageAttachmentFieldId) || {}) || '保存配置后自动准备') : '请登录官网设置')}</span>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-title">
          <span>签字人可见字段</span>
          <span class="field-title-actions">
            <button class="mini-btn" id="openOrderPreview" ${state.selectedFieldIds.size ? '' : 'disabled'}>放大预览排序</button>
            <span class="muted">${state.selectedFieldIds.size}/${state.fields.length}</span>
          </span>
        </div>
        <div class="field-list">
          ${orderedFieldsForDisplayList().map(field => {
            const id = fieldId(field);
            const selected = state.selectedFieldIds.has(id);
            return `
              <label class="check-row ${selected ? 'is-selected' : ''}">
                <input type="checkbox" class="display-field" value="${escapeHtml(id)}" ${selected ? 'checked' : ''} />
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
          <button class="btn" id="syncNow" ${state.busy || !hasRunnableFlow() ? 'disabled' : ''}>立即同步</button>
        </div>
      </section>

      ${orderPreviewModal}
    </main>
  `;

  bindForm();
  restoreRenderSnapshot(snapshot);
}

function syncFormValues() {
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
    const inputName = window.prompt('请输入新流程名称，例如：门店、司机、仓库、客户签收');
    const flowName = normalizeFlowRoleName(String(inputName || ''));
    if (!flowName) {
      setMessage('error', '新增流程前必须先填写流程名称。');
      return;
    }
    if (state.flows.some(flow => normalizeFlowRoleName(flow.name || flow.savedName || '') === flowName)) {
      setMessage('error', `已存在“${flowName}”签字流程，请不要重复创建。请选择已有流程修改，或换一个不同名称。`);
      return;
    }
    stopAutoSync();
    const flow = createFlow(flowName);
    state.flows.push(flow);
    applyFlowToState(flow);
    saveLocalConfig();
    setMessage('success', `已新增流程：${flow.name}。请选择展示字段后点击“保存配置并开始”。`);
    render();
  });

  document.querySelector('#deleteFlow')?.addEventListener('click', async () => {
    syncFormValues();
    const flow = activeFlow();
    const confirmed = window.confirm(`确定删除流程“${flow.name}”吗？\n\n会同时删除表格里这个流程生成的签字确认、自动化签字链接、签字状态、签字结果链接、签字图片预览字段。`);
    if (!confirmed) return;

    setBusy(true);
    stopAutoSync();
    try {
      const { table } = await getTableAndView();
      const result = await deleteFlowFields(table, flow);
      if (result.failed.length) {
        saveLocalConfig({ skipRemote: true });
        const parts = [
          result.deleted.length ? `已删除字段：${result.deleted.join('、')}` : '',
          result.skipped.length ? `已跳过共用字段：${result.skipped.join('、')}` : '',
          `删除失败：${result.failed.join('、')}`
        ].filter(Boolean);
        setMessage('error', `流程“${flow.name}”还有字段没删掉，已保留流程方便重试。${parts.join('；')}`);
        return;
      }
      state.flows = state.flows.filter(item => item.id !== flow.id);
      if (state.flows.length) {
        applyFlowToState(state.flows[0]);
      } else {
        ensureDefaultFlow();
      }
      saveLocalConfig({ skipRemote: true });
      try {
        await saveRemoteSidebarConfig();
      } catch (error) {
        console.warn('[signature-config] 删除流程后同步后端配置失败，将保留本地缓存', error);
      }
      if (hasRunnableFlow()) {
        await startAutoSync();
      }
      const parts = [
        result.deleted.length ? `已删除字段：${result.deleted.join('、')}` : '',
        result.skipped.length ? `已跳过共用字段：${result.skipped.join('、')}` : '',
        result.failed.length ? `删除失败：${result.failed.join('、')}` : ''
      ].filter(Boolean);
      setMessage(result.failed.length ? 'info' : 'success', `已删除流程“${flow.name}”。${parts.join('；') || '没有需要删除的表格字段。'}`);
    } catch (error) {
      setMessage('error', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  });

  document.querySelector<HTMLSelectElement>('#activeFlowId')?.addEventListener('change', async event => {
    syncFormValues();
    stopAutoSync();
    const flowId = (event.target as HTMLSelectElement).value;
    const flow = state.flows.find(item => item.id === flowId);
    if (flow) {
      applyFlowToState(flow);
      saveLocalConfig();
      setMessage('success', `已切换到流程：${flow.name}`);
      if (state.flows.some(item => item.configId && item.apiKey.trim() && item.autoSyncEnabled !== false)) {
        await startAutoSync();
      } else {
        render();
      }
    }
  });

  document.querySelector<HTMLInputElement>('#flowName')?.addEventListener('change', async () => {
    try {
      const changed = syncFlowNameFromInput();
      syncFormValues();
      persistStateToActiveFlow();
      saveLocalConfig();
      setMessage('info', changed
        ? '流程名称已暂存。点击“保存配置并开始”后，会同步更新表格里的签字字段名称。'
        : '流程名称没有变化。');
      render();
    } catch (error) {
      const flow = activeFlow();
      const input = document.querySelector<HTMLInputElement>('#flowName');
      if (input) input.value = flow.name || '';
      setMessage('error', error instanceof Error ? error.message : String(error));
    }
  });

  document.querySelector<HTMLInputElement>('#apiKey')?.addEventListener('change', async () => {
    syncFormValues();
    saveLocalConfig({ skipRemote: true });
    if (!state.apiKey.trim()) {
      state.license = null;
      setMessage('info', 'API key 已清空。点击“保存配置并开始”后会撤销当前流程旧授权并清空签字入口链接。');
      return;
    }
    const keyCheck = await validateApiKeyForRestore(state.apiKey);
    await refreshLicenseSummary();
    setMessage(keyCheck.ok ? 'success' : 'error', keyCheck.ok
      ? 'API key 可用。点击“保存配置并开始”后才会正式启用。'
      : `${keyCheck.error || 'API key 无效或已过期'}。点击“保存配置并开始”后会撤销当前流程旧授权。`);
  });

  document.querySelector<HTMLTextAreaElement>('#authCode')?.addEventListener('change', () => {
    syncFormValues();
    saveLocalConfig();
    setMessage('success', '多维表格授权码已保存。');
  });

  document.querySelector('#saveConfig')?.addEventListener('click', async () => {
    setBusy(true);
    try {
      syncFlowNameFromInput();
      syncFormValues();
      await saveRemoteConfig();
    } catch (error) {
      setMessage('error', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      scrollPanelToTop();
    }
  });

  document.querySelector('#refreshLicense')?.addEventListener('click', async () => {
    syncFormValues();
    setBusy(true);
    try {
      await refreshLicenseSummary();
      setMessage('success', '授权状态已刷新');
    } catch (error) {
      setMessage('error', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  });

  document.querySelector('#openImagePreviewSettings')?.addEventListener('click', () => {
    window.open(PLUGIN_OFFICIAL_URL, '_blank', 'noopener,noreferrer');
  });

  document.querySelector<HTMLInputElement>('#imagePreviewToggle')?.addEventListener('change', event => {
    const input = event.target as HTMLInputElement;
    if (!isImagePreviewFeatureEnabled()) {
      input.checked = false;
      setMessage('info', '请登录官网去设置。');
      window.open(PLUGIN_OFFICIAL_URL, '_blank', 'noopener,noreferrer');
      return;
    }
    setMessage('success', '图片预览增强已开启，签字完成后会由后端自动上传飞书附件。');
  });

  document.querySelector('#syncNow')?.addEventListener('click', async () => {
    syncFormValues();
    setBusy(true);
    setMessage('info', '正在同步已有记录...');
    try {
      const result = await syncAllFlows();
      if (result.previewErrors > 0) {
        setMessage('info', `同步检查完成，但有 ${result.previewErrors} 个图片预览未生成，后端会继续重试。`);
      } else {
        setMessage('success', '同步检查完成。');
      }
    } catch (error) {
      setMessage('error', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  });

  document.querySelectorAll<HTMLInputElement>('.display-field').forEach(input => {
    input.addEventListener('change', () => {
      syncFormValues();
      state.orderPreviewSaved = false;
      saveLocalConfig();
      render();
    });
  });

  document.querySelector<HTMLButtonElement>('#openOrderPreview')?.addEventListener('click', () => {
    syncFormValues();
    openOrderPreview();
  });

  document.querySelector<HTMLButtonElement>('#closeOrderPreview')?.addEventListener('click', () => {
    closeOrderPreview();
  });

  document.querySelector<HTMLButtonElement>('#saveOrderPreview')?.addEventListener('click', async () => {
    clearOrderPreviewCloseTimer();
    syncFormValues();
    persistStateToActiveFlow();
    saveLocalConfig();
    state.orderPreviewSaving = true;
    state.orderPreviewSaved = false;
    state.message = { type: 'info', text: '正在保存排序...' };
    render();
    try {
      await saveRemoteConfig();
      state.orderPreviewSaving = false;
      state.orderPreviewSaved = true;
      state.dragFieldId = '';
      state.message = { type: 'success', text: '排序已保存并同步。' };
      render();
      orderPreviewCloseTimer = window.setTimeout(() => {
        orderPreviewCloseTimer = null;
        state.orderPreviewOpen = false;
        state.orderPreviewSaved = false;
        render();
      }, 900);
    } catch (error) {
      state.orderPreviewSaving = false;
      state.orderPreviewSaved = false;
      setMessage('error', error instanceof Error ? error.message : String(error));
    }
  });

  document.querySelector<HTMLElement>('#orderPreviewBackdrop')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) closeOrderPreview();
  });

  document.querySelectorAll<HTMLElement>('.order-preview-row').forEach(row => {
    row.addEventListener('dragstart', event => {
      state.dragFieldId = row.dataset.fieldId || '';
      row.classList.add('is-dragging');
      event.dataTransfer?.setData('text/plain', state.dragFieldId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('is-dragging');
      state.dragFieldId = '';
    });
    row.addEventListener('dragover', event => {
      event.preventDefault();
      const rect = row.getBoundingClientRect();
      const placement = event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
      row.dataset.dropPlacement = placement;
      row.classList.toggle('is-drop-before', placement === 'before');
      row.classList.toggle('is-drop-after', placement === 'after');
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    });
    row.addEventListener('dragleave', () => {
      row.classList.remove('is-drop-before', 'is-drop-after');
      row.dataset.dropPlacement = '';
    });
    row.addEventListener('drop', event => {
      event.preventDefault();
      row.classList.remove('is-drop-before', 'is-drop-after');
      const targetId = row.dataset.fieldId || '';
      const dragId = state.dragFieldId || event.dataTransfer?.getData('text/plain') || '';
      const placement = row.dataset.dropPlacement === 'after' ? 'after' : 'before';
      row.dataset.dropPlacement = '';
      moveSelectedFieldNear(dragId, targetId, placement);
    });
  });

  document.querySelector<HTMLElement>('#orderDropBottom')?.addEventListener('dragover', event => {
    event.preventDefault();
    (event.currentTarget as HTMLElement).classList.add('is-drop-target');
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  });

  document.querySelector<HTMLElement>('#orderDropBottom')?.addEventListener('dragleave', event => {
    (event.currentTarget as HTMLElement).classList.remove('is-drop-target');
  });

  document.querySelector<HTMLElement>('#orderDropBottom')?.addEventListener('drop', event => {
    event.preventDefault();
    (event.currentTarget as HTMLElement).classList.remove('is-drop-target');
    const dragId = state.dragFieldId || event.dataTransfer?.getData('text/plain') || '';
    moveSelectedFieldToBottom(dragId);
  });

  document.querySelector<HTMLInputElement>('#autoSyncEnabled')?.addEventListener('change', async () => {
    syncFormValues();
    saveLocalConfig();
    if (state.flows.some(flow => flow.configId && flow.apiKey.trim() && flow.autoSyncEnabled !== false)) {
      await startAutoSync();
    } else {
      stopAutoSync();
      render();
    }
  });
}

render();
window.addEventListener('focus', refreshPluginSettingsInBackground);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshPluginSettingsInBackground();
});
initializeContext();
