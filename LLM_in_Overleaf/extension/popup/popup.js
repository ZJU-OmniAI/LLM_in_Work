// 弹窗：显示本机桥状态 + 快捷改设置（与面板共用 chrome.storage，同步生效）
const MODELS = { claude: [['sonnet', 'Sonnet'], ['opus', 'Opus'], ['haiku', 'Haiku']], codex: [['(default)', '使用 Codex 配置']] };
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

const $ = (id) => document.getElementById(id);
const cfg = { backend: 'claude', model_claude: 'sonnet', model_codex: '(default)', effort: 'medium' };

// 开启入口不依赖本机 CLI 的健康检查：先让用户能进入面板。
$('open-panel').addEventListener('click', async () => {
  $('open-panel').disabled = true;
  $('page-status').textContent = '正在打开助手…';
  try {
    const result = await chrome.runtime.sendMessage({ type: 'open_active_panel' });
    $('page-status').textContent = result?.ok ? '助手已打开。可以在页面中继续操作。' : (result?.error || '页面没有响应，请刷新 Overleaf 后重试。');
    $('page-status').classList.toggle('error', !result?.ok);
  } catch {
    $('page-status').textContent = '无法连接扩展后台，请在扩展管理页重新加载，再刷新 Overleaf。';
    $('page-status').classList.add('error');
  } finally {
    $('open-panel').disabled = false;
  }
});

function fillModels() {
  const list = [...(MODELS[cfg.backend] || MODELS.claude)];
  const want = cfg.backend === 'codex' ? cfg.model_codex : cfg.model_claude;
  if (want && !list.some(([v]) => v === want)) list.push([want, want + '（已保存）']);
  $('model').replaceChildren(...list.map(([v, label]) => new Option(label, v)));
  $('model').value = list.some(([v]) => v === want) ? want : list[0][0];
}

(async () => {
  const saved = await chrome.storage.local.get(['backend', 'model_claude', 'model_codex', 'effort', 'modelList']);
  const { modelList: m, ...rest } = saved;
  Object.assign(cfg, Object.fromEntries(Object.entries(rest).filter(([, v]) => v != null)));
  // 面板里 🔄 探测到的最新模型列表（存 chrome.storage，弹窗跟着用）
  if (m && Array.isArray(m.claude) && m.claude.length) MODELS.claude = m.claude;
  if (m && Array.isArray(m.codex) && m.codex.length) MODELS.codex = m.codex;
  $('backend').value = cfg.backend;
  $('effort').innerHTML = EFFORTS.map((e) => `<option>${e}</option>`).join('');
  $('effort').value = cfg.effort;
  fillModels();

  $('backend').addEventListener('change', () => { cfg.backend = $('backend').value; fillModels(); chrome.storage.local.set({ backend: cfg.backend }); checkHealth(); });
  $('model').addEventListener('change', () => {
    if (cfg.backend === 'codex') { cfg.model_codex = $('model').value; chrome.storage.local.set({ model_codex: cfg.model_codex }); }
    else { cfg.model_claude = $('model').value; chrome.storage.local.set({ model_claude: cfg.model_claude }); }
  });
  $('effort').addEventListener('change', () => { cfg.effort = $('effort').value; chrome.storage.local.set({ effort: cfg.effort }); });

  $('refresh').addEventListener('click', checkHealth);
  checkHealth();
})();

let healthSeq = 0;
async function checkHealth() {
  const seq = ++healthSeq;
  $('status').textContent = '正在检查连接…';
  $('status').className = 'status';
  $('install-tip').classList.add('hidden');
  try {
    const h = await chrome.runtime.sendMessage({ type: 'health', backend: cfg.backend });
    if (seq !== healthSeq) return;
    $('status').textContent = h?.ok ? `${cfg.backend === 'codex' ? 'Codex' : 'Claude'} 已就绪 · 桥 v${h.version}` : (h?.error || '连接失败，请重试');
    $('status').className = 'status ' + (h?.ok ? 'ok' : 'bad');
    if (!h?.ok && !h?.version) $('install-tip').classList.remove('hidden');
  } catch {
    if (seq !== healthSeq) return;
    $('status').textContent = '无法连接扩展后台，请重新加载扩展。';
    $('status').className = 'status bad';
  }
}
