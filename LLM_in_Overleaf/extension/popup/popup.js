// 弹窗：显示本机桥状态 + 快捷改设置（与面板共用 chrome.storage，同步生效）
const I18N = globalThis.LLMOverleafI18n;
const t = (key, ...values) => I18N.t(key, ...values);
const MODELS = { claude: [['sonnet', 'Sonnet'], ['opus', 'Opus'], ['haiku', 'Haiku']], codex: [['(default)', '使用 Codex 配置']] };
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const EFFORT_LABELS = { none: '不额外思考', minimal: '最少', low: '快速', medium: '均衡', high: '深入', xhigh: '更深入', max: '最高', ultra: '最深入' };
let modelEfforts = { codex: {} };

const $ = (id) => document.getElementById(id);
const cfg = { backend: 'claude', model_claude: 'sonnet', model_codex: '(default)', effort: 'medium' };
let lastHealth = null;

function applyLanguage() {
  document.documentElement.lang = I18N.language;
  I18N.applyStatic(document);
  $('language').value = I18N.language;
  // Windows 用户看到 PowerShell 安装命令，其余平台用 install.sh。
  const windows = /Win/i.test(navigator.platform || navigator.userAgent);
  $('install-command').textContent = windows
    ? 'cd LLM_in_Overleaf; powershell -NoProfile -ExecutionPolicy Bypass -File .\\install.ps1'
    : 'cd LLM_in_Overleaf && ./install.sh';
  if (/^[a-p]{32}$/.test(chrome.runtime.id || '')) {
    $('install-command').textContent += windows ? ` -ExtensionId ${chrome.runtime.id}` : ` --extension-id ${chrome.runtime.id}`;
  }
  fillModels();
  if (lastHealth) renderHealth(lastHealth);
}

// 开启入口不依赖本机 CLI 的健康检查：先让用户能进入面板。
$('open-panel').addEventListener('click', async () => {
  $('open-panel').disabled = true;
  $('page-status').textContent = t('正在打开助手…');
  try {
    const result = await chrome.runtime.sendMessage({ type: 'open_active_panel', lang: I18N.language });
    $('page-status').textContent = result?.ok ? t('助手已打开。可以在页面中继续操作。') : (I18N.known(result?.error) || t('页面没有响应，请刷新 Overleaf 后重试。'));
    $('page-status').classList.toggle('error', !result?.ok);
  } catch {
    $('page-status').textContent = t('无法连接扩展后台，请在扩展管理页重新加载，再刷新 Overleaf。');
    $('page-status').classList.add('error');
  } finally {
    $('open-panel').disabled = false;
  }
});

function fillModels() {
  const list = [...(MODELS[cfg.backend] || MODELS.claude)];
  const want = cfg.backend === 'codex' ? cfg.model_codex : cfg.model_claude;
  if (want && !list.some(([v]) => v === want)) list.push([want, t('{0}（已保存）', want)]);
  $('model').replaceChildren(...list.map(([v, label]) => new Option(I18N.known(label), v)));
  $('model').value = list.some(([v]) => v === want) ? want : list[0][0];
  fillEfforts();
}
function fillEfforts() {
  const levels = cfg.backend === 'codex' ? (modelEfforts.codex?.[$('model').value] || ['low', 'medium', 'high', 'xhigh']) : EFFORTS;
  $('effort').replaceChildren(...levels.map((e) => new Option(EFFORT_LABELS[e] ? `${t(EFFORT_LABELS[e])} · ${e}` : e, e)));
  $('effort').value = levels.includes(cfg.effort) ? cfg.effort : (levels.includes('medium') ? 'medium' : levels[0]);
}

(async () => {
  const saved = await chrome.storage.local.get(['backend', 'model_claude', 'model_codex', 'effort', 'modelList', I18N.STORAGE_KEY]);
  const { modelList: m, [I18N.STORAGE_KEY]: lang, ...rest } = saved;
  if (lang) I18N.setLanguage(lang);
  Object.assign(cfg, Object.fromEntries(Object.entries(rest).filter(([, v]) => v != null)));
  // 面板里 🔄 探测到的最新模型列表（存 chrome.storage，弹窗跟着用）
  if (m && Array.isArray(m.claude) && m.claude.length) MODELS.claude = m.claude;
  if (m && Array.isArray(m.codex) && m.codex.length) MODELS.codex = m.codex;
  if (m && m.efforts) modelEfforts = { codex: {}, ...m.efforts };
  $('backend').value = cfg.backend;
  applyLanguage();

  $('backend').addEventListener('change', () => { cfg.backend = $('backend').value; fillModels(); chrome.storage.local.set({ backend: cfg.backend }); checkHealth(); });
  $('model').addEventListener('change', () => {
    if (cfg.backend === 'codex') { cfg.model_codex = $('model').value; chrome.storage.local.set({ model_codex: cfg.model_codex }); }
    else { cfg.model_claude = $('model').value; chrome.storage.local.set({ model_claude: cfg.model_claude }); }
    fillEfforts();
  });
  $('effort').addEventListener('change', () => { cfg.effort = $('effort').value; chrome.storage.local.set({ effort: cfg.effort }); });
  $('language').addEventListener('change', () => {
    I18N.setLanguage($('language').value);
    chrome.storage.local.set({ [I18N.STORAGE_KEY]: I18N.language });
    applyLanguage();
  });

  $('refresh').addEventListener('click', checkHealth);
  checkHealth();
})();

function renderHealth(h) {
  if (h.pending) { $('status').textContent = t('正在检查连接…'); $('status').className = 'status'; return; }
  if (h.exception) { $('status').textContent = t('无法连接扩展后台，请重新加载扩展。'); $('status').className = 'status bad'; return; }
  const name = cfg.backend === 'codex' ? 'Codex' : 'Claude';
  $('status').textContent = h.ok ? t('{0} 已就绪 · 桥 v{1}', name, h.version) : (I18N.known(h.error) || t('连接失败，请重试'));
  $('status').className = 'status ' + (h.ok ? 'ok' : 'bad');
  $('install-tip').classList.toggle('hidden', !!(h.ok || h.version));
}

let healthSeq = 0;
async function checkHealth() {
  const seq = ++healthSeq;
  lastHealth = { pending: true };
  renderHealth(lastHealth);
  $('install-tip').classList.add('hidden');
  try {
    const h = await chrome.runtime.sendMessage({ type: 'health', backend: cfg.backend, lang: I18N.language });
    if (seq !== healthSeq) return;
    lastHealth = h || { ok: false };
  } catch {
    if (seq !== healthSeq) return;
    lastHealth = { exception: true };
  }
  renderHealth(lastHealth);
}
