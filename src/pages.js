// ============ 公共样式 ============
const commonStyle = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    background: #f7f7f5;
    color: #37352f;
    min-height: 100vh;
  }
  button {
    font-family: inherit;
    cursor: pointer;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    transition: background 0.15s, opacity 0.15s;
  }
  input, textarea {
    font-family: inherit;
    font-size: 14px;
    border: 1px solid #e0e0dc;
    border-radius: 6px;
    padding: 9px 12px;
    outline: none;
    background: #fff;
    color: #37352f;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  input:focus, textarea:focus {
    border-color: #2383e2;
    box-shadow: 0 0 0 2px rgba(35,131,226,0.15);
  }
`;

// ============ 登录页 ============
export function loginPage(siteName) {
  const name = siteName || '待办清单';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>登录 - ${name}</title>

<style>
${commonStyle}
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .card {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    padding: 40px 36px;
    width: 100%;
    max-width: 380px;
  }
  h1 {
    font-size: 22px;
    text-align: center;
    margin-bottom: 6px;
    font-weight: 600;
  }
  .subtitle {
    text-align: center;
    color: #9b9a97;
    font-size: 13px;
    margin-bottom: 28px;
  }
  .field { margin-bottom: 16px; }
  .field label {
    display: block;
    font-size: 13px;
    color: #6b6b68;
    margin-bottom: 6px;
    font-weight: 500;
  }
  .field input { width: 100%; }
  .btn-primary {
    width: 100%;
    background: #2383e2;
    color: #fff;
    padding: 11px;
    font-size: 15px;
    font-weight: 500;
    margin-top: 8px;
  }
  .btn-primary:hover { background: #1a6fc4; }
  .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
  .error {
    color: #eb5757;
    font-size: 13px;
    text-align: center;
    margin-top: 14px;
    min-height: 18px;
  }
  .hint {
    text-align: center;
    font-size: 12px;
    color: #b0b0ad;
    margin-top: 20px;
    line-height: 1.6;
  }
</style>
</head>
<body>
  <div class="card">
    <h1>${name}</h1>
    <div class="subtitle">Cloudnexus Order System</div>

    <form id="loginForm">
      <div class="field">
        <label>用户名</label>
        <input type="text" id="username" autocomplete="username" placeholder="请输入用户名" required>
      </div>
      <div class="field">
        <label>密码</label>
        <input type="password" id="password" autocomplete="current-password" placeholder="请输入密码" required>
      </div>
      <button type="submit" class="btn-primary" id="submitBtn">登 录</button>
      <div class="error" id="error"></div>
    </form>
    <div class="hint">忘记密码,请联系管理员重置</div>
  </div>

<script>
  const form = document.getElementById('loginForm');
  const errEl = document.getElementById('error');
  const btn = document.getElementById('submitBtn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = '登录中...';
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('username').value.trim(),
          password: document.getElementById('password').value,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        errEl.textContent = data.error || '登录失败';
        btn.disabled = false;
        btn.textContent = '登 录';
        return;
      }
      location.href = '/todos';
    } catch (err) {
      errEl.textContent = '网络错误，请重试';
      btn.disabled = false;
      btn.textContent = '登 录';
    }
  });
</script>
</body>
</html>`;
}

