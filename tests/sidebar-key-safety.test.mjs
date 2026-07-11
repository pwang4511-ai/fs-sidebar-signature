import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

assert.doesNotMatch(
  source,
  /return localStorage\.getItem\(`\$\{STORAGE_KEY_PREFIX\}:authCode`\)/,
  '不能再从跨表全局 authCode 缓存恢复授权码'
);
assert.match(
  source,
  /localStorage\.removeItem\(`\$\{STORAGE_KEY_PREFIX\}:authCode`\)/,
  '保存时应清理历史全局 authCode'
);
assert.doesNotMatch(
  source,
  /base\?\.getUserId\?\.\(\)/,
  '用户 ID 不能被当作多维表格授权码'
);
assert.match(
  source,
  /data-flow-id="\$\{escapeHtml\(state\.activeFlowId\)\}"/,
  'API key 输入框必须绑定当前流程 ID'
);
assert.match(
  source,
  /renderedFlowId !== state\.activeFlowId/,
  '保存前必须拒绝把 API key 写入其他流程'
);

const saveHandler = source.match(/document\.querySelector\('#saveConfig'\)[\s\S]*?document\.querySelector\('#refreshLicense'\)/)?.[0] || '';
assert.ok(saveHandler, '应找到保存按钮处理器');
assert.ok(
  saveHandler.indexOf('syncFormValues();') < saveHandler.indexOf('setBusy(true);'),
  '必须先读取输入框，再触发会重新渲染页面的忙碌状态'
);

console.log('frontend sidebar/key safety tests passed');