// ============ 待办事件页 ============
export function todoPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>我的待办 - 待办清单</title>
<style>
${commonStyle}
  .topbar {
    background: #fff;
    border-bottom: 1px solid #ebebe8;
    padding: 12px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .topbar .brand {
    font-size: 16px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .topbar .user-area {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: #6b6b68;
  }
  .btn-ghost {
    background: transparent;
    color: #6b6b68;
    padding: 6px 12px;
    font-size: 13px;
  }
  .btn-ghost:hover { background: #f1f1ef; }
  .container {
    max-width: 720px;
    margin: 0 auto;
    padding: 28px 20px 80px;
  }
  .add-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 24px;
  }
  .add-row input {
    flex: 1 1 140px;
    min-width: 0;
    padding: 12px 14px;
    font-size: 15px;
  }
  /* 订单文件链接输入框：占更宽一些 */
  .add-row input.url-input { flex: 2 1 240px; }
  .customer-select {
    padding: 12px 14px;
    font-size: 15px;
    border: 1px solid #e0e0dc;
    border-radius: 6px;
    background: #fff;
    color: #37352f;
    outline: none;
    max-width: 180px;
    cursor: pointer;
  }
  .customer-select:focus { border-color: #2383e2; }
  .due-input {
    padding: 12px 10px;
    font-size: 14px;
    border: 1px solid #e0e0dc;
    border-radius: 6px;
    background: #fff;
    color: #37352f;
    outline: none;
    max-width: 150px;
  }
  .due-input:focus { border-color: #2383e2; }
  /* 日期框：浏览器原生的空值提示（跟随语言，如 yyyy/mm/日）无法直接改文字。
     空值且未聚焦时：① 把原生提示文字设为透明；② 再用一块与输入框同色的自绘提示「yyyy/mm/dd」盖住它。
     有值或聚焦时露出原生日期控件；Firefox 自己会显示 placeholder，不用自绘。 */
  .date-field { position: relative; display: flex; }
  .add-row .date-field { flex: 1 1 140px; min-width: 0; max-width: 150px; }
  .date-field input[type="date"] { width: 100%; }
  .date-ph {
    position: absolute;
    left: 1px;
    right: 30px;
    top: 1px;
    bottom: 1px;
    display: flex;
    align-items: center;
    background: #fff;
    border-radius: 5px;
    font-size: 14px;
    color: #9b9a97;
    pointer-events: none;
  }
  .add-row .date-ph { padding-left: 10px; }
  .modal .date-ph { padding-left: 12px; }
  .date-field input[type="date"]:not(.has-value):not(:focus),
  .date-field input[type="date"]:not(.has-value):not(:focus):hover,
  .date-field input[type="date"]:not(.has-value):not(:focus):active { color: transparent; }
  .date-field input[type="date"]:not(.has-value):not(:focus)::-webkit-datetime-edit,
  .date-field input[type="date"]:not(.has-value):not(:focus):hover::-webkit-datetime-edit { color: transparent; }
  .date-field input[type="date"].has-value + .date-ph,
  .date-field input[type="date"]:focus + .date-ph { display: none; }
  @-moz-document url-prefix() { .date-ph { display: none; } }
  .amount-input {
    padding: 12px 10px;
    font-size: 14px;
    border: 1px solid #e0e0dc;
    border-radius: 6px;
    background: #fff;
    color: #37352f;
    outline: none;
    max-width: 110px;
  }
  .amount-input:focus { border-color: #2383e2; }
  .todo-due {
    font-size: 11px;
    background: #fdf0e3;
    color: #d9730d;
    padding: 2px 8px;
    border-radius: 10px;
    white-space: nowrap;
    flex-shrink: 0;
    font-weight: 500;
  }
  /* 交期颜色（三种状态一致）：已到期/逾期=红，2 周内=黄，2 周以上=绿 */
  .todo-due.due-overdue { background: #fdeceb; color: #eb5757; }
  .todo-due.due-soon { background: #fdf0e3; color: #d9730d; }
  .todo-due.due-far { background: #e6f4ee; color: #0f7b6c; }
  /* 可点击修改的交期 / 金额（管理员 + 待确认） */
  .todo-due.editable, .todo-amount.editable {
    cursor: pointer;
    box-shadow: inset 0 0 0 1px rgba(0,0,0,0.14);
  }
  .todo-due.editable:hover, .todo-amount.editable:hover {
    box-shadow: inset 0 0 0 1px rgba(35,131,226,0.65);
  }
  /* 金额：灰色（中性色，避免与交期的绿/黄/红混淆） */
  .todo-amount {
    font-size: 11px;
    background: #f1f1ef;
    color: #6b6b68;
    padding: 2px 8px;
    border-radius: 10px;
    white-space: nowrap;
    flex-shrink: 0;
    font-weight: 500;
  }
  .todo-customer {

    font-size: 11px;
    background: #e7f0fb;
    color: #2383e2;
    padding: 2px 8px;
    border-radius: 10px;
    white-space: nowrap;
    flex-shrink: 1;
    min-width: 40px;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
  }

  /* 待办卡片：生产方标签（灰色中性标签，避免与交期的绿/黄/红混淆） */
  .todo-producer {
    font-size: 11px;
    background: #f1f1ef;
    color: #6b6b68;
    padding: 2px 8px;
    border-radius: 10px;
    white-space: nowrap;
    flex-shrink: 0;
    font-weight: 500;
  }
  /* 管理员 / 超级观察者：生产方标签带采购文件链接时可点击 */
  a.todo-producer-link { text-decoration: none; }
  a.todo-producer-link:hover { color: #2383e2; text-decoration: underline; }
  /* 一个待办固定一行：宽度不足时按优先级隐藏次要信息，保证 PO#（标题）始终可见。
     注意：这些 @container 规则必须放在本页样式的最末尾（见文件底部），
     否则会被后面同优先级的 .todo-* 规则覆盖。 */
  /* 成员管理：可观察生产方下拉 */
  select.watch-add-select {
    font-family: inherit;
    border: 1px solid #e0e0dc;
    border-radius: 6px;
    background: #fff;
    color: #37352f;
    outline: none;
    min-width: 0;
  }

  /* 生产方下拉（仅管理员）：待确认阶段即可直接指定 */
  .producer-select {
    font-size: 11px;
    padding: 3px 6px;
    border-radius: 6px;
    border: 1px solid #e0e0dc;
    background: #fff;
    color: #0f7b6c;
    font-family: inherit;
    outline: none;
    max-width: 150px;
    flex-shrink: 0;
  }
  .producer-select.unset { color: #d9730d; border-color: #f0d6b8; background: #fffaf3; }
  /* 未指定生产方时的提示（详情区内） */
  .producer-hint {
    font-size: 12px;
    color: #d9730d;
    background: #fdf0e3;
    border-radius: 6px;
    padding: 8px 10px;
    margin-bottom: 10px;
    line-height: 1.6;
  }

  .btn-add {
    background: #2383e2;
    color: #fff;
    padding: 0 22px;
    font-size: 15px;
    font-weight: 500;
    white-space: nowrap;
  }
  .btn-add:hover { background: #1a6fc4; }
  .section-title {
    font-size: 12px;
    font-weight: 600;
    color: #9b9a97;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 20px 0 10px;
  }
  .todo-item {
    background: #fff;
    border: 1px solid #ebebe8;
    border-radius: 8px;
    margin-bottom: 8px;
    overflow: hidden;
    transition: box-shadow 0.15s;
  }
  .todo-item:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
  .todo-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 16px;
    cursor: pointer;
    user-select: none;
    container-type: inline-size;
  }
  .todo-check {
    width: 18px;
    height: 18px;
    border: 1.5px solid #c9c9c5;
    border-radius: 4px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: #fff;
    transition: all 0.15s;
  }
  .todo-check.checked {
    background: #2383e2;
    border-color: #2383e2;
  }
  .todo-check.readonly {
    cursor: not-allowed;
    opacity: 0.7;
  }
  .todo-check:not(.readonly) { cursor: pointer; }
  .todo-check:not(.readonly):hover { border-color: #2383e2; }
  /* 状态徽章 */
  .status-badge {
    font-size: 11px;
    padding: 3px 10px;
    border-radius: 10px;
    white-space: nowrap;
    flex-shrink: 0;
    font-weight: 500;
  }
  .status-badge.pending { background: #fdf0e3; color: #d9730d; }
  .status-badge.doing { background: #e7f0fb; color: #2383e2; }
  .status-badge.done { background: #e6f4ee; color: #0f7b6c; }
  /* 状态下拉（管理员） */
  .status-select {
    font-size: 12px;
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid #e0e0dc;
    background: #fff;
    color: #37352f;
    cursor: pointer;
    flex-shrink: 0;
    outline: none;
  }
  .status-select:focus { border-color: #2383e2; }
  .todo-title {
    flex: 1 1 auto;
    min-width: 6em;
    font-size: 15px;
    line-height: 1.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .todo-title.done {
    text-decoration: line-through;
    color: #b0b0ad;
  }
  /* PO# 链接（该待办有「订单文件链接」时） */
  .todo-title-link { color: inherit; text-decoration: none; }
  .todo-title-link:hover { color: #2383e2; text-decoration: underline; }
  .todo-date {
    font-size: 12px;
    color: #b0b0ad;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .todo-owner {
    font-size: 11px;
    background: #f1f1ef;
    color: #6b6b68;
    padding: 2px 8px;
    border-radius: 10px;
    white-space: nowrap;
    flex-shrink: 1;
    min-width: 40px;
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .note-list { margin-bottom: 12px; }
  .note-empty {
    font-size: 13px;
    color: #c9c9c5;
    padding: 6px 0;
  }
  .note-item {
    background: #fafaf9;
    border-radius: 6px;
    padding: 8px 12px;
    margin-bottom: 8px;
  }
  .note-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .note-author {
    font-size: 12px;
    font-weight: 600;
    color: #37352f;
  }
  .note-time {
    font-size: 11px;
    color: #b0b0ad;
  }
  .note-text {
    font-size: 14px;
    line-height: 1.6;
    color: #37352f;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .note-link {
    display: inline-block;
    font-size: 14px;
    color: #2383e2;
    text-decoration: none;
    background: #e7f0fb;
    padding: 6px 12px;
    border-radius: 6px;
    font-weight: 500;
    transition: background 0.15s;
  }
  .note-link:hover { background: #d6e7fa; text-decoration: underline; }

  .note-add { margin-top: 4px; }
  .note-add .note-input { min-height: 56px; }
  .body-actions { gap: 8px; }
  .body-actions .save-status { margin-right: auto; }
  .todo-arrow {
    color: #c9c9c5;
    font-size: 12px;
    transition: transform 0.2s;
    flex-shrink: 0;
  }
  .todo-item.open .todo-arrow { transform: rotate(90deg); }
  .todo-body {
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.25s ease;
    border-top: 1px solid transparent;
  }
  .todo-item.open .todo-body {
    max-height: 5000px;
    border-top-color: #f1f1ef;
  }

  .todo-body-inner {
    padding: 14px 16px 16px 46px;
  }
  .note-label {
    font-size: 12px;
    color: #9b9a97;
    margin-bottom: 6px;
    font-weight: 500;
  }
  .note-input {
    width: 100%;
    min-height: 70px;
    resize: vertical;
    line-height: 1.6;
    font-size: 14px;
  }
  .body-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 10px;
  }
  .save-status {
    font-size: 12px;
    color: #9b9a97;
  }
  .btn-danger {
    background: transparent;
    color: #eb5757;
    padding: 6px 12px;
    font-size: 13px;
  }
  .btn-danger:hover { background: #fdecec; }
  .empty {
    text-align: center;
    color: #b0b0ad;
    padding: 60px 20px;
    font-size: 14px;
  }
  .empty .icon { font-size: 40px; margin-bottom: 12px; }
  /* 「已完成」加载更多按钮 */
  .load-more-row {
    display: flex;
    justify-content: center;
    padding: 2px 0 6px;
  }
  .load-more-btn {
    background: #fff;
    color: #37352f;
    border: 1px solid #e0e0dc;
    padding: 7px 16px;
    font-size: 13px;
    border-radius: 6px;
  }
  .load-more-btn:hover { background: #f7f7f5; }
  /* 弹窗 */
  .modal-mask {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(15,15,15,0.4);
    z-index: 100;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .modal-mask.show { display: flex; }
  .modal {
    background: #fff;
    border-radius: 12px;
    width: 100%;
    max-width: 460px;
    max-height: 85vh;
    overflow-y: auto;
    padding: 24px;
  }
  .modal h2 {
    font-size: 18px;
    margin-bottom: 18px;
    font-weight: 600;
  }
  .modal .field { margin-bottom: 14px; }
  .modal .field label {
    display: block;
    font-size: 13px;
    color: #6b6b68;
    margin-bottom: 6px;
    font-weight: 500;
  }
  .modal .field input { width: 100%; }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 20px;
  }
  .btn-secondary {
    background: #f1f1ef;
    color: #37352f;
    padding: 9px 18px;
  }
  .btn-secondary:hover { background: #e8e8e5; }
  .btn-primary-sm {
    background: #2383e2;
    color: #fff;
    padding: 9px 18px;
  }
  .btn-primary-sm:hover { background: #1a6fc4; }
  .user-list { margin-top: 6px; display: flex; flex-direction: column; gap: 10px; }
  /* 每个成员一个区块：底色加深 + 区块间距，避免几个成员看成一团 */
  .user-block {
    border: 1px solid #dcdcd8;
    border-radius: 8px;
    background: #e8e8e5;
    overflow: hidden;
  }
  .user-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    font-size: 14px;
  }
  .user-row .role {
    font-size: 11px;
    background: #fff;
    color: #6b6b68;
    padding: 2px 8px;
    border-radius: 10px;
    margin-left: 8px;
  }
  .user-row .role.admin { background: #e7f0fb; color: #2383e2; }
  .user-row .role.viewer { background: #fdf0e3; color: #d9730d; }
  .user-row .role.restricted { background: #e6f4ee; color: #0f7b6c; }
  .user-row .role.superviewer { background: #f3e8ff; color: #8250df; }
  .user-row-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  /* 加深底色上的按钮改用白底，更清楚 */
  .user-row .btn-secondary-sm { background: #fff; border: 1px solid #e0e0dc; }
  .user-row .btn-secondary-sm:hover { background: #f7f7f5; }
  /* 成员备注（成员管理列表内）：直接点文字改，不显示「备注」字样与按钮 */
  .remark-row {
    margin-top: 4px;
    font-size: 12px;
    color: #6b6b68;
    max-width: 100%;
    word-break: break-word;
  }
  /* 加深底色上「未填写」提示也要看得清 */
  .user-block .desc-empty { color: #8a8a85; }
  .btn-secondary-sm {
    background: #f1f1ef;
    color: #37352f;
    padding: 6px 12px;
    font-size: 13px;
  }
  .btn-secondary-sm:hover { background: #e8e8e5; }

  /* 成员区块内的「客户列表 / 可观察生产方」面板：白底，与成员区块底色区分开 */
  .customer-manage {
    border-top: 1px solid #e0e0dc;
    padding: 10px 12px;
    background: #fff;
  }
  .customer-manage-title {
    font-size: 12px;
    color: #9b9a97;
    font-weight: 500;
    margin-bottom: 8px;
  }
  .customer-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
    min-height: 22px;
  }
  .customer-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    background: #e7f0fb;
    color: #2383e2;
    padding: 3px 8px;
    border-radius: 10px;
  }
  .customer-chip-del {
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    color: #2383e2;
    opacity: 0.6;
  }
  .customer-chip-del:hover { opacity: 1; }
  .customer-empty { font-size: 12px; color: #c9c9c5; }
  .customer-add-row { display: flex; gap: 8px; }
  .customer-add-input {
    flex: 1;
    padding: 6px 10px;
    font-size: 13px;
  }
  .customer-add-row .btn-primary-sm { padding: 6px 14px; font-size: 13px; }
  .customer-add-row select {
    flex: 1;
    min-width: 0;
    padding: 6px 10px;
    font-size: 13px;
  }

  /* 生产方管理 */
  .modal .field textarea { width: 100%; }
  .producer-list { margin-top: 6px; }
  .producer-row-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .producer-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid #ebebe8;
    border-radius: 6px;
    margin-bottom: 8px;
    font-size: 14px;
  }
  .producer-short {
    font-weight: 600;
    color: #37352f;
    word-break: break-word;
  }
  .producer-desc {
    font-size: 13px;
    color: #6b6b68;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    margin-top: 4px;
  }
  /* 可点击编辑的文字（成员备注 / 生产方说明 / 客户说明） */
  .desc-editable { cursor: pointer; border-radius: 4px; }
  .desc-editable:hover { color: #2383e2; text-decoration: underline; }
  .desc-empty { color: #c9c9c5; }
  .desc-editable:hover .desc-empty { color: #2383e2; text-decoration: underline; }
  .producer-row .btn-danger { padding: 4px 10px; font-size: 13px; }
  .producer-empty { font-size: 13px; color: #c9c9c5; padding: 6px 0; }

  .msg { font-size: 13px; margin-top: 10px; min-height: 18px; }

  .msg.ok { color: #0f7b6c; }
  .msg.err { color: #eb5757; }
  .divider { height: 1px; background: #ebebe8; margin: 20px 0; }
  /* 一个待办固定一行：宽度不足时按优先级隐藏次要信息，保证 PO#（标题）与生产方始终可见。
     注：@container 规则必须放在本页样式的最末尾，否则会被上面同优先级的 .todo-* 规则覆盖 */
  @container (max-width: 660px) {
    .todo-date { display: none; }
  }
  @container (max-width: 605px) {
    .todo-owner { display: none; }
  }
  @container (max-width: 555px) {
    .todo-customer { display: none; }
  }
  @container (max-width: 500px) {
    .todo-amount { display: none; }
  }
  @container (max-width: 450px) {
    .todo-due { display: none; }
  }
  /* 更窄时把 PO# 的下限略微放宽，优先保留生产方标签与展开箭头 */
  @container (max-width: 420px) {
    .todo-title { min-width: 4.5em; }
  }

</style>
</head>
<body>
  <div class="topbar">
    <div class="brand"><span id="siteName">待办清单</span></div>
    <div class="user-area">
      <span id="currentUser"></span>
      <button class="btn-ghost" id="btnChangePwd">修改密码</button>
      <button class="btn-ghost" id="btnSettings" style="display:none">系统设置</button>
      <button class="btn-ghost" id="btnManageUsers" style="display:none">成员管理</button>
      <button class="btn-ghost" id="btnProducers" style="display:none">生产方管理</button>
      <button class="btn-ghost" id="btnCustomers" style="display:none">客户管理</button>
      <button class="btn-ghost" id="btnLogout">退出</button>
    </div>
  </div>


  <div class="container">
    <div class="add-row">
      <select id="newCustomer" class="customer-select">
        <option value="">请选择客户</option>
      </select>
      <input type="text" id="newTitle" placeholder="输入订单号..." maxlength="200">
      <div class="date-field">
        <input type="date" id="newDueDate" class="due-input" title="交期（yyyy/mm/dd）" placeholder="yyyy/mm/dd">
        <span class="date-ph">yyyy/mm/dd</span>
      </div>
      <input type="number" id="newAmount" class="amount-input" placeholder="金额" min="0" step="0.01">
      <input type="url" id="newOrderUrl" class="url-input" placeholder="订单文件链接 http://…" maxlength="500">
      <input type="url" id="newPurchaseUrl" class="url-input" placeholder="采购文件链接 http://…" maxlength="500">
      <button class="btn-add" id="btnAdd">添加</button>
    </div>
    <div id="listArea"></div>
  </div>



  <!-- 修改密码弹窗 -->
  <div class="modal-mask" id="pwdModal">
    <div class="modal">
      <h2>修改密码</h2>
      <div class="field">
        <label>原密码</label>
        <input type="password" id="oldPwd" placeholder="请输入原密码">
      </div>
      <div class="field">
        <label>新密码</label>
        <input type="password" id="newPwd" placeholder="请输入新密码">
      </div>
      <div class="msg" id="pwdMsg"></div>
      <div class="modal-actions">
        <button class="btn-secondary" data-close="pwdModal">取消</button>
        <button class="btn-primary-sm" id="btnSavePwd">保存</button>
      </div>
    </div>
  </div>

  <!-- 成员管理弹窗 -->
  <div class="modal-mask" id="usersModal">
    <div class="modal">
      <h2>成员管理</h2>
      <div class="field">
        <label>新增成员</label>
        <input type="text" id="newUserName" placeholder="用户名" style="margin-bottom:8px">
        <input type="password" id="newUserPwd" placeholder="密码" style="margin-bottom:8px">
        <select id="newUserRole" style="width:100%;padding:9px 12px;border:1px solid #e0e0dc;border-radius:6px;font-size:14px;background:#fff;color:#37352f;outline:none">
          <option value="editor">业务员用户（可添加订单）</option>
          <option value="viewer">观察用户（仅查看全部订单）</option>
          <option value="restricted">受限观察用户（仅查看授权生产方的订单）</option>
          <option value="superviewer">超级观察者（拥有管理员的功能，但没有系统设置/成员/生产方/客户管理）</option>
        </select>
      </div>
      <button class="btn-primary-sm" id="btnAddUser" style="width:100%">添加成员</button>
      <div class="msg" id="userMsg"></div>
      <div class="divider"></div>
      <div class="section-title" style="margin-top:0">成员列表</div>
      <div class="user-list" id="userList"></div>
      <div class="modal-actions">
        <button class="btn-secondary" data-close="usersModal">关闭</button>
      </div>
    </div>
  </div>

  <!-- 指定生产方弹窗（管理员把待办改为「进行中」时使用） -->
  <div class="modal-mask" id="producerPickModal">
    <div class="modal">
      <h2>指定生产方</h2>
      <div class="field">
        <label>生产方（来自「生产方管理」）</label>
        <select id="pickProducerSelect" style="width:100%;padding:9px 12px;border:1px solid #e0e0dc;border-radius:6px;font-size:14px;background:#fff;color:#37352f;outline:none">
          <option value="">请选择生产方</option>
        </select>
      </div>
      <div class="msg" id="pickProducerMsg"></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="btnCancelPickProducer">取消</button>
        <button class="btn-primary-sm" id="btnConfirmPickProducer">确定并改为进行中</button>
      </div>
    </div>
  </div>

  <!-- 修改 PO# / 交期 / 金额弹窗（管理员，仅「待确认」的待办） -->
  <div class="modal-mask" id="dueAmountModal">
    <div class="modal">
      <h2>修改 PO# / 交期 / 金额 / 文件链接</h2>
      <div class="field">
        <label>PO#（主题）</label>
        <input type="text" id="editTitle" maxlength="100" placeholder="请输入 PO# / 主题">
      </div>
      <div class="field">
        <label>交期</label>
        <div class="date-field">
          <input type="date" id="editDueDate" title="交期（yyyy/mm/dd）" placeholder="yyyy/mm/dd">
          <span class="date-ph">yyyy/mm/dd</span>
        </div>
      </div>
      <div class="field">
        <label>金额</label>
        <input type="number" id="editAmount" min="0" step="0.01" placeholder="请输入金额">
      </div>
      <div class="field">
        <label>订单文件链接</label>
        <input type="url" id="editOrderUrl" maxlength="500" placeholder="http://…（留空则清除链接）">
      </div>
      <div class="field">
        <label>采购文件链接</label>
        <input type="url" id="editPurchaseUrl" maxlength="500" placeholder="http://…（留空则清除链接）">
      </div>
      <div class="msg" id="dueAmountMsg"></div>
      <div class="modal-actions">
        <button class="btn-secondary" data-close="dueAmountModal">取消</button>
        <button class="btn-primary-sm" id="btnSaveDueAmount">保存</button>
      </div>
    </div>
  </div>

  <!-- 生产方管理弹窗 -->
  <div class="modal-mask" id="producersModal">
    <div class="modal">
      <h2>生产方管理</h2>
      <div class="field">
        <label>用户名</label>
        <input type="text" id="newProducerShort" placeholder="请输入用户名（同时作为登录名）" maxlength="30">
      </div>
      <div class="field">
        <label>密码</label>
        <input type="password" id="newProducerPwd" placeholder="请输入登录密码（可用下方「重置密码」修改）" maxlength="50">
      </div>
      <div class="field">
        <label>说明</label>
        <textarea id="newProducerDesc" placeholder="请输入说明" rows="3" maxlength="200"></textarea>
      </div>
      <button class="btn-primary-sm" id="btnAddProducer" style="width:100%">添加生产方（同时创建登录账号）</button>
      <div class="msg" id="producerMsg"></div>
      <div class="divider"></div>
      <div class="section-title" style="margin-top:0">生产方列表</div>
      <div class="producer-list" id="producerList"></div>
      <div class="modal-actions">
        <button class="btn-secondary" data-close="producersModal">关闭</button>
      </div>
    </div>
  </div>

  <!-- 客户管理弹窗（全局客户列表；客户可用该用户名/密码登录，只看本客户的待办） -->
  <div class="modal-mask" id="customersModal">
    <div class="modal">
      <h2>客户管理</h2>
      <div class="field">
        <label>用户名</label>
        <input type="text" id="newCustomerName" placeholder="请输入用户名（同时作为客户名称）" maxlength="60">
      </div>
      <div class="field">
        <label>密码</label>
        <input type="password" id="newCustomerPwd" placeholder="请输入登录密码（可用下方「重置密码」修改）" maxlength="50">
      </div>
      <div class="field">
        <label>说明</label>
        <textarea id="newCustomerDesc" placeholder="请输入说明" rows="3" maxlength="200"></textarea>
      </div>
      <button class="btn-primary-sm" id="btnAddCustomer" style="width:100%">添加客户（同时创建登录账号）</button>
      <div class="msg" id="customerListMsg"></div>
      <div class="divider"></div>
      <div class="section-title" style="margin-top:0">客户列表</div>
      <div class="producer-list" id="customerListRows"></div>
      <div class="modal-actions">
        <button class="btn-secondary" data-close="customersModal">关闭</button>
      </div>
    </div>
  </div>

  <!-- 系统设置弹窗 -->
  <div class="modal-mask" id="settingsModal">
    <div class="modal">
      <h2>系统设置</h2>
      <div class="field">
        <label>网站名称</label>
        <input type="text" id="siteNameInput" placeholder="请输入网站名称" maxlength="30">
      </div>
      <div class="msg" id="settingsMsg"></div>
      <div class="modal-actions">
        <button class="btn-secondary" data-close="settingsModal">取消</button>
        <button class="btn-primary-sm" id="btnSaveSettings">保存</button>
      </div>
    </div>
  </div>

  <!-- 重置密码弹窗 -->
  <div class="modal-mask" id="resetPwdModal">

    <div class="modal">
      <h2>重置密码</h2>
      <div class="field">
        <label>成员</label>
        <input type="text" id="resetPwdUser" readonly style="background:#f7f7f5">
      </div>
      <div class="field">
        <label>新密码</label>
        <input type="password" id="resetPwdValue" placeholder="请输入新密码">
      </div>
      <div class="msg" id="resetPwdMsg"></div>
      <div class="modal-actions">
        <button class="btn-secondary" data-close="resetPwdModal">取消</button>
        <button class="btn-primary-sm" id="btnSaveResetPwd">确定重置</button>
      </div>
    </div>
  </div>

  <!-- 编辑弹窗（成员备注 / 生产方说明 / 客户说明 共用） -->
  <div class="modal-mask" id="remarkModal">
    <div class="modal">
      <h2 id="remarkTitle">备注</h2>
      <div class="field">
        <label id="remarkUserLabel">成员</label>
        <input type="text" id="remarkUser" readonly style="background:#f7f7f5">
      </div>
      <div class="field">
        <label id="remarkFieldLabel">备注</label>
        <textarea id="remarkText" placeholder="请输入备注（留空则清除备注）" rows="3" maxlength="200"></textarea>
      </div>
      <div class="msg" id="remarkMsg"></div>
      <div class="modal-actions">
        <button class="btn-secondary" data-close="remarkModal">取消</button>
        <button class="btn-primary-sm" id="btnSaveRemark">保存</button>
      </div>
    </div>
  </div>

<script>
  let currentUser = null;

  let todos = [];
  let isViewer = false;
  let isRestricted = false; // 受限观察用户（仅看授权生产方的待办）
  let isProducer = false;   // 生产方账号（仅看指定给自己的待办）
  let isCustomer = false;   // 客户账号（仅看本客户的待办）
  let isObserver = false;   // 观察用户 / 受限观察用户 / 生产方 / 客户（只读）
  let isAdmin = false;
  let isSuperviewer = false; // 超级观察者（拥有管理员的待办功能，但没有管理类功能）
  let isTodoManager = false; // 管理员 / 超级观察者：可管理待办（状态、生产方、删除、编辑）
  let showAllUsers = false; // admin / superviewer / 观察类：显示所有用户的待办
  // 「已完成」折叠显示：默认只渲染 5 条，点「加载更多」每次再多显示 20 条（避免一次渲染太多导致卡顿）
  const DONE_PAGE_STEP = 20;
  let doneVisible = 5;

  // ---------- 工具 ----------
  function fmtDate(iso) {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  function fmtDateTime(iso) {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return y + '-' + m + '-' + day + ' ' + hh + ':' + mm;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '\\u0026amp;', '<': '\\u0026lt;', '>': '\\u0026gt;',
      '"': '\\u0026quot;', "'": '\\u0026#39;'
    }[c]));
  }
  async function api(url, opts) {
    const res = await fetch(url, opts);
    if (res.status === 401) { location.href = '/'; throw new Error('未登录'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '请求失败');
    return data;
  }

  // ---------- 初始化 ----------
  async function init() {
    try {
      currentUser = await api('/api/me');
    } catch (e) { return; }
    isViewer = currentUser.role === 'viewer';
    isRestricted = currentUser.role === 'restricted';
    isProducer = currentUser.role === 'producer';
    isCustomer = currentUser.role === 'customer';
    isObserver = isViewer || isRestricted || isProducer || isCustomer;
    isAdmin = currentUser.role === 'admin';
    isSuperviewer = currentUser.role === 'superviewer';
    isTodoManager = isAdmin || isSuperviewer;
    showAllUsers = isTodoManager || isObserver;
    document.getElementById('currentUser').textContent = currentUser.username;

    if (isAdmin) {
      document.getElementById('btnManageUsers').style.display = '';
      document.getElementById('btnSettings').style.display = '';
      document.getElementById('btnProducers').style.display = '';
      document.getElementById('btnCustomers').style.display = '';
    }
    // 预加载生产方列表：管理员/超级观察者的下拉需要，其他角色也会用它兜底显示待办卡片上的生产方简称
    await ensureProducers();
    // 观察类用户、管理员、超级观察者隐藏添加框（他们不录入待办）
    if (isObserver || isTodoManager) {
      document.querySelector('.add-row').style.display = 'none';
    }

    // 日期框：自绘 yyyy/mm/dd 提示
    bindDateFields();

    await loadSettings();
    await loadCustomers();
    await loadTodos();
  }

  // ---------- 加载站点设置 ----------
  async function loadSettings() {
    try {
      const data = await api('/api/settings');
      const name = (data.settings && data.settings.siteName) || '待办清单';
      document.getElementById('siteName').textContent = name;
      document.title =  name;
    } catch (e) { /* 忽略 */ }
  }



  // ---------- 加载待办 ----------
  async function loadTodos() {
    const data = await api('/api/todos');
    todos = data.todos || [];
    render();
  }

  function statusOf(t) {
    return t.status || (t.done ? 'done' : 'pending');
  }

  // ---------- 日期框（自绘 yyyy/mm/dd 提示，取代浏览器原生的 yyyy/mm/日） ----------
  function syncDateField(el) {
    if (el) el.classList.toggle('has-value', !!el.value);
  }
  function bindDateFields() {
    document.querySelectorAll('.date-field input[type="date"]').forEach(el => {
      ['input', 'change', 'blur'].forEach(ev => el.addEventListener(ev, () => syncDateField(el)));
      syncDateField(el);
    });
  }

  function render() {
    const area = document.getElementById('listArea');
    if (!todos.length) {
      area.innerHTML = '<div class="empty"><div class="icon">🌱</div>还没有待办事项，添加一个吧</div>';
      return;
    }
    const pending = todos.filter(t => statusOf(t) === 'pending');
    const doing = todos.filter(t => statusOf(t) === 'doing');
    const done = todos.filter(t => statusOf(t) === 'done');
    let html = '';
    if (pending.length) {
      html += '<div class="section-title">待确认 (' + pending.length + ')</div>';
      html += pending.map(renderItem).join('');
    }
    if (doing.length) {
      html += '<div class="section-title">进行中 (' + doing.length + ')</div>';
      html += doing.map(renderItem).join('');
    }
    if (done.length) {
      const shownDone = done.slice(0, doneVisible);
      const restDone = done.length - shownDone.length;
      html += '<div class="section-title">已完成 (' + done.length + ')</div>';
      html += shownDone.map(renderItem).join('');
      if (restDone > 0) {
        html += '<div class="load-more-row">' +
          '<button class="load-more-btn" id="btnLoadMoreDone">加载更多（还有 ' + restDone + ' 条）</button>' +
          '</div>';
      }
    }
    area.innerHTML = html;
    bindEvents();
  }

  // 从文本中提取第一个网址（支持 http(s):// 或 www. 开头）
  function extractUrl(text) {
    const s = String(text);
    const m = s.match(/https?:\\/\\/[^\\s]+/i) || s.match(/www\\.[^\\s]+/i);
    return m ? m[0] : null;
  }
  // 规范化网址（补全协议）
  function normalizeUrl(text) {
    const s = String(text).trim();
    if (/^www\\./i.test(s)) return 'https://' + s;
    return s;
  }
  // 渲染备注列表（追加式，不可删除）
  function renderNotes(t) {
    const notes = Array.isArray(t.notes) ? t.notes : [];
    if (!notes.length) {
      return '<div class="note-empty">暂无备注</div>';
    }
    return notes.map(n => {
      const text = String(n.text || '');
      const url = extractUrl(text);
      let body;
      if (url) {
        // 去掉网址后的剩余文字
        const rest = text.replace(url, '').trim();
        const restHtml = rest
          ? \`<div class="note-text">\${esc(rest)}</div>\` : '';
        body = \`\${restHtml}<a class="note-link" href="\${esc(normalizeUrl(url))}" target="_blank" rel="noopener noreferrer">🔗 点击打开附件</a>\`;
      } else {
        body = \`<div class="note-text">\${esc(text)}</div>\`;
      }
      return \`
      <div class="note-item">
        <div class="note-meta">
          <span class="note-author">\${esc(n.author || '')}</span>
          <span class="note-time">\${fmtDateTime(n.createdAt)}</span>
        </div>
        \${body}
      </div>\`;
    }).join('');
  }



  const STATUS_TEXT = { pending: '待确认', doing: '进行中', done: '已完成' };

  // 交期颜色（三种状态一致）：
  //   当前日期 ≥ 交期（已到期/逾期）→ 红
  //   剩余 0~2 周（0 < 剩余天数 ≤ 14）→ 黄
  //   剩余超过 2 周（> 14 天）→ 绿
  function dueClassOf(dueDate) {
    if (!dueDate) return '';
    const due = new Date(String(dueDate) + 'T00:00:00');
    if (isNaN(due.getTime())) return '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((due.getTime() - today.getTime()) / 86400000);
    if (days <= 0) return ' due-overdue';
    if (days <= 14) return ' due-soon';
    return ' due-far';
  }

  function renderItem(t) {
    const ownerAttr = t.owner ? \` data-owner="\${esc(t.owner)}"\` : '';
    const ownerTag = showAllUsers && t.owner
      ? \`<div class="todo-owner" title="录入者：\${esc(t.owner)}">\${esc(t.owner)}</div>\` : '';
    const st = statusOf(t);
    const doneCls = st === 'done' ? ' done' : '';
    // 管理员 + 待确认：交期 / 金额可直接点击修改
    const canEditDueAmount = isTodoManager && st === 'pending';
    const customerTag = t.customer
      ? \`<div class="todo-customer" title="客户：\${esc(t.customer)}">\${esc(t.customer)}</div>\` : '';
    const dueTag = t.dueDate
      ? '<div class="todo-due' + dueClassOf(t.dueDate) + (canEditDueAmount ? ' editable' : '') + '"' +
        (canEditDueAmount ? ' data-editdue="' + esc(t.id) + '"' : '') +
        ' title="交期 ' + esc(t.dueDate) + (canEditDueAmount ? '（点击修改）' : '') + '">' +
        esc(t.dueDate) + '</div>'
      : (canEditDueAmount
        ? '<div class="todo-due editable" data-editdue="' + esc(t.id) + '" title="点击设置交期">设置交期</div>'
        : '');
    // 生产方标签（只显示简称）：历史数据可能只有 producerId，用生产方列表兜底
    const producerShort = t.producerName ||
      (t.producerId ? ((producersCache.find(p => p.id === t.producerId) || {}).username || '') : '');
    // 管理员 / 超级观察者：该待办填了「采购文件链接」时，生产方标签可点击直接打开采购文件
    // （其他角色页面仍为普通标签）
    const producerTagAsLink = isTodoManager && !!t.purchaseUrl;
    const producerTag = producerShort
      ? (producerTagAsLink
        ? '<a class="todo-producer todo-producer-link" href="' + esc(t.purchaseUrl) + '"' +
          ' target="_blank" rel="noopener noreferrer"' +
          ' title="生产方 ' + esc(producerShort) + '（点击打开采购文件：' + esc(t.purchaseUrl) + '）">' +
          esc(producerShort) + '</a>'
        : '<div class="todo-producer" title="生产方 ' + esc(producerShort) + '">' +
          esc(producerShort) + '</div>')
      : '';
    // 观察类用户不显示金额；管理员在「待确认」阶段可点击修改
    const amountTag = !isObserver
      ? ((t.amount !== undefined && t.amount !== null && t.amount !== '')
        ? '<div class="todo-amount' + (canEditDueAmount ? ' editable' : '') + '"' +
          (canEditDueAmount ? ' data-editamount="' + esc(t.id) + '"' : '') +
          ' title="金额 $' + esc(t.amount) + (canEditDueAmount ? '（点击修改）' : '') + '">$' +
          esc(t.amount) + '</div>'
        : (canEditDueAmount
          ? '<div class="todo-amount editable" data-editamount="' + esc(t.id) + '" title="点击设置金额">设置金额</div>'
          : ''))
      : '';

    // 生产方下拉（仅管理员）：待确认阶段即可直接指定；改为「进行中」前必须有值
    const producerOptions = producersCache.map(p =>
      '<option value="' + esc(p.id) + '"' + (t.producerId === p.id ? ' selected' : '') + '>' +
      esc(p.username) + '</option>').join('');
    // 生产方下拉（仅管理员/超级观察者、且仅「待确认」阶段显示）
    // 「进行中 / 已完成」已有灰色生产方标签，无需保留下拉（避免误改）
    const producerSelect = isTodoManager && st === 'pending'
      ? '<select class="producer-select' + (t.producerId ? '' : ' unset') +
        '" data-producer-select="' + t.id + '" title="指定该待办的生产方">' +
        '<option value=""' + (t.producerId ? '' : ' selected') + '>' +
        (producersCache.length ? '选择生产方' : '请先添加生产方') + '</option>' +
        producerOptions + '</select>'
      : '';
    // 管理员/超级观察者：未指定生产方时给出提示（进行中/已完成阶段无下拉，需先改回待确认）
    const producerHint = (isTodoManager && !t.producerId)
      ? (st === 'pending'
        ? '<div class="producer-hint">尚未指定生产方：可直接在上方标题行的「生产方」下拉中选择；改为「进行中」前必须指定。</div>'
        : '<div class="producer-hint">尚未指定生产方：请先将状态改回「待确认」，指定生产方后再改为「进行中」。</div>')
      : '';
    // 状态展示：管理员用下拉可切换；其他用户用只读徽章


    const statusEl = isTodoManager
      ? \`<select class="status-select" data-status-select="\${t.id}">
           <option value="pending"\${st === 'pending' ? ' selected' : ''}>待确认</option>
           <option value="doing"\${st === 'doing' ? ' selected' : ''}>进行中</option>
           <option value="done"\${st === 'done' ? ' selected' : ''}>已完成</option>
         </select>\`
      : \`<span class="status-badge \${st}">\${STATUS_TEXT[st]}</span>\`;

    // 观察用户：待办本身只读（无删除按钮），但可添加备注
    // 已进入「进行中/已完成」状态的事件不可删除（含管理员，避免误删）
    const canDelete = !isObserver && st === 'pending';

    const delBtn = canDelete
      ? \`<button class="btn-danger" data-del="\${t.id}">删除订单</button>\`
      : '';
    // 已完成的事件不可再添加备注
    const noteAddBlock = st === 'done'
      ? ''
      : \`<div class="note-add">
              <textarea class="note-input" data-note-input="\${t.id}" placeholder="添加备注（添加后不可删除）..."></textarea>
              <div class="body-actions">
                <span class="save-status" data-status="\${t.id}"></span>
                \${delBtn}
                <button class="btn-primary-sm" data-addnote="\${t.id}">添加备注</button>
              </div>
            </div>\`;



    // PO#（标题）可点击的链接按角色区分：
    //   管理员 / 可录入用户 / 生产方 / 客户 → 订单文件链接（orderUrl）
    //   观察用户 / 受限观察用户 → PO# 为纯文本，不可点击
    const titleNoLink = isViewer || isRestricted;
    const titleUrl = titleNoLink ? '' : (t.orderUrl || '');
    const titleHtml = titleUrl
      ? '<a class="todo-title-link" href="' + esc(titleUrl) + '" target="_blank" rel="noopener noreferrer"' +
        ' title="打开订单文件：' + esc(titleUrl) + '">' + esc(t.title) + '</a>'
      : esc(t.title);

    return \`
      <div class="todo-item" data-id="\${t.id}"\${ownerAttr}>
        <div class="todo-header" data-toggle="\${t.id}">
          \${statusEl}
          \${producerSelect}
          \${customerTag}
          <div class="todo-title\${doneCls}">\${titleHtml}</div>
          \${dueTag}
          \${amountTag}
          \${ownerTag}
          \${producerTag}
          <div class="todo-date">\${fmtDate(t.createdAt)}</div>
          <div class="todo-arrow">▶</div>
        </div>


        <div class="todo-body">
          <div class="todo-body-inner">
            \${producerHint}
            <div class="note-label">备注（\${(t.notes || []).length}）</div>
            <div class="note-list">\${renderNotes(t)}</div>
            \${noteAddBlock}
          </div>

        </div>
      </div>\`;
  }

  function bindEvents() {
    // 「已完成」加载更多：每次多显示 20 条
    const moreDone = document.getElementById('btnLoadMoreDone');
    if (moreDone) {
      moreDone.addEventListener('click', () => {
        doneVisible += DONE_PAGE_STEP;
        render();
      });
    }
    // PO# 链接 / 生产方标签上的采购文件链接：点击打开链接时，不触发展开/折叠
    document.querySelectorAll('.todo-title-link, .todo-producer-link').forEach(el => {
      el.addEventListener('click', (e) => e.stopPropagation());
    });
    // 展开/折叠
    document.querySelectorAll('[data-toggle]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-status-select]')) return;
        const item = el.closest('.todo-item');
        item.classList.toggle('open');
      });
    });
    // 状态切换（仅管理员可见下拉）
    document.querySelectorAll('[data-status-select]').forEach(el => {
      el.addEventListener('click', (e) => e.stopPropagation());
      el.addEventListener('change', async (e) => {
        e.stopPropagation();
        const id = el.getAttribute('data-status-select');
        const t = todos.find(x => x.id === id);
        if (!t) return;
        const newStatus = el.value;
        // 转入「进行中」必须指定生产方：未指定时弹窗强制选择，已在标题行指定过则直接生效
        if (newStatus === 'doing' && !t.producerId) {
          await openProducerPick(t, el);
          return;
        }
        try {
          await saveStatus(t, newStatus);
        } catch (err) { alert(err.message); render(); }
      });
    });
    // 生产方选择（仅管理员可见下拉）：待确认阶段即可直接指定
    document.querySelectorAll('[data-producer-select]').forEach(el => {
      el.addEventListener('click', (e) => e.stopPropagation());
      el.addEventListener('change', async (e) => {
        e.stopPropagation();
        const id = el.getAttribute('data-producer-select');
        const t = todos.find(x => x.id === id);
        if (!t) return;
        const pid = el.value;
        if (!pid) {
          alert('请选择生产方（可在顶部「生产方管理」中添加）');
          el.value = t.producerId || '';
          return;
        }
        const payload = { producerId: pid };
        // 管理员操作他人待办时需指定所属用户
        if (t.owner) payload.owner = t.owner;
        el.disabled = true;
        try {
          await api('/api/todos/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const p = producersCache.find(x => x.id === pid);
          t.producerId = pid;
          t.producerName = p ? p.username : '';
          render();
        } catch (err) {
          alert(err.message);
          render();
        }
      });
    });
    // 交期 / 金额可点击修改（管理员，仅「待确认」的待办）
    document.querySelectorAll('[data-editdue]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        openDueAmount(el.getAttribute('data-editdue'), 'editDueDate');
      });
    });
    document.querySelectorAll('[data-editamount]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        openDueAmount(el.getAttribute('data-editamount'), 'editAmount');
      });
    });
    // 添加备注（追加式，不可删除）
    document.querySelectorAll('[data-addnote]').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = el.getAttribute('data-addnote');
        const item = el.closest('.todo-item');
        const input = item.querySelector('[data-note-input]');
        const status = item.querySelector('[data-status]');
        const text = input.value.trim();
        if (!text) {
          if (status) status.textContent = '请输入备注内容';
          return;
        }
        el.disabled = true;
        try {
          const payload = { text };
          // 观察用户需指定待办所属用户
          const owner = item.getAttribute('data-owner');
          if (owner) payload.owner = owner;
          const data = await api('/api/todos/' + id + '/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const t = todos.find(x => x.id === id);
          if (t) {
            if (!Array.isArray(t.notes)) t.notes = [];
            t.notes.push(data.note);
          }
          input.value = '';
          render();
          // 重新展开该项
          const newItem = document.querySelector('.todo-item[data-id="' + id + '"]');
          if (newItem) newItem.classList.add('open');
        } catch (err) {
          if (status) status.textContent = err.message;
          el.disabled = false;
        }
      });
    });
    // 删除
    document.querySelectorAll('[data-del]').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = el.getAttribute('data-del');
        const item = el.closest('.todo-item');
        if (!confirm('确定删除这条待办吗？')) return;
        try {
          const owner = item.getAttribute('data-owner');
          const url = '/api/todos/' + id + (owner ? '?owner=' + encodeURIComponent(owner) : '');
          await api(url, { method: 'DELETE' });
          todos = todos.filter(x => x.id !== id);
          render();
        } catch (err) { alert(err.message); }
      });
    });
  }

  // ---------- 加载当前用户的客户列表 ----------
  async function loadCustomers() {
    if (isObserver || isTodoManager) return;
    try {
      const data = await api('/api/customers/' + encodeURIComponent(currentUser.username));
      const sel = document.getElementById('newCustomer');
      const customers = data.customers || [];
      sel.innerHTML = '<option value="">请选择客户</option>' +
        customers.map(c => '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>').join('');
    } catch (err) { /* 忽略 */ }
  }

  // ---------- 添加待办 ----------
  async function addTodo() {
    const input = document.getElementById('newTitle');
    const customerSel = document.getElementById('newCustomer');
    const dueInput = document.getElementById('newDueDate');
    const amountInput = document.getElementById('newAmount');
    const urlInput = document.getElementById('newOrderUrl');
    const purchaseInput = document.getElementById('newPurchaseUrl');
    const title = input.value.trim();
    const customer = customerSel.value;
    const dueDate = dueInput.value;
    const amount = amountInput.value;
    const orderUrl = urlInput.value.trim();
    const purchaseUrl = purchaseInput.value.trim();
    if (!customer) { alert('请先选择客户'); return; }
    if (!title) { alert('请输入主题'); return; }
    if (!dueDate) { alert('请选择交期'); return; }
    if (amount === '' || amount === null) { alert('请输入金额'); return; }
    if (orderUrl && !/^https?:\\/\\//i.test(orderUrl)) {
      alert('订单文件链接需要以 http:// 或 https:// 开头');
      urlInput.focus();
      return;
    }
    if (purchaseUrl && !/^https?:\\/\\//i.test(purchaseUrl)) {
      alert('采购文件链接需要以 http:// 或 https:// 开头');
      purchaseInput.focus();
      return;
    }
    try {
      const data = await api('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, customer, dueDate, amount, orderUrl, purchaseUrl }),
      });
      todos.unshift(data.todo);
      input.value = '';
      customerSel.value = '';
      dueInput.value = '';
      syncDateField(dueInput);
      amountInput.value = '';
      urlInput.value = '';
      purchaseInput.value = '';
      render();
    } catch (err) { alert(err.message); }
  }

  document.getElementById('btnAdd').addEventListener('click', addTodo);
  document.getElementById('newTitle').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTodo();
  });


  // ---------- 弹窗控制 ----------
  document.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', () => {
      document.getElementById(el.getAttribute('data-close')).classList.remove('show');
    });
  });
  document.querySelectorAll('.modal-mask').forEach(mask => {
    mask.addEventListener('click', (e) => {
      if (e.target !== mask) return;
      // 指定生产方弹窗关闭时需回滚状态下拉的选择
      if (mask.id === 'producerPickModal') { closeProducerPick(); return; }
      mask.classList.remove('show');
    });
  });

  // ---------- 修改密码 ----------
  document.getElementById('btnChangePwd').addEventListener('click', () => {
    document.getElementById('pwdMsg').textContent = '';
    document.getElementById('oldPwd').value = '';
    document.getElementById('newPwd').value = '';
    document.getElementById('pwdModal').classList.add('show');
  });
  document.getElementById('btnSavePwd').addEventListener('click', async () => {
    const msg = document.getElementById('pwdMsg');
    msg.className = 'msg';
    try {
      await api('/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oldPassword: document.getElementById('oldPwd').value,
          newPassword: document.getElementById('newPwd').value,
        }),
      });
      msg.className = 'msg ok';
      msg.textContent = '修改成功';
      setTimeout(() => document.getElementById('pwdModal').classList.remove('show'), 800);
    } catch (err) {
      msg.className = 'msg err';
      msg.textContent = err.message;
    }
  });

  // ---------- 生产方缓存（指定生产方 / 授权观察共用） ----------
  let producersCache = [];
  async function ensureProducers() {
    if (producersCache.length) return producersCache;
    try {
      const data = await api('/api/producers');
      producersCache = data.producers || [];
    } catch (e) { producersCache = []; }
    return producersCache;
  }

  // ---------- 全局客户列表缓存（客户管理 / 成员管理分配客户共用） ----------
  let customerListCache = [];
  async function ensureCustomerList(force) {
    if (customerListCache.length && !force) return customerListCache;
    try {
      const data = await api('/api/customer-list');
      customerListCache = data.customers || [];
    } catch (e) { customerListCache = []; }
    return customerListCache;
  }

  const ROLE_TEXT = {
    admin: '管理员', editor: '可录入用户',
    viewer: '观察用户', restricted: '受限观察用户',
    superviewer: '超级观察者'
  };
  const ROLE_CLS = {
    admin: 'admin', editor: '', viewer: 'viewer',
    restricted: 'restricted', superviewer: 'superviewer'
  };

  // 受限观察用户：「可观察生产方」管理区块（成员管理弹窗内）
  function buildWatchBlock(u, producers) {
    const ids = Array.isArray(u.watched) ? u.watched : [];
    const granted = ids.map(id => {
      const p = producers.find(x => x.id === id);
      return p || { id: id, username: '（已删除的生产方）', deleted: true };
    });
    const chips = granted.length
      ? granted.map(p =>
          '<span class="customer-chip">' + esc(p.username) +
          '<span class="customer-chip-del" data-delwatch="' + esc(u.username) +
          '" data-pid="' + esc(p.id) + '">×</span></span>').join('')
      : '<span class="customer-empty">暂无可观察生产方</span>';
    const options = producers.length
      ? '<option value="">选择生产方</option>' + producers.map(p =>
          '<option value="' + esc(p.id) + '">' + esc(p.username) + '</option>').join('')
      : '<option value="">请先在「生产方管理」中添加生产方</option>';
    return '<div class="customer-manage" data-watch-manage="' + esc(u.username) + '">' +
      '<div class="customer-manage-title">可观察生产方</div>' +
      '<div class="customer-list">' + chips + '</div>' +
      '<div class="customer-add-row">' +
      '<select class="customer-add-input watch-add-select">' + options + '</select>' +
      '<button class="btn-primary-sm" data-addwatch="' + esc(u.username) + '">添加生产方</button>' +
      '</div></div>';
  }

  // ---------- 待办状态保存（可同时指定生产方） ----------
  async function saveStatus(t, newStatus, producerId) {
    const payload = { status: newStatus };
    // 管理员操作他人待办时需指定所属用户
    if (t.owner) payload.owner = t.owner;
    if (producerId) payload.producerId = producerId;
    const data = await api('/api/todos/' + t.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const saved = data.todo || {};
    t.status = newStatus;
    t.done = newStatus === 'done';
    if (saved.producerId) {
      t.producerId = saved.producerId;
      t.producerName = saved.producerName;
    }
    render();
  }

  // ---------- 指定生产方弹窗 ----------
  let picking = null;

  async function openProducerPick(t, selectEl) {
    const producers = await ensureProducers();
    if (!producers.length) {
      alert('还没有生产方，请先点击顶部「生产方管理」添加生产方');
      if (selectEl) selectEl.value = statusOf(t);
      return;
    }
    const sel = document.getElementById('pickProducerSelect');
    sel.innerHTML = '<option value="">请选择生产方</option>' + producers.map(p =>
      '<option value="' + esc(p.id) + '">' + esc(p.username) + '</option>').join('');
    sel.value = (t.producerId && producers.some(p => p.id === t.producerId)) ? t.producerId : '';
    const msg = document.getElementById('pickProducerMsg');
    msg.className = 'msg';
    msg.textContent = t.producerName ? '当前生产方：' + t.producerName : '';
    picking = { todo: t, selectEl };
    document.getElementById('producerPickModal').classList.add('show');
  }

  function closeProducerPick() {
    if (!picking) return;
    const todo = picking.todo;
    const selectEl = picking.selectEl;
    picking = null;
    document.getElementById('producerPickModal').classList.remove('show');
    if (selectEl) selectEl.value = statusOf(todo);
  }

  document.getElementById('btnCancelPickProducer').addEventListener('click', closeProducerPick);

  document.getElementById('btnConfirmPickProducer').addEventListener('click', async () => {
    if (!picking) return;
    const sel = document.getElementById('pickProducerSelect');
    const msg = document.getElementById('pickProducerMsg');
    if (!sel.value) {
      msg.className = 'msg err';
      msg.textContent = '请选择生产方';
      return;
    }
    const target = picking.todo;
    picking = null;
    document.getElementById('producerPickModal').classList.remove('show');
    try {
      await saveStatus(target, 'doing', sel.value);
    } catch (err) {
      alert(err.message);
      render();
    }
  });

  // ---------- 修改交期 / 金额（管理员，仅「待确认」的待办） ----------
  let dueAmountTarget = null;

  function openDueAmount(id, focusField) {
    const t = todos.find(x => x.id === id);
    if (!t) return;
    dueAmountTarget = t;
    document.getElementById('editTitle').value = t.title || '';
    document.getElementById('editDueDate').value = t.dueDate || '';
    syncDateField(document.getElementById('editDueDate'));
    document.getElementById('editAmount').value =
      (t.amount === undefined || t.amount === null) ? '' : t.amount;
    document.getElementById('editOrderUrl').value = t.orderUrl || '';
    document.getElementById('editPurchaseUrl').value = t.purchaseUrl || '';
    const msg = document.getElementById('dueAmountMsg');
    msg.className = 'msg';
    msg.textContent = '';
    document.getElementById('dueAmountModal').classList.add('show');
    const el = document.getElementById(focusField);
    if (el) el.focus();
  }

  document.getElementById('btnSaveDueAmount').addEventListener('click', async () => {
    if (!dueAmountTarget) return;
    const msg = document.getElementById('dueAmountMsg');
    msg.className = 'msg';
    const title = document.getElementById('editTitle').value.trim();
    const dueDate = document.getElementById('editDueDate').value;
    const amount = document.getElementById('editAmount').value;
    const orderUrl = document.getElementById('editOrderUrl').value.trim();
    const purchaseUrl = document.getElementById('editPurchaseUrl').value.trim();
    if (!title) { msg.className = 'msg err'; msg.textContent = '请输入 PO#（主题）'; return; }
    if (!dueDate) { msg.className = 'msg err'; msg.textContent = '请选择交期'; return; }
    if (amount === '') { msg.className = 'msg err'; msg.textContent = '请输入金额'; return; }
    if (orderUrl && !/^https?:\\/\\//i.test(orderUrl)) {
      msg.className = 'msg err';
      msg.textContent = '订单文件链接需以 http:// 或 https:// 开头';
      return;
    }
    if (purchaseUrl && !/^https?:\\/\\//i.test(purchaseUrl)) {
      msg.className = 'msg err';
      msg.textContent = '采购文件链接需以 http:// 或 https:// 开头';
      return;
    }
    const targetId = dueAmountTarget.id;
    const payload = { title, dueDate, amount, orderUrl, purchaseUrl };
    // 管理员操作他人待办时需指定所属用户
    if (dueAmountTarget.owner) payload.owner = dueAmountTarget.owner;
    try {
      const data = await api('/api/todos/' + encodeURIComponent(targetId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const saved = data.todo || {};
      const idx = todos.findIndex(x => x.id === targetId);
      if (idx !== -1) {
        todos[idx].title = saved.title !== undefined ? saved.title : title;
        todos[idx].dueDate = saved.dueDate !== undefined ? saved.dueDate : dueDate;
        todos[idx].amount = saved.amount !== undefined ? saved.amount : amount;
        todos[idx].orderUrl = saved.orderUrl !== undefined ? saved.orderUrl : orderUrl;
        todos[idx].purchaseUrl = saved.purchaseUrl !== undefined ? saved.purchaseUrl : purchaseUrl;
      }
      dueAmountTarget = null;
      document.getElementById('dueAmountModal').classList.remove('show');
      render();
    } catch (err) {
      msg.className = 'msg err';
      msg.textContent = err.message;
    }
  });

  // ---------- 成员管理 ----------
  document.getElementById('btnManageUsers').addEventListener('click', async () => {
    document.getElementById('userMsg').textContent = '';
    document.getElementById('usersModal').classList.add('show');
    await loadUsers();
  });
  async function loadUsers() {
    try {
      const data = await api('/api/users');
      const list = document.getElementById('userList');
      // 可录入用户：非管理员、非观察类、非超级观察者（兼容历史 role=member 数据）
      const isEditor = (u) => u.role !== 'admin' && u.role !== 'viewer' && u.role !== 'restricted' && u.role !== 'superviewer';
      // 全局生产方列表（受限观察用户授权用）
      const producers = await ensureProducers();
      // 全局客户列表（为「可录入用户」分配客户时的可选项，来自「客户管理」；每次打开都重新拉取）
      const customerList = await ensureCustomerList(true);
      // 先并发拉取所有可录入成员的客户列表，避免逐个 await 造成的问题
      const customerMap = {};
      await Promise.all(data.users.map(async (u) => {
        if (!isEditor(u)) return;
        try {
          const cd = await api('/api/customers/' + encodeURIComponent(u.username));
          customerMap[u.username] = cd.customers || [];
        } catch (e) {
          customerMap[u.username] = [];
        }
      }));
      list.innerHTML = data.users.map(u => {
        const roleText = ROLE_TEXT[u.role] || '可录入用户';
        const roleCls = ROLE_CLS[u.role] || '';
        // 可录入用户需要维护客户列表
        let customerBlock = '';
        if (u.role === 'restricted') {
          // 受限观察用户：维护「可观察生产方」
          customerBlock = buildWatchBlock(u, producers);
        } else if (isEditor(u)) {

          const customers = customerMap[u.username] || [];
          const assignedIds = customers.map(c => c.id);
          const chips = customers.length
            ? customers.map(c => \`
                <span class="customer-chip">
                  \${esc(c.name)}
                  <span class="customer-chip-del" data-delcustomer="\${esc(u.username)}" data-cid="\${esc(c.id)}">×</span>
                </span>\`).join('')
            : '<span class="customer-empty">暂无客户</span>';
          // 可选项直接调用「客户管理」里维护的全局客户列表（已分配的排除）
          const available = customerList.filter(c => assignedIds.indexOf(c.id) === -1);
          const addRow = available.length
            ? '<select class="customer-add-select"><option value="">选择客户</option>' +
              available.map(c => '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>').join('') +
              '</select>' +
              '<button class="btn-primary-sm" data-addcustomer="' + esc(u.username) + '">添加客户</button>'
            : '<div class="customer-empty">' +
              (customerList.length ? '全部客户都已分配' : '请先到顶部「客户管理」添加客户') +
              '</div>';
          customerBlock = \`
          <div class="customer-manage" data-customer-manage="\${esc(u.username)}">
            <div class="customer-manage-title">客户列表</div>
            <div class="customer-list">\${chips}</div>
            <div class="customer-add-row">\${addRow}</div>
          </div>\`;
        }
        return \`
        <div class="user-block">
          <div class="user-row">
            <div>
              <span>\${esc(u.username)}</span>
              <span class="role \${roleCls}">\${roleText}</span>
              \${editTextHtml('user', u.username, u.username, u.remark, '未填写', 'remark-row')}
            </div>
            <div class="user-row-actions">
              <button class="btn-secondary-sm" data-resetpwd="\${esc(u.username)}">重置密码</button>
              \${u.username !== 'admin' ? '<button class="btn-danger" data-deluser="' + esc(u.username) + '">删除</button>' : ''}
            </div>
          </div>
          \${customerBlock}
        </div>\`;

      }).join('');
      list.querySelectorAll('[data-deluser]').forEach(el => {
        el.addEventListener('click', async () => {
          const name = el.getAttribute('data-deluser');
          if (!confirm('确定删除成员 ' + name + ' 吗？其待办也会被删除。')) return;
          try {
            await api('/api/users/' + encodeURIComponent(name), { method: 'DELETE' });
            await loadUsers();
          } catch (err) { alert(err.message); }
        });
      });
      // 重置密码
      list.querySelectorAll('[data-resetpwd]').forEach(el => {
        el.addEventListener('click', () => {
          const name = el.getAttribute('data-resetpwd');
          document.getElementById('resetPwdUser').value = name;
          document.getElementById('resetPwdValue').value = '';
          const msg = document.getElementById('resetPwdMsg');
          msg.className = 'msg';
          msg.textContent = '';
          document.getElementById('resetPwdModal').classList.add('show');
        });
      });
      // 成员备注（点文字直接修改）
      bindDescEditors(list, () => loadUsers());

      // 添加客户（从「客户管理」维护的全局客户列表中选取）
      list.querySelectorAll('[data-addcustomer]').forEach(el => {
        el.addEventListener('click', async () => {
          const name = el.getAttribute('data-addcustomer');
          const block = el.closest('.customer-manage');
          const sel = block ? block.querySelector('.customer-add-select') : null;
          if (!sel || !sel.value) { alert('请选择客户'); return; }
          const cid = sel.value;
          const picked = customerList.find(c => c.id === cid);
          if (!picked) { alert('该客户已不存在，请关闭后重新打开成员管理'); return; }
          try {
            await api('/api/customers/' + encodeURIComponent(name), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: picked.name, globalId: picked.id }),
            });
            await loadUsers();
          } catch (err) { alert(err.message); }
        });
      });
      // 授权 / 取消授权 受限观察用户的可观察生产方
      list.querySelectorAll('[data-addwatch]').forEach(el => {
        el.addEventListener('click', async () => {
          const name = el.getAttribute('data-addwatch');
          const block = el.closest('[data-watch-manage]');
          const sel = block ? block.querySelector('.watch-add-select') : null;
          if (!sel) return;
          if (!sel.value) { alert('请选择生产方'); return; }
          try {
            await api('/api/watch/' + encodeURIComponent(name), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ producerId: sel.value }),
            });
            await loadUsers();
          } catch (err) { alert(err.message); }
        });
      });
      list.querySelectorAll('[data-delwatch]').forEach(el => {
        el.addEventListener('click', async () => {
          const name = el.getAttribute('data-delwatch');
          const pid = el.getAttribute('data-pid');
          if (!confirm('确定取消该生产方的观察授权吗？')) return;
          try {
            await api('/api/watch/' + encodeURIComponent(name) + '/' + encodeURIComponent(pid), { method: 'DELETE' });
            await loadUsers();
          } catch (err) { alert(err.message); }
        });
      });
      // 删除客户
      list.querySelectorAll('[data-delcustomer]').forEach(el => {
        el.addEventListener('click', async () => {
          const uname = el.getAttribute('data-delcustomer');
          const cid = el.getAttribute('data-cid');
          if (!confirm('确定删除该客户吗？')) return;
          try {
            await api('/api/customers/' + encodeURIComponent(uname) + '/' + encodeURIComponent(cid), { method: 'DELETE' });
            await loadUsers();
          } catch (err) { alert(err.message); }
        });
      });
    } catch (err) {
      document.getElementById('userMsg').className = 'msg err';
      document.getElementById('userMsg').textContent = err.message;
    }
  }



  document.getElementById('btnAddUser').addEventListener('click', async () => {
    const msg = document.getElementById('userMsg');
    msg.className = 'msg';
    const username = document.getElementById('newUserName').value.trim();
    const password = document.getElementById('newUserPwd').value;
    const role = document.getElementById('newUserRole').value;
    if (!username || !password) {
      msg.className = 'msg err';
      msg.textContent = '请填写用户名和密码';
      return;
    }
    try {
      await api('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role }),
      });
      msg.className = 'msg ok';
      msg.textContent = '添加成功';
      document.getElementById('newUserName').value = '';
      document.getElementById('newUserPwd').value = '';
      document.getElementById('newUserRole').value = 'editor';
      await loadUsers();
    } catch (err) {
      msg.className = 'msg err';
      msg.textContent = err.message;
    }
  });

  // ---------- 生产方管理 ----------
  document.getElementById('btnProducers').addEventListener('click', async () => {
    const msg = document.getElementById('producerMsg');
    msg.className = 'msg';
    msg.textContent = '';
    document.getElementById('producersModal').classList.add('show');
    await loadProducers();
  });

  async function loadProducers() {
    const list = document.getElementById('producerList');
    try {
      const data = await api('/api/producers');
      const producers = data.producers || [];
      if (!producers.length) {
        list.innerHTML = '<div class="producer-empty">暂无生产方</div>';
        return;
      }
      list.innerHTML = producers.map(p =>
        '<div class="producer-row">' +
          '<div>' +
            '<div class="producer-short">' + esc(p.username) + '</div>' +
            editTextHtml('producer', p.id, p.username, p.description, '未填写说明', 'producer-desc') +
          '</div>' +
          '<div class="producer-row-actions">' +
            '<button class="btn-secondary-sm" data-resetpwdproducer="' + esc(p.username) + '">重置密码</button>' +
            '<button class="btn-danger" data-delproducer="' + esc(p.id) + '">删除</button>' +
          '</div>' +
        '</div>').join('');
      // 说明可点击修改
      bindDescEditors(list, () => loadProducers());
      // 重置生产方登录密码（复用「重置密码」弹窗）
      list.querySelectorAll('[data-resetpwdproducer]').forEach(el => {
        el.addEventListener('click', () => {
          const name = el.getAttribute('data-resetpwdproducer');
          document.getElementById('resetPwdUser').value = name;
          document.getElementById('resetPwdValue').value = '';
          const msg = document.getElementById('resetPwdMsg');
          msg.className = 'msg';
          msg.textContent = '';
          document.getElementById('resetPwdModal').classList.add('show');
        });
      });
      list.querySelectorAll('[data-delproducer]').forEach(el => {
        el.addEventListener('click', async () => {
          const id = el.getAttribute('data-delproducer');
          if (!confirm('确定删除该生产方吗？')) return;
          try {
            await api('/api/producers/' + encodeURIComponent(id), { method: 'DELETE' });
            producersCache = [];
            await loadProducers();
            render();
          } catch (err) { alert(err.message); }
        });
      });
    } catch (err) {
      list.innerHTML = '<div class="producer-empty">加载失败：' + esc(err.message) + '</div>';
    }
  }

  document.getElementById('btnAddProducer').addEventListener('click', async () => {
    const msg = document.getElementById('producerMsg');
    msg.className = 'msg';
    const username = document.getElementById('newProducerShort').value.trim();
    const password = document.getElementById('newProducerPwd').value;
    const description = document.getElementById('newProducerDesc').value.trim();
    if (!username) {
      msg.className = 'msg err';
      msg.textContent = '请输入用户名';
      return;
    }
    if (!password) {
      msg.className = 'msg err';
      msg.textContent = '请输入密码（生产方用它登录）';
      return;
    }
    try {
      await api('/api/producers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, description }),
      });
      msg.className = 'msg ok';
      msg.textContent = '添加成功（生产方可用该用户名和密码登录）';
      document.getElementById('newProducerShort').value = '';
      document.getElementById('newProducerPwd').value = '';
      document.getElementById('newProducerDesc').value = '';
      producersCache = [];
      await loadProducers();
      render();
    } catch (err) {
      msg.className = 'msg err';
      msg.textContent = err.message;
    }
  });

  // ---------- 客户管理（全局客户列表；供成员管理为可录入用户分配客户） ----------
  document.getElementById('btnCustomers').addEventListener('click', async () => {
    const msg = document.getElementById('customerListMsg');
    msg.className = 'msg';
    msg.textContent = '';
    document.getElementById('customersModal').classList.add('show');
    await loadCustomerList();
  });

  async function loadCustomerList() {
    const list = document.getElementById('customerListRows');
    try {
      const data = await api('/api/customer-list');
      const customers = data.customers || [];
      customerListCache = customers;
      if (!customers.length) {
        list.innerHTML = '<div class="producer-empty">暂无客户</div>';
        return;
      }
      list.innerHTML = customers.map(c =>
        '<div class="producer-row">' +
          '<div>' +
            '<div class="producer-short">' + esc(c.name) + '</div>' +
            editTextHtml('customer', c.id, c.name, c.description, '未填写说明', 'producer-desc') +
          '</div>' +
          '<div class="producer-row-actions">' +
            '<button class="btn-secondary-sm" data-resetpwdcustomer="' + esc(c.name) + '">重置密码</button>' +
            '<button class="btn-danger" data-delcustomerlist="' + esc(c.id) + '">删除</button>' +
          '</div>' +
        '</div>').join('');
      // 说明可点击修改
      bindDescEditors(list, () => loadCustomerList());
      // 重置客户登录密码（复用「重置密码」弹窗）
      list.querySelectorAll('[data-resetpwdcustomer]').forEach(el => {
        el.addEventListener('click', () => {
          const name = el.getAttribute('data-resetpwdcustomer');
          document.getElementById('resetPwdUser').value = name;
          document.getElementById('resetPwdValue').value = '';
          const msg = document.getElementById('resetPwdMsg');
          msg.className = 'msg';
          msg.textContent = '';
          document.getElementById('resetPwdModal').classList.add('show');
        });
      });
      list.querySelectorAll('[data-delcustomerlist]').forEach(el => {
        el.addEventListener('click', async () => {
          const id = el.getAttribute('data-delcustomerlist');
          if (!confirm('确定删除该客户吗？（已分配给成员的记录不会自动移除）')) return;
          try {
            await api('/api/customer-list/' + encodeURIComponent(id), { method: 'DELETE' });
            customerListCache = [];
            await loadCustomerList();
          } catch (err) { alert(err.message); }
        });
      });
    } catch (err) {
      list.innerHTML = '<div class="producer-empty">加载失败：' + esc(err.message) + '</div>';
    }
  }

  document.getElementById('btnAddCustomer').addEventListener('click', async () => {
    const msg = document.getElementById('customerListMsg');
    msg.className = 'msg';
    const name = document.getElementById('newCustomerName').value.trim();
    const password = document.getElementById('newCustomerPwd').value;
    const description = document.getElementById('newCustomerDesc').value.trim();
    if (!name) {
      msg.className = 'msg err';
      msg.textContent = '请输入用户名';
      return;
    }
    if (!password) {
      msg.className = 'msg err';
      msg.textContent = '请输入密码（客户用它登录）';
      return;
    }
    try {
      await api('/api/customer-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password, description }),
      });
      msg.className = 'msg ok';
      msg.textContent = '添加成功（客户可用该用户名和密码登录）';
      document.getElementById('newCustomerName').value = '';
      document.getElementById('newCustomerPwd').value = '';
      document.getElementById('newCustomerDesc').value = '';
      customerListCache = [];
      await loadCustomerList();
    } catch (err) {
      msg.className = 'msg err';
      msg.textContent = err.message;
    }
  });

  // ---------- 列表内文字编辑（成员备注 / 生产方说明 / 客户说明 共用） ----------
  const EDIT_KINDS = {
    user: {
      label: '成员',
      field: '备注',
      hint: '请输入备注（留空即清除备注）',
      key: 'remark',
      api: (id) => '/api/users/' + encodeURIComponent(id) + '/remark',
    },
    producer: {
      label: '生产方',
      field: '说明',
      hint: '请输入说明（留空即清除说明）',
      key: 'description',
      api: (id) => '/api/producers/' + encodeURIComponent(id) + '/description',
    },
    customer: {
      label: '客户',
      field: '说明',
      hint: '请输入说明（留空即清除说明）',
      key: 'description',
      api: (id) => '/api/customer-list/' + encodeURIComponent(id) + '/description',
    },
  };
  let editTarget = null; // { kind, id, onSaved }

  // 行内可点击编辑的文字（成员备注 / 生产方说明 / 客户说明）
  function editTextHtml(kind, id, name, value, emptyText, cls) {
    const text = String(value || '').trim();
    return '<div class="' + esc(cls) + ' desc-editable" data-desc-kind="' + esc(kind) +
      '" data-desc-id="' + esc(id) + '" data-desc-name="' + esc(name) + '"' +
      ' title="' + (text ? '点击修改' : '点击添加') + '">' +
      (text ? esc(text) : '<span class="desc-empty">' + esc(emptyText) + '</span>') +
      '</div>';
  }

  // 打开编辑弹窗（标题 / 字段名 / 提示语按对象类型切换）
  function openEditModal(kind, id, name, current, onSaved) {
    const def = EDIT_KINDS[kind];
    if (!def) return;
    editTarget = { kind, id, onSaved };
    document.getElementById('remarkTitle').textContent = def.label + def.field;
    document.getElementById('remarkUserLabel').textContent = def.label;
    document.getElementById('remarkUser').value = name || id || '';
    document.getElementById('remarkFieldLabel').textContent = def.field;
    const ta = document.getElementById('remarkText');
    ta.placeholder = def.hint;
    ta.value = current || '';
    const msg = document.getElementById('remarkMsg');
    msg.className = 'msg';
    msg.textContent = '';
    document.getElementById('remarkModal').classList.add('show');
    ta.focus();
  }

  // 绑定列表内可点击编辑的文字（成员备注 / 生产方说明 / 客户说明）
  function bindDescEditors(list, onSaved) {
    list.querySelectorAll('[data-desc-kind]').forEach(el => {
      el.addEventListener('click', () => {
        const empty = el.querySelector('.desc-empty');
        openEditModal(el.getAttribute('data-desc-kind'), el.getAttribute('data-desc-id'),
          el.getAttribute('data-desc-name'), empty ? '' : el.textContent.trim(), onSaved);
      });
    });
  }

  document.getElementById('btnSaveRemark').addEventListener('click', async () => {
    const msg = document.getElementById('remarkMsg');
    msg.className = 'msg';
    const value = document.getElementById('remarkText').value.trim();
    if (!editTarget) { msg.className = 'msg err'; msg.textContent = '请选择要修改的对象'; return; }
    const def = EDIT_KINDS[editTarget.kind];
    if (!def) { msg.className = 'msg err'; msg.textContent = '未知的对象类型'; return; }
    try {
      const payload = {};
      payload[def.key] = value;
      await api(def.api(editTarget.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      msg.className = 'msg ok';
      msg.textContent = def.field + '已保存';
      if (editTarget.onSaved) await editTarget.onSaved();
      setTimeout(() => document.getElementById('remarkModal').classList.remove('show'), 500);
    } catch (err) {
      msg.className = 'msg err';
      msg.textContent = err.message;
    }
  });

  // ---------- 重置密码 ----------
  document.getElementById('btnSaveResetPwd').addEventListener('click', async () => {
    const msg = document.getElementById('resetPwdMsg');
    msg.className = 'msg';
    const username = document.getElementById('resetPwdUser').value;
    const newPassword = document.getElementById('resetPwdValue').value;
    if (!newPassword) {
      msg.className = 'msg err';
      msg.textContent = '请输入新密码';
      return;
    }
    try {
      await api('/api/users/' + encodeURIComponent(username) + '/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      });
      msg.className = 'msg ok';
      msg.textContent = '重置成功';
      setTimeout(() => document.getElementById('resetPwdModal').classList.remove('show'), 800);
    } catch (err) {
      msg.className = 'msg err';
      msg.textContent = err.message;
    }
  });

  // ---------- 设置 ----------
  document.getElementById('btnSettings').addEventListener('click', () => {
    const msg = document.getElementById('settingsMsg');
    msg.className = 'msg';
    msg.textContent = '';
    document.getElementById('siteNameInput').value =
      document.getElementById('siteName').textContent;
    document.getElementById('settingsModal').classList.add('show');
  });
  document.getElementById('btnSaveSettings').addEventListener('click', async () => {
    const msg = document.getElementById('settingsMsg');
    msg.className = 'msg';
    const siteName = document.getElementById('siteNameInput').value.trim();
    if (!siteName) {
      msg.className = 'msg err';
      msg.textContent = '请输入网站名称';
      return;
    }
    try {
      const data = await api('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteName }),
      });
      const name = (data.settings && data.settings.siteName) || siteName;
      document.getElementById('siteName').textContent = name;
      document.title = '我的待办 - ' + name;
      msg.className = 'msg ok';
      msg.textContent = '保存成功';
      setTimeout(() => document.getElementById('settingsModal').classList.remove('show'), 800);
    } catch (err) {
      msg.className = 'msg err';
      msg.textContent = err.message;
    }
  });

  // ---------- 退出 ----------
  document.getElementById('btnLogout').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    location.href = '/';
  });



  init();
</script>
</body>
</html>`;
}
