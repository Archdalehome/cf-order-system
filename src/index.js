import { loginPage, todoPage, adminPage } from "./pages.js";
// Cloudflare Workers 内置 TCP Socket：QQ 邮箱等 SMTP 发信走这里（465 隐式 TLS / 587 STARTTLS）
import { connect } from "cloudflare:sockets";

// ============ 账户体系说明 ============
// superadmin 超级管理员：平台唯一（默认 admin/admin）。只用于管理「团队用户」——
//   开通 / 停用 / 订阅开通（升级为专业版） / 重置密码 / 备注，不参与任何业务（待办）。
// team 团队管理员（团队用户）：在登录页点「新帐户注册」申请，注册时填写的邮箱为必填项：
//   ① 提交注册后系统立即向该邮箱发送「6 位邮箱确认码」（10 分钟有效）；
//   ② 注册人登录时需先输入邮件中的确认码完成邮箱确认（/api/register/verify），
//      确认通过后才允许正常登录；确认码可用「重新发送确认码」（/api/register/resend，
//      需带登录密码，1 分钟内不重复发送、1 小时最多 5 次）重新获取；
//   ③ 邮箱确认后账号即为「试用团队账号」：试用期无期限（不会到期，也不会因此被阻止登录）；
//   ④ 只能团队账号本人一人使用：没有「成员管理 / 生产方管理 / 客户管理」功能，但可以添加订单
//      （试用期添加订单时，客户名称直接手工填写，系统自动记入客户列表）；
//   ⑤ 点击顶栏「订阅」选择套餐并提交「订阅申请」，由超级管理员开通后即成为「专业版」，
//      有效期内可使用系统全部功能（成员 / 生产方 / 客户管理、订单状态流转等）；
//      订阅时限与价格与原来保持一致。
//   专业版订阅到期后自动回落为「试用（受限）」状态：仍可登录、可添加订单，再次「订阅」即可恢复。
//   注：升级前已注册的团队账号（没有 emailVerified 字段）视为「已确认」，可直接登录。
// 其他角色（superviewer / editor / viewer / restricted / producer / customer）
//   均由专业版团队管理员在本团队内创建，数据按 teamId 隔离，互不可见。
const DEFAULT_TEAM = "default"; // 历史数据（无 teamId）默认归属的团队
const PLATFORM_TEAM = "__platform__"; // 超级管理员不属于任何团队（不参与业务数据）
const DAY_MS = 24 * 60 * 60 * 1000;
// 管理类功能（成员 / 生产方 / 客户管理）为专业版功能，试用账号调用时返回该提示
const PRO_ONLY_MSG =
  "该功能为专业版功能：请点击顶栏「订阅」升级为专业用户后使用（试用账号仅限本人使用与添加订单）";
// 注册邮箱格式（团队用户注册必填项）：user@domain.tld
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

// ============ 注册邮箱确认码 ============
// 团队账号注册流程：填写注册资料 → 系统立即向「注册时填写的邮箱」发送 6 位确认码（10 分钟有效）
//   → 注册人登录时先输入邮件中的确认码，确认通过后才允许正常登录（建立会话）。
// 注：升级前已存在的团队账号没有 emailVerified 字段，一律视为「已确认」，不受影响。
const CODE_TTL_SEC = 10 * 60; // 确认码有效期：10 分钟
const CODE_MAX_ATTEMPTS = 5; // 同一确认码最多允许输错 5 次（超过需重新发送）
const CODE_RESEND_SEC = 60; // 同一账号两次发送确认码的最小间隔：60 秒
const CODE_MAX_PER_HOUR = 5; // 同一账号 1 小时内最多发送 5 次
const MAIL_TIMEOUT_MS = 10000; // 邮件接口请求超时保护（Resend / send_email 绑定）
const SUB_QR_MAX = 3; // 订阅申请邮件里最多可插入的收款二维码图片数
const SMTP_TIMEOUT_MS = 20000; // SMTP 与 QQ 邮箱通信的整体超时保护
const SMTP_LOCAL_TIMEOUT_MS = 8000; // 本地 wrangler dev 无法做 TLS，超时缩短以便快速失败并给出指引

// ============ 工具函数 ============

// 生成随机 token
function genToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

// 简单哈希（用于密码存储，避免明文）
async function hashPassword(password) {
  const data = new TextEncoder().encode(password + "::cf-todolist-salt");
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

// 订单文件链接规范化：允许留空（表示没有链接）；填写时必须是 http:// 或 https:// 开头的合法链接
// 返回 "" 表示留空、null 表示非法、否则为规范化后的链接
function normalizeOrderUrl(raw) {
  const v = String(raw === undefined || raw === null ? "" : raw).trim();
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) return null;
  if (/\s/.test(v)) return null;
  return v;
}

// 订单币种：USD=美元（默认，历史数据同）/ CNY=人民币
const CURRENCIES = ["USD", "CNY"];

function normalizeCurrency(raw) {
  const v = String(raw === undefined || raw === null ? "" : raw).trim().toUpperCase();
  return CURRENCIES.includes(v) ? v : "USD";
}

// JSON 响应
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// 读取请求体 JSON
async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// 从 Cookie 中解析 token
function getToken(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)token=([^;]+)/);
  return match ? match[1] : null;
}

// 该用户所属团队 id（历史数据没有 teamId 时归入默认团队；超级管理员不属于任何团队）
function teamIdOf(user) {
  if (!user) return DEFAULT_TEAM;
  if (isSuperAdmin(user.role)) return PLATFORM_TEAM;
  return user.teamId || DEFAULT_TEAM;
}

// 超级管理员（平台级）：只管理团队用户
function isSuperAdmin(role) {
  return role === "superadmin";
}

// 团队管理员（团队用户）：拥有原系统的全部功能
function isTeamAdmin(role) {
  return role === "team";
}

// 是否「专业版」团队：plan=pro（新规则）；历史数据 plan=paid 视为同一状态
function isProPlan(team) {
  return !!team && (team.plan === "pro" || team.plan === "paid");
}

// 团队账户的当前状态：disabled=已停用、expired=专业版订阅已到期、active=正常
// 注：试用账号为「无限期试用」不会到期；专业版到期后回落为试用状态（仍可登录，但功能受限）
function teamStatusOf(team) {
  if (!team) return "active";
  if (team.status === "disabled") return "disabled";
  if (isProPlan(team)) {
    const exp = team.expiresAt || "";
    if (exp && new Date(exp).getTime() < Date.now()) return "expired";
  }
  return "active";
}

// 团队当前是否处于「专业版有效期内」：可使用系统全部功能
// （成员 / 生产方 / 客户管理、订单状态流转等）；否则按试用账号处理（仅本人使用 + 添加订单）
function isProTeam(team) {
  return isProPlan(team) && teamStatusOf(team) === "active";
}

// 团队提交的订阅 / 续费申请（兼容历史字段名 renewRequest）
function subscribeRequestOf(team) {
  if (!team) return null;
  return team.subscribeRequest || team.renewRequest || null;
}

// 管理类功能仅专业版可用（试用账号返回统一的 403 提示）
function proOnly() {
  return json({ error: PRO_ONLY_MSG }, 403);
}

// 团队被停用后，团队账号与其成员都无法继续使用
async function getTeam(env, teamId) {
  if (!teamId || teamId === DEFAULT_TEAM) return null;
  const raw = await env.TODO_KV.get(`user:${teamId}`);
  if (!raw) return null;
  const team = JSON.parse(raw);
  return isTeamAdmin(team.role) ? team : null;
}

// 当前用户所在团队是否处于「专业版有效期内」
//   · 团队账号本人：直接看自己的订阅状态；
//   · 团队成员（总经理等）：看其 teamId 对应的团队记录；
//   · 试用团队（未订阅 / 订阅已到期）：false —— 这类团队没有「生产方管理」，不能要求先指定生产方。
async function isProTeamOf(env, user) {
  if (!user) return false;
  if (isTeamAdmin(user.role)) return isProTeam(user);
  return isProTeam(await getTeam(env, teamIdOf(user)));
}

// 获取当前登录用户
async function getCurrentUser(request, env) {
  const token = getToken(request);
  if (!token) return null;
  const username = await env.TODO_KV.get(`session:${token}`);
  if (!username) return null;
  const userRaw = await env.TODO_KV.get(`user:${username}`);
  if (!userRaw) return null;
  const user = JSON.parse(userRaw);
  // 团队被停用后，该团队的账号与成员一并失效（超级管理员不受影响）
  // 注：试用账号无限期试用、专业版到期回落为试用，都不会阻止登录
  if (!isSuperAdmin(user.role)) {
    const team = await getTeam(env, teamIdOf(user));
    if (team && team.status === "disabled") return null;
  }
  return user;
}

// ============ 注册邮箱确认码（生成 / 发送 / 校验） ============

// 生成 6 位数字确认码
function genEmailCode() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1000000).padStart(6, "0");
}

// HTML 转义（邮件正文中会带入团队名称等用户填写内容）
function escapeHtml(s) {
  return String(s === undefined || s === null ? "" : s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// 邮箱掩码：zhangsan@example.com → zh******@example.com（界面提示用，不暴露完整邮箱）
function maskEmail(mail) {
  const v = String(mail || "").trim();
  const at = v.lastIndexOf("@");
  if (at <= 0) return v;
  const name = v.slice(0, at);
  const keep = name.slice(0, Math.min(2, name.length));
  return keep + "*".repeat(Math.max(1, name.length - keep.length)) + v.slice(at);
}

// 是否为本地调试请求（localhost / 127.0.0.1）：邮件服务未配置时可在本地回显确认码联调
function isLocalRequest(request) {
  try {
    const host = new URL(request.url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch (e) {
    return false;
  }
}

// 邮件里的时间显示（北京时间，格式 YYYY-MM-DD HH:mm）
function formatMailTime(iso) {
  const t = new Date(iso || Date.now());
  if (Number.isNaN(t.getTime())) return String(iso || "");
  const cn = new Date(t.getTime() + 8 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${cn.getUTCFullYear()}-${p(cn.getUTCMonth() + 1)}-${p(cn.getUTCDate())} ` +
    `${p(cn.getUTCHours())}:${p(cn.getUTCMinutes())}`
  );
}

// 收款二维码图片链接：固定返回最多的槽位（空槽位为 ""），仅保留合法的 http/https 链接
function normalizeQrCodes(raw) {
  const list = Array.isArray(raw) ? raw.slice(0, SUB_QR_MAX) : [];
  const out = [];
  for (let i = 0; i < SUB_QR_MAX; i++) {
    const v = String(list[i] || "").trim();
    out.push(v && v.length <= 300 && !/\s/.test(v) && /^https?:\/\//i.test(v) ? v : "");
  }
  return out;
}

// 抄送列表：过滤空值 / 非法邮箱 / 与收件人重复的地址
function ccListOf(mail) {
  const to = String((mail && mail.to) || "").trim().toLowerCase();
  const raw = mail && mail.cc !== undefined && mail.cc !== null ? mail.cc : [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const item of list) {
    const v = String(item || "").trim();
    if (!v || !EMAIL_RE.test(v)) continue;
    if (v.toLowerCase() === to) continue;
    if (out.some((x) => x.toLowerCase() === v.toLowerCase())) continue;
    out.push(v);
  }
  return out;
}

// 管理员提醒邮箱（团队提交订阅 / 续费申请时抄送）：邮件设置里配置的优先，
// 未配置时依次回退「发件邮箱」→ 全局「忘记密码联系邮箱」
function adminNotifyEmailOf(cfg, g) {
  const candidates = [cfg && cfg.adminNotifyEmail, cfg && cfg.from, g && g.supportEmail];
  for (const c of candidates) {
    const v = String(c || "").trim();
    if (v && EMAIL_RE.test(v)) return v;
  }
  return "";
}

// 读取邮件发送配置（用于发送注册邮箱确认码）：
//   ① SMTP（推荐用 QQ 邮箱）：SMTP_USER（QQ 邮箱地址）+ SMTP_PASS（SMTP 授权码），
//      默认 smtp.qq.com:465（SSL）；587 会自动走 STARTTLS。也支持 QQ_MAIL_USER / QQ_MAIL_PASS 别名；
//   ② Resend：RESEND_API_KEY（HTTP API）；
//   ③ Cloudflare Email Routing 的 send_email 绑定（env.SEND_EMAIL）。
//   以上三种都可用；环境变量优先，其次超级管理员在控制台「邮件设置」里保存的配置（KV: emailSettings）。
async function getMailConfig(env) {
  let saved = {};
  try {
    const raw = await env.TODO_KV.get("emailSettings");
    if (raw) saved = JSON.parse(raw) || {};
  } catch (e) {
    saved = {};
  }
  const apiKey = String(env.RESEND_API_KEY || saved.apiKey || "").trim();
  const fromName = String(env.MAIL_FROM_NAME || saved.fromName || "").trim();
  // SMTP（QQ 邮箱 / 163 / 企业邮箱等）参数
  const smtpHost = String(env.SMTP_HOST || saved.smtpHost || "smtp.qq.com").trim();
  const smtpPort = Number(env.SMTP_PORT || saved.smtpPort || 465) || 465;
  const smtpUser = String(env.SMTP_USER || env.QQ_MAIL_USER || saved.smtpUser || "").trim();
  const smtpPass = String(env.SMTP_PASS || env.QQ_MAIL_PASS || saved.smtpPass || "").trim();
  const fromEnv = String(env.MAIL_FROM || saved.from || "").trim();
  const binding =
    env.SEND_EMAIL && typeof env.SEND_EMAIL.send === "function" ? env.SEND_EMAIL : null;
  // 发件邮箱：优先显式配置；QQ 邮箱要求发件地址与登录账号一致，未填时取 SMTP 账号
  const from = fromEnv || (smtpUser && EMAIL_RE.test(smtpUser) ? smtpUser : "");
  // 服务商优先级：Resend → SMTP（QQ 邮箱） → Cloudflare 邮件绑定
  const provider = apiKey ? "resend" : smtpUser && smtpPass ? "smtp" : binding ? "cloudflare" : "";
  // 订阅 / 续费申请邮件的自定义内容（超级管理员在「邮件设置」中维护）：
  //   adminNotifyEmail：管理员提醒邮箱（团队提交订阅申请时抄送，留空默认用发件邮箱）
  //   subExtraText：自定义文字说明（付款方式、处理时限等）
  //   subQrCodes：收款二维码图片链接（最多 SUB_QR_MAX 个，http/https）
  const adminNotifyEmail = String(env.ADMIN_NOTIFY_EMAIL || saved.adminNotifyEmail || "").trim();
  const subQrCodes = normalizeQrCodes(saved.subQrCodes);
  const source = apiKey
    ? env.RESEND_API_KEY
      ? "env"
      : "kv"
    : smtpUser && smtpPass
      ? env.SMTP_USER || env.SMTP_PASS || env.QQ_MAIL_USER || env.QQ_MAIL_PASS
        ? "env"
        : "kv"
      : binding
        ? "binding"
        : "none";
  return {
    provider,
    apiKey,
    from,
    fromName,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass,
    binding,
    // 订阅 / 续费申请邮件（发给申请人 + 抄送管理员提醒）
    adminNotifyEmail,
    subExtraText: String(saved.subExtraText || "").trim(),
    subQrCodes,
    // 调试模式：不真实发信，直接把确认码回显到页面与日志（仅本地调试 / 演示使用）
    devMode: saved.devMode === true,
    // 配置来源：env=环境变量、kv=控制台保存、binding=Cloudflare 邮件绑定、none=未配置
    source,
  };
}

// UTF-8 字符串 → Base64（用于 SMTP 的 AUTH LOGIN 与邮件正文）
function b64Utf8(str) {
  const bytes = new TextEncoder().encode(String(str === undefined || str === null ? "" : str));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// Base64 折行（每行不超过 76 字符，符合 RFC 2045）
function wrapB64(text) {
  const v = String(text || "");
  const lines = [];
  for (let i = 0; i < v.length; i += 76) lines.push(v.slice(i, i + 76));
  return lines.join("\r\n");
}

// 邮件头编码：含非 ASCII（中文等）时使用 =?UTF-8?B?...?=
function encodeMimeHeader(text) {
  const v = String(text === undefined || text === null ? "" : text);
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${b64Utf8(v)}?=`;
}

// 登录页「忘记密码请联系」的默认邮箱（超级管理员可在「系统设置」中自定义；清空则不显示该提示）
const DEFAULT_SUPPORT_EMAIL = "support@cloudnexus.cn";

// 读取全局设置（KV: settings）：网站名称 + 是否允许新用户注册 + 联系邮箱 + 网站图标
//   allowRegister：**默认允许**（历史数据没有该字段时行为保持不变）；仅超级管理员可修改
async function getGlobalSettings(env) {
  let settings = {};
  try {
    const raw = await env.TODO_KV.get("settings");
    if (raw) settings = JSON.parse(raw) || {};
  } catch (e) {
    settings = {};
  }
  return {
    siteName: settings.siteName || "待办清单",
    allowRegister: settings.allowRegister !== false,
    // 支持邮箱：未设置过 → 默认值；显式设为空字符串 → 登录页不显示该提示
    supportEmail:
      settings.supportEmail === undefined
        ? DEFAULT_SUPPORT_EMAIL
        : String(settings.supportEmail || "").trim(),
    // 网站图标（favicon）图片链接：为空表示使用默认图标（浏览器标签页不额外指定）
    favicon: String(settings.favicon || "").trim(),
  };
}

// 密钥掩码：只显示首尾各 4 位（用于控制台展示已保存的 API Key / 授权码）
function maskKey(v) {
  const s = String(v || "");
  return s ? s.slice(0, 4) + "****" + s.slice(-4) : "";
}

// 「邮件设置」返回给控制台的精简视图（不返回明文密钥）
function mailSettingsView(cfg, env) {
  return {
    // resend=Resend API；smtp=QQ 邮箱等 SMTP 发信；cloudflare=Cloudflare 邮件绑定；""=未配置
    provider: cfg.provider,
    source: cfg.source, // env / kv / binding / none
    from: cfg.from,
    fromName: cfg.fromName,
    hasApiKey: !!cfg.apiKey,
    apiKeyMasked: maskKey(cfg.apiKey),
    smtpHost: cfg.smtpHost,
    smtpPort: cfg.smtpPort,
    smtpUser: cfg.smtpUser,
    hasSmtpPass: !!cfg.smtpPass,
    smtpPassMasked: maskKey(cfg.smtpPass),
    devMode: cfg.devMode,
    // 订阅 / 续费申请邮件（发给申请人 + 抄送管理员提醒）
    adminNotifyEmail: cfg.adminNotifyEmail || "",
    subExtraText: cfg.subExtraText || "",
    subQrCodes: normalizeQrCodes(cfg.subQrCodes).concat("").slice(0, SUB_QR_MAX),
    envApiKey: !!env.RESEND_API_KEY,
    envFrom: !!env.MAIL_FROM,
    envSmtp: !!(env.SMTP_USER || env.SMTP_PASS || env.QQ_MAIL_USER || env.QQ_MAIL_PASS),
  };
}

// 组装邮件内容（multipart/alternative：纯文本 + HTML；正文用 base64 避免中文与超长行问题）
function buildMimeMessage(cfg, mail) {
  const boundary = "cfmail_" + genToken().slice(0, 16);
  const domain = String(cfg.from || "localhost").split("@")[1] || "localhost";
  const fromHeader = cfg.fromName
    ? `${encodeMimeHeader(cfg.fromName)} <${cfg.from}>`
    : `<${cfg.from}>`;
  const cc = ccListOf(mail);
  const headers = [
    `From: ${fromHeader}`,
    `To: <${mail.to}>`,
  ];
  // 抄送（团队提交订阅 / 续费申请时抄送管理员提醒）
  if (cc.length) headers.push(`Cc: ${cc.map((x) => `<${x}>`).join(", ")}`);
  headers.push(
    `Subject: ${encodeMimeHeader(mail.subject || "")}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${genToken()}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ""
  );
  return headers.concat([
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapB64(b64Utf8(mail.text || "")),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapB64(b64Utf8(mail.html || mail.text || "")),
    `--${boundary}--`,
    "",
  ]).join("\r\n");
}

// 超时包装：SMTP 通信整体超时，避免注册请求被卡住
function withTimeout(promise, ms, onTimeout) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        try {
          if (onTimeout) onTimeout();
        } catch (e) {
          /* 忽略 */
        }
        reject(new Error(`连接或响应超时（${Math.round(ms / 1000)} 秒）`));
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// SMTP 失败提示：针对 QQ 邮箱常见错误与运行环境限制给出可操作建议
//   localDev=true 表示当前是本地 wrangler dev（Miniflare 只做明文 TCP，TLS / STARTTLS 必然失败）
function smtpErrorText(err, step, localDev) {
  const raw = err && err.message ? err.message : String(err);
  const code = (raw.match(/\b(\d{3})\b/) || [])[1] || "";
  const localHint =
    "（提示：本地 `wrangler dev` 已支持 SMTP 的 TLS；如持续超时请检查网络 / 端口是否被拦截，或先用「调试模式」联调）";
  let tip = "";
  if (code === "535" || code === "534") {
    tip =
      "（提示：QQ 邮箱必须使用「SMTP 授权码」而不是 QQ 登录密码，并先在 QQ 邮箱「设置 → 账户」中开启 SMTP 服务）";
  } else if (code === "530") {
    tip = "（提示：服务器要求先建立加密连接 —— 465 用 SSL、587 用 STARTTLS）" + (localDev ? localHint : "");
  } else if (code === "550" || code === "553") {
    tip = "（提示：QQ 邮箱要求「发件邮箱」与 SMTP 账号完全一致）";
  } else if (localDev && /secureTransport|starttls|tls|ssl|certificate|handshake|超时|关闭/i.test(raw)) {
    tip = localHint;
  } else if (/starttls must be set|secureTransport/i.test(raw)) {
    tip = "（提示：587 必须先以 STARTTLS 建立连接再升级；若持续失败请把端口改为 465（SSL）重试）";
  } else if (/certificate|tls|ssl|handshake/i.test(raw)) {
    tip = "（提示：端口 465 使用 SSL，端口 587 使用 STARTTLS，请检查服务器 / 端口设置）";
  } else if (/超时/.test(raw)) {
    tip = "（提示：连接超时通常是网络或端口被拦截所致；QQ 邮箱请用 smtp.qq.com 的 465（SSL）或 587（STARTTLS））";
  }
  return `SMTP 发信失败（${step}）：${raw}${tip}`;
}

// 通过 SMTP 发送邮件（QQ 邮箱：smtp.qq.com）
//   465：隐式 TLS（secureTransport: "on"）；587：明文 + STARTTLS 升级
//   先按配置端口尝试，失败时自动改另一个端口再试一次（两种端口 QQ 邮箱都支持）
async function sendViaSmtp(cfg, mail, opts) {
  const port = Number(cfg.smtpPort) || 465;
  const ports = [port];
  if (port === 465) ports.push(587);
  else if (port === 587) ports.push(465);
  // 逐个端口尝试，并汇总每个端口的失败原因（否则用户只能看到最后一次的错误，难以判断）
  const errs = [];
  for (let i = 0; i < ports.length; i++) {
    const res = await smtpAttempt(ports[i], cfg, mail, opts);
    if (res.ok) return res;
    errs.push(ports.length > 1 ? `端口 ${ports[i]}：${res.error}` : res.error);
  }
  return { ok: false, error: errs.join("；") };
}

// 单次 SMTP 尝试（指定端口）
async function smtpAttempt(port, cfg, mail, opts) {
  const host = cfg.smtpHost || "smtp.qq.com";
  const localDev = !!(opts && opts.local);
  const timeoutMs =
    Number(cfg.smtpTimeoutMs) || (localDev ? SMTP_LOCAL_TIMEOUT_MS : SMTP_TIMEOUT_MS);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let socket = null;
  let reader = null;
  let writer = null;
  let buf = "";
  let step = `连接 ${host}:${port}`;

  async function readLine() {
    for (;;) {
      const idx = buf.indexOf("\n");
      if (idx !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        return line.replace(/\r$/, "");
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("连接已被服务器关闭");
      buf += decoder.decode(value, { stream: true });
    }
  }

  // 读取一条完整回复（支持 250-xxx 形式的多行回复）
  async function readReply() {
    let code = 0;
    let text = "";
    for (;;) {
      const line = await readLine();
      if (line.length < 3) continue;
      code = parseInt(line.slice(0, 3), 10) || code;
      text += (text ? " " : "") + line.slice(4).trim();
      if (line.charAt(3) !== "-") break;
    }
    return { code, text };
  }

  // 发送一条 SMTP 命令并校验回复码
  async function send(line, expect) {
    await writer.write(encoder.encode(line + "\r\n"));
    const reply = await readReply();
    if (!expect.includes(reply.code)) {
      throw new Error(`服务器返回 ${reply.code}${reply.text ? " " + reply.text : ""}`);
    }
    return reply;
  }

  async function dialog() {
    // 等待 TCP（含隐式 TLS 时是 TLS 握手）真正建立，这样连接类错误能给出明确原因
    step = `连接 ${host}:${port}`;
    try {
      await socket.opened;
    } catch (e) {
      throw new Error(`建立连接失败：${e && e.message ? e.message : e}`);
    }
    const banner = await readReply();
    if (banner.code !== 220) {
      throw new Error(`服务器返回 ${banner.code} ${banner.text}`);
    }
    // EHLO 参数：默认取「发件邮箱」的域名（比随意的主机名更容易被 QQ 邮箱接受）
    const ehloName =
      cfg.smtpEhlo || String(cfg.from || "").split("@")[1] || "localhost";
    const helo = `EHLO ${ehloName}`;
    await send(helo, [250]);
    if (port === 587) {
      step = "STARTTLS";
      await send("STARTTLS", [220]);
      // ❗ 必须先释放旧 socket 的读 / 写锁，再调用 startTls()：
      //    Cloudflare 会返回一整套新的 readable / writable；
      //    而本地 Miniflare 等实现升级后可能复用同一对流对象，
      //    若此时旧 writer 仍持有锁，取新 writer 会报「This WritableStream is currently locked to a writer」。
      try {
        reader.releaseLock();
      } catch (e) {
        /* 忽略 */
      }
      try {
        writer.releaseLock();
      } catch (e) {
        /* 忽略 */
      }
      socket = socket.startTls();
      buf = "";
      reader = socket.readable.getReader();
      writer = socket.writable.getWriter();
      await send(helo, [250]);
    }
    // AUTH LOGIN：AUTH LOGIN → base64(账号) → base64(授权码)
    step = "身份认证（SMTP 授权码）";
    await send("AUTH LOGIN", [334]);
    await send(b64Utf8(cfg.smtpUser), [334]);
    await send(b64Utf8(cfg.smtpPass), [235]);
    step = "发件地址";
    await send(`MAIL FROM:<${cfg.from}>`, [250]);
    // 收件人 + 抄送（团队提交订阅 / 续费申请时抄送管理员提醒）：
    // SMTP 层面的「抄送」就是多一个 RCPT TO，同时在邮件头里带 Cc
    const rcpts = [mail.to].concat(ccListOf(mail));
    for (let i = 0; i < rcpts.length; i++) {
      step = i === 0 ? "收件地址" : "抄送地址";
      await send(`RCPT TO:<${rcpts[i]}>`, [250, 251]);
    }
    step = "发送邮件正文";
    await send("DATA", [354]);
    // 正文点号转义（行首的 "." 变为 ".."），并以单独一行 "." 结束
    const body = buildMimeMessage(cfg, mail).replace(/\r\n\./g, "\r\n..");
    await writer.write(encoder.encode(`${body}\r\n.\r\n`));
    const done = await readReply();
    if (done.code !== 250) {
      throw new Error(`服务器返回 ${done.code}${done.text ? " " + done.text : ""}`);
    }
    try {
      await send("QUIT", [221]);
    } catch (e) {
      /* QUIT 失败不影响发送结果 */
    }
    return { ok: true, id: "" };
  }

  try {
    // connect() 也可能同步抛错（地址被禁止、参数非法等），因此整体包在 try 里
    // ❗ secureTransport 必须作为 connect() 的「第二个参数（SocketOptions）」传入：
    //    写成地址对象的字段会被运行时忽略（默认 off），结果 465 变成明文连接（服务器等 TLS 握手 → 超时无响应）、
    //    587 调用 startTls() 时直接抛错（must be set to 'starttls'）。
    //    · 465（隐式 SSL）：secureTransport: "on"
    //    · 587（明文起步，EHLO 后 STARTTLS 升级）：secureTransport: "starttls"
    const secureTransport = port === 587 ? "starttls" : "on";
    socket = connect({ hostname: host, port }, { secureTransport });
    reader = socket.readable.getReader();
    writer = socket.writable.getWriter();
    return await withTimeout(dialog(), timeoutMs, () => {
      try {
        socket.close();
      } catch (e) {
        /* 忽略 */
      }
    });
  } catch (e) {
    return { ok: false, error: smtpErrorText(e, step, localDev) };
  } finally {
    try {
      if (socket) socket.close();
    } catch (e) {
      /* 忽略 */
    }
  }
}

// 发送一封邮件：成功返回 { ok: true }，失败返回 { ok: false, error }
//   opts.local=true 表示本地 wrangler dev（Miniflare 只能明文 TCP，SMTP 的 TLS 一定失败 → 提示用调试模式）
async function sendMail(env, cfg, mail, opts) {
  if (!cfg.provider) {
    return {
      ok: false,
      error:
        "邮件服务未配置：请在控制台「邮件设置」中填写 QQ 邮箱 SMTP 账号与授权码（或 Resend API Key）",
    };
  }
  if (!cfg.from) {
    return { ok: false, error: "邮件服务缺少「发件邮箱地址」：请在控制台「邮件设置」中补全后重试" };
  }
  // SMTP（QQ 邮箱：smtp.qq.com:465 + SMTP 授权码）
  if (cfg.provider === "smtp") {
    return sendViaSmtp(cfg, mail, opts);
  }
  if (cfg.provider === "resend") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MAIL_TIMEOUT_MS);
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          Object.assign(
            {
              from: cfg.fromName ? `${cfg.fromName} <${cfg.from}>` : cfg.from,
              to: [mail.to],
              subject: mail.subject,
              text: mail.text,
              html: mail.html,
            },
            // 抄送（订阅 / 续费申请邮件会抄送管理员提醒）
            ccListOf(mail).length ? { cc: ccListOf(mail) } : {}
          )
        ),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          error: `邮件服务返回错误（${res.status}）：${
            data.message || data.error || "请检查 API Key 与发件域名"
          }`,
        };
      }
      return { ok: true, id: data.id || "" };
    } catch (e) {
      return {
        ok: false,
        error: "邮件服务请求失败：" + (e && e.message ? e.message : String(e)),
      };
    } finally {
      clearTimeout(timer);
    }
  }
  // Cloudflare Email Routing 的 send_email 绑定
  try {
    const cc = ccListOf(mail);
    await cfg.binding.send({
      from: cfg.fromName ? { name: cfg.fromName, email: cfg.from } : cfg.from,
      // to 支持单个地址或地址数组：有抄送时一并投递（订阅 / 续费申请邮件抄送管理员提醒）
      to: cc.length ? [mail.to].concat(cc) : mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    return { ok: true, id: "" };
  } catch (e) {
    return { ok: false, error: "邮件发送失败：" + (e && e.message ? e.message : String(e)) };
  }
}

// 邮箱确认码邮件内容（主题 / 纯文本 / HTML）
async function verifyCodeMailBody(env, user, code) {
  let siteName = "待办清单";
  try {
    const raw = await env.TODO_KV.get("settings");
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.siteName) siteName = s.siteName;
    }
  } catch (e) {
    /* 忽略 */
  }
  const teamName = user.teamName || user.username;
  const subject = `【${siteName}】邮箱确认码 ${code}（10 分钟内有效）`;
  const text = [
    `${teamName}，您好：`,
    "",
    `您正在注册「${siteName}」的团队账号（登录名：${user.username}）。`,
    `邮箱确认码：${code}`,
    "有效期：10 分钟。",
    "",
    "请在注册 / 登录页面输入上面的确认码完成验证，验证通过后即可正常登录。",
    "若非本人操作，请忽略本邮件：验证通过前该账号无法登录。",
    "",
    siteName,
  ].join("\n");
  const html = `<div style="font-family:-apple-system,'Microsoft YaHei',sans-serif;font-size:14px;color:#37352f;line-height:1.7">` +
    `<p>${escapeHtml(teamName)}，您好：</p>` +
    `<p>您正在注册「${escapeHtml(siteName)}」的团队账号（登录名：<b>${escapeHtml(
      user.username
    )}</b>）。</p>` +
    `<p>邮箱确认码：</p>` +
    `<p style="font-size:26px;font-weight:700;letter-spacing:6px;color:#2383e2;margin:8px 0">${code}</p>` +
    `<p>有效期 <b>10 分钟</b>。请在注册 / 登录页面输入该确认码完成验证，验证通过后即可正常登录。</p>` +
    `<p style="color:#9b9a97;font-size:12px">若非本人操作，请忽略本邮件：验证通过前该账号无法登录。</p>` +
    `</div>`;
  return { subject, text, html };
}

// 订阅 / 续费申请邮件内容（主题 / 纯文本 / HTML）：
//   收件人 = 申请人（团队账号邮箱），抄送 = 管理员提醒邮箱；
//   正文 = 申请人信息 + 订阅套餐信息 + 超级管理员在「邮件设置」里维护的自定义说明与收款二维码
async function subscribeRequestMailBody(env, team, req, cfg, kind) {
  let siteName = "待办清单";
  try {
    const raw = await env.TODO_KV.get("settings");
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.siteName) siteName = s.siteName;
    }
  } catch (e) {
    /* 忽略 */
  }
  const isRenew = kind === "renew";
  const kindText = isRenew ? "续费申请" : "订阅申请";
  const teamName = team.teamName || team.username;
  const plan = req && req.plan ? req.plan : null;
  const planText = plan
    ? `${plan.term}（￥${plan.price} / ${plan.days} 天）`
    : "未选择套餐";
  const atText = formatMailTime(req && req.at ? req.at : new Date().toISOString());
  const extraText = String((cfg && cfg.subExtraText) || "").trim();
  const qrs = normalizeQrCodes(cfg && cfg.subQrCodes).filter(Boolean);
  const subject = `【${siteName}】${kindText}已收到：${teamName} · ${planText}`;

  // ---- 纯文本 ----
  const lines = [
    `${teamName}，您好：`,
    "",
    `我们已收到您的「${kindText}」，信息如下（本邮件已同步抄送管理员）：`,
    "",
    "【申请人信息】",
    `团队名称：${teamName}`,
    `登录账号：${team.username}`,
    `联系人：${team.contact || "（未填写）"}`,
    `联系邮箱：${team.email || "（未填写）"}`,
    `提交时间：${atText}`,
    "",
    "【订阅套餐】",
    `申请类型：${kindText}`,
    `套餐：${planText}`,
    `留言：${(req && req.note) || "（无）"}`,
    "",
  ];
  if (extraText) lines.push("【说明】", extraText, "");
  if (qrs.length) {
    lines.push("【收款二维码】");
    qrs.forEach((u, i) => lines.push(`二维码 ${i + 1}：${u}`));
    lines.push("");
  }
  lines.push(
    "提交后由超级管理员为您开通；开通成功后即可使用成员 / 生产方 / 客户管理等全部功能。",
    "如需补充信息，可在系统内重新提交申请（会覆盖上一次）。",
    "",
    siteName
  );
  const text = lines.join("\n");

  // ---- HTML ----
  const row = (k, v) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#6b6b68;white-space:nowrap">${escapeHtml(k)}</td>` +
    `<td style="padding:4px 0;color:#37352f">${escapeHtml(v)}</td></tr>`;
  const extraHtml = extraText
    ? `<div style="margin:14px 0 6px;font-weight:600">说明</div>` +
      `<div style="background:#f7f7f5;border-radius:8px;padding:12px;white-space:pre-wrap">${escapeHtml(extraText)}</div>`
    : "";
  const qrHtml = qrs.length
    ? `<div style="margin:16px 0 6px;font-weight:600">收款二维码</div>` +
      qrs
        .map(
          (u, i) =>
            `<div style="display:inline-block;margin:0 12px 12px 0;text-align:center;vertical-align:top">` +
            `<img src="${escapeHtml(u)}" alt="收款二维码 ${i + 1}" style="width:180px;height:180px;object-fit:contain;border:1px solid #e9e9e7;border-radius:8px;background:#fff">` +
            `<div style="font-size:12px;color:#6b6b68;margin-top:4px">二维码 ${i + 1}</div></div>`
        )
        .join("")
    : "";
  const html =
    `<div style="font-family:-apple-system,'Microsoft YaHei',sans-serif;font-size:14px;color:#37352f;line-height:1.7">` +
    `<p>${escapeHtml(teamName)}，您好：</p>` +
    `<p>我们已收到您的「<b>${escapeHtml(kindText)}</b>」，信息如下（本邮件已同步抄送管理员）：</p>` +
    `<div style="margin:10px 0 6px;font-weight:600">申请人信息</div>` +
    `<table style="border-collapse:collapse;font-size:14px">` +
    row("团队名称", teamName) +
    row("登录账号", team.username) +
    row("联系人", team.contact || "（未填写）") +
    row("联系邮箱", team.email || "（未填写）") +
    row("提交时间", atText) +
    `</table>` +
    `<div style="margin:14px 0 6px;font-weight:600">订阅套餐</div>` +
    `<table style="border-collapse:collapse;font-size:14px">` +
    row("申请类型", kindText) +
    row("套餐", planText) +
    row("留言", (req && req.note) || "（无）") +
    `</table>` +
    extraHtml +
    qrHtml +
    `<p style="margin-top:16px;color:#6b6b68;font-size:13px">提交后由超级管理员为您开通；开通成功后即可使用成员 / 生产方 / 客户管理等全部功能。<br>如需补充信息，可在系统内重新提交申请（会覆盖上一次）。</p>` +
    `</div>`;
  return { subject, text, html };
}

// 生成并发送邮箱确认码（服务端只保存确认码的哈希，10 分钟有效）
// 返回 { ok: true, sentAt, devCode } 或 { ok: false, error }
async function issueVerifyCode(env, user, request) {
  const cfg = await getMailConfig(env);
  // 调试模式：超级管理员开启 devMode，或本地访问且尚未配置邮件服务（确认码回显到页面与日志）
  const debug = cfg.devMode || (!cfg.provider && isLocalRequest(request));
  if (!cfg.provider && !debug) {
    return {
      ok: false,
      error: "邮件服务未配置：请联系超级管理员在控制台「邮件设置」中配置发件服务后再试",
    };
  }
  if (cfg.provider && !cfg.from) {
    return { ok: false, error: "邮件服务缺少「发件邮箱地址」：请先联系超级管理员补全配置" };
  }
  if (!user.email) {
    return { ok: false, error: "该账号没有可用的注册邮箱，请重新注册" };
  }
  // 发送频率限制（同一账号）：1 分钟内不重复发送、1 小时内最多 5 次
  const now = Date.now();
  const rateKey = `mailrate:${user.username}`;
  let rate = null;
  try {
    const raw = await env.TODO_KV.get(rateKey);
    rate = raw ? JSON.parse(raw) : null;
  } catch (e) {
    rate = null;
  }
  const inWindow = !!(rate && now - Number(rate.windowStart || 0) < 60 * 60 * 1000);
  if (inWindow) {
    const waitMs = CODE_RESEND_SEC * 1000 - (now - Number(rate.lastSentAt || 0));
    if (waitMs > 0) {
      const waitSec = Math.ceil(waitMs / 1000);
      return { ok: false, error: `确认码刚发送过，请 ${waitSec} 秒后再点「重新发送确认码」` };
    }
    if (Number(rate.count || 0) >= CODE_MAX_PER_HOUR) {
      return { ok: false, error: "发送过于频繁（1 小时内最多 5 次），请稍后再试" };
    }
  }
  const code = genEmailCode();
  if (debug) {
    console.log(
      `[邮箱确认码] ${user.username} <${user.email}> 确认码：${code}（调试模式，未真实发送邮件）`
    );
  } else {
    const body = await verifyCodeMailBody(env, user, code);
    const sent = await sendMail(env, cfg, { to: user.email, ...body }, { local: isLocalRequest(request) });
    if (!sent.ok) return { ok: false, error: sent.error };
  }
  // 确认码记录：只保存哈希，10 分钟后自动过期（KV 过期即失效）
  await env.TODO_KV.put(
    `emailcode:${user.username}`,
    JSON.stringify({
      codeHash: await hashPassword(code),
      email: user.email || "",
      sentAt: now,
      attempts: 0,
    }),
    { expirationTtl: CODE_TTL_SEC }
  );
  const nextRate = inWindow
    ? { windowStart: rate.windowStart, count: Number(rate.count || 0) + 1, lastSentAt: now }
    : { windowStart: now, count: 1, lastSentAt: now };
  await env.TODO_KV.put(rateKey, JSON.stringify(nextRate), {
    expirationTtl: Math.max(
      60,
      Math.ceil((60 * 60 * 1000 - (now - Number(nextRate.windowStart))) / 1000)
    ),
  });
  return { ok: true, sentAt: now, devCode: debug ? code : "" };
}

// 登录时使用：已有未过期的确认码就不再重发，否则补发一封
async function ensureVerifyCode(env, user, request) {
  try {
    const raw = await env.TODO_KV.get(`emailcode:${user.username}`);
    if (raw) {
      const rec = JSON.parse(raw);
      if (CODE_TTL_SEC * 1000 - (Date.now() - Number(rec.sentAt || 0)) > 0) {
        return { ok: true, resent: false, sentAt: rec.sentAt, devCode: "" };
      }
    }
  } catch (e) {
    /* 记录异常则重新发送 */
  }
  const issued = await issueVerifyCode(env, user, request);
  return issued.ok
    ? { ok: true, resent: true, sentAt: issued.sentAt, devCode: issued.devCode }
    : { ok: false, error: issued.error };
}

// 校验邮箱确认码：返回 { ok: true } 或 { ok: false, error }
async function checkVerifyCode(env, user, code) {
  const key = `emailcode:${user.username}`;
  const input = String(code || "").trim();
  if (!input) return { ok: false, error: "请输入邮箱确认码" };
  const raw = await env.TODO_KV.get(key);
  if (!raw) return { ok: false, error: "确认码已失效，请点击「重新发送确认码」重新获取" };
  let rec = null;
  try {
    rec = JSON.parse(raw);
  } catch (e) {
    rec = null;
  }
  if (!rec || !rec.codeHash) {
    await env.TODO_KV.delete(key);
    return { ok: false, error: "确认码已失效，请点击「重新发送确认码」重新获取" };
  }
  if (Date.now() - Number(rec.sentAt || 0) > CODE_TTL_SEC * 1000) {
    await env.TODO_KV.delete(key);
    return { ok: false, error: "确认码已过期（有效期 10 分钟），请点击「重新发送确认码」" };
  }
  if (Number(rec.attempts || 0) >= CODE_MAX_ATTEMPTS) {
    await env.TODO_KV.delete(key);
    return { ok: false, error: "确认码错误次数过多，请点击「重新发送确认码」重新获取" };
  }
  if ((await hashPassword(input)) !== rec.codeHash) {
    rec.attempts = Number(rec.attempts || 0) + 1;
    const remain = CODE_MAX_ATTEMPTS - rec.attempts;
    if (remain <= 0) {
      await env.TODO_KV.delete(key);
      return { ok: false, error: "确认码错误次数过多，请点击「重新发送确认码」重新获取" };
    }
    await env.TODO_KV.put(key, JSON.stringify(rec), { expirationTtl: CODE_TTL_SEC });
    return { ok: false, error: `确认码不正确，请检查后重试（还可尝试 ${remain} 次）` };
  }
  return { ok: true };
}

// 登录成功：建立会话（7 天）并返回带 Cookie 的响应
async function loginResponse(env, user) {
  const token = genToken();
  await env.TODO_KV.put(`session:${token}`, user.username, {
    expirationTtl: 60 * 60 * 24 * 7,
  });
  return new Response(JSON.stringify({ ok: true, username: user.username, role: user.role }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": `token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
        60 * 60 * 24 * 7
      }`,
    },
  });
}

// 初始化默认超级管理员（admin/admin）：首次创建，历史数据自动升级角色
async function ensureSuperAdmin(env) {
  const existing = await env.TODO_KV.get("user:admin");
  if (!existing) {
    const admin = {
      username: "admin",
      password: await hashPassword("admin"),
      role: "superadmin",
      createdAt: new Date().toISOString(),
    };
    await env.TODO_KV.put("user:admin", JSON.stringify(admin));
    return;
  }
  const admin = JSON.parse(existing);
  // 原「管理员 admin」升级为「超级管理员」
  if (admin.role === "admin") {
    admin.role = "superadmin";
    await env.TODO_KV.put("user:admin", JSON.stringify(admin));
  }
}

// 获取某团队的所有成员列表（团队管理员在「成员管理」中维护）
// 生产方 / 客户登录账号在各自的管理弹窗中维护；团队管理员与超级管理员不出现在成员列表里
async function listUsers(env, teamId) {
  const list = await env.TODO_KV.list({ prefix: "user:" });
  const users = [];
  for (const key of list.keys) {
    const raw = await env.TODO_KV.get(key.name);
    if (raw) {
      const u = JSON.parse(raw);
      if (u.role === "producer" || u.role === "customer") continue;
      if (isSuperAdmin(u.role) || isTeamAdmin(u.role)) continue;
      if (teamIdOf(u) !== teamId) continue;
      const record = {
        username: u.username,
        role: u.role,
        createdAt: u.createdAt,
        remark: u.remark || "",
        // 部门（仅「生产部」类角色有值：生产部 / 计划部 / 采购部 / 品质部 / 财务部）
        dept: u.dept || "",
        // 生产单下单权限（团队管理员在「成员管理」里可逐个开关）
        canPlaceOrder: canPlaceOrder(u),
        // 采购订单下单权限（补填 / 打开采购文件链接；与「客户订单录入」相互独立）
        canPurchase: canPurchaseOrder(u),
      };
      // 生产部（含计划部 / 采购部 / 品质部 / 财务部）附带「可观察生产方」id 列表
      if (u.role === "restricted") {
        record.watched = await getWatchProducers(env, u.username);
      }
      // 站内消息：该成员未读的 @ 提醒数（团队管理员在「成员管理」中可见其登录名左侧的红点）
      record.mentionsUnread = await unreadMentionCount(env, u.username);
      users.push(record);
    }
  }
  return users;
}

// 获取某成员记录（用于校验「操作对象是否属于本团队」）
async function getTeamMember(env, username, teamId) {
  const raw = await env.TODO_KV.get(`user:${username}`);
  if (!raw) return null;
  const u = JSON.parse(raw);
  if (isSuperAdmin(u.role)) return null;
  if (teamIdOf(u) !== teamId) return null;
  return u;
}

// 获取所有团队用户（超级管理员控制台使用）
async function listTeams(env) {
  const list = await env.TODO_KV.list({ prefix: "user:" });
  const teams = [];
  for (const key of list.keys) {
    const raw = await env.TODO_KV.get(key.name);
    if (!raw) continue;
    const u = JSON.parse(raw);
    if (!isTeamAdmin(u.role)) continue;
    teams.push({
      username: u.username,
      teamName: u.teamName || u.username,
      contact: u.contact || "",
      email: u.email || "",
      remark: u.remark || "",
      plan: isProPlan(u) ? "pro" : "trial",
      pro: isProTeam(u), // 专业版有效期内：拥有全部功能
      status: teamStatusOf(u),
      rawStatus: u.status || "active",
      // 注册邮箱确认状态：emailVerified === false 表示尚未输入确认码（历史账号无该字段视为已确认）
      emailVerified: u.emailVerified !== false,
      emailVerifiedAt: u.emailVerifiedAt || "",
      trialEndsAt: u.trialEndsAt || "",
      // 试用账号为无限期试用（无到期时间），这里留空由前端显示「无限期」
      expiresAt: isProPlan(u) ? u.expiresAt || "" : "",
      createdAt: u.createdAt,
      renewedAt: u.renewedAt || "",
      // 团队提交的订阅 / 续费申请（超级管理员开通后自动清除）
      subscribeRequest: subscribeRequestOf(u),
    });
  }
  // 有「订阅 / 续费申请」的团队排在最前面，便于超级管理员优先处理
  teams.sort((a, b) => {
    const ar = a.subscribeRequest && a.subscribeRequest.at ? 1 : 0;
    const br = b.subscribeRequest && b.subscribeRequest.at ? 1 : 0;
    if (ar !== br) return br - ar;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
  return teams;
}

// 获取某用户的待办列表
async function getTodos(env, username) {
  const raw = await env.TODO_KV.get(`todos:${username}`);
  return raw ? JSON.parse(raw) : [];
}

// 保存某用户的待办列表
async function saveTodos(env, username, todos) {
  await env.TODO_KV.put(`todos:${username}`, JSON.stringify(todos));
}

// 获取某成员的客户列表
async function getCustomers(env, username) {
  const raw = await env.TODO_KV.get(`customers:${username}`);
  return raw ? JSON.parse(raw) : [];
}

// 保存某成员的客户列表
async function saveCustomers(env, username, customers) {
  await env.TODO_KV.put(`customers:${username}`, JSON.stringify(customers));
}

// 获取本团队客户列表（「客户管理」维护；成员管理中为「业务部」分配客户时从这里选择）
// 历史数据（默认团队）落在旧 key "customerList" 上，保持兼容
async function getCustomerList(env, teamId) {
  const key = !teamId || teamId === DEFAULT_TEAM ? "customerList" : `customerList:${teamId}`;
  const raw = await env.TODO_KV.get(key);
  return raw ? JSON.parse(raw) : [];
}

// 保存本团队客户列表
async function saveCustomerList(env, teamId, list) {
  const key = !teamId || teamId === DEFAULT_TEAM ? "customerList" : `customerList:${teamId}`;
  await env.TODO_KV.put(key, JSON.stringify(list));
}

// 试用团队账号添加订单时手工填写的客户名称：自动记入「本人客户列表」与「团队客户列表」，
// 便于订阅为专业版后在「客户管理」中看到并分配给业务部（不会自动创建客户登录账号）
async function rememberTrialCustomer(env, user, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return;
  const own = await getCustomers(env, user.username);
  if (!own.some((c) => c.name === trimmed)) {
    own.push({
      id: genToken().slice(0, 12),
      name: trimmed,
      createdAt: new Date().toISOString(),
    });
    await saveCustomers(env, user.username, own);
  }
  const teamId = teamIdOf(user);
  const list = await getCustomerList(env, teamId);
  if (!list.some((c) => c.name === trimmed)) {
    list.push({
      id: genToken().slice(0, 12),
      name: trimmed,
      description: "",
      createdAt: new Date().toISOString(),
    });
    await saveCustomerList(env, teamId, list);
  }
}

// 生产方性质：self=自产（默认）/ purchased=外购
// 历史数据没有该字段时统一按「自产」处理（生产方列表里可直接切换）
const PRODUCER_NATURES = ["self", "purchased"];
const PRODUCER_NATURE_DEFAULT = "self";

function normalizeProducerNature(raw) {
  const v = String(raw === undefined || raw === null ? "" : raw).trim();
  return PRODUCER_NATURES.includes(v) ? v : PRODUCER_NATURE_DEFAULT;
}

// 获取本团队生产方列表（团队内共享，团队所有成员可见）
// 兼容历史数据：早期字段名为 shortName，现统一为 username（同时作为生产方登录账号）
async function getProducers(env, teamId) {
  const key = !teamId || teamId === DEFAULT_TEAM ? "producers" : `producers:${teamId}`;
  const raw = await env.TODO_KV.get(key);
  const list = raw ? JSON.parse(raw) : [];
  return list.map((p) => ({
    id: p.id,
    username: p.username || p.shortName || "",
    description: p.description || "",
    nature: normalizeProducerNature(p.nature),
    createdAt: p.createdAt,
  }));
}

// 保存本团队生产方列表
async function saveProducers(env, teamId, producers) {
  const key = !teamId || teamId === DEFAULT_TEAM ? "producers" : `producers:${teamId}`;
  await env.TODO_KV.put(key, JSON.stringify(producers));
}

// 获取某生产部「可观察的生产方」id 列表
async function getWatchProducers(env, username) {
  const raw = await env.TODO_KV.get(`watch:${username}`);
  return raw ? JSON.parse(raw) : [];
}

// 保存某生产部「可观察的生产方」id 列表
async function saveWatchProducers(env, username, ids) {
  await env.TODO_KV.put(`watch:${username}`, JSON.stringify(ids));
}

// ============ 站内消息（备注中的 @提及） ============
// 在待办的下拉备注区输入「@」会列出本团队人员；选中后提交的备注会 @ 到该成员，
// 被 @ 的成员会收到一条站内消息：其「登录名左侧」出现带数字的红色角标
// （数字 = 未读 @ 次数，超过 9 显示「9+」）。
// 数据存 KV：mentions:<用户名> = 提醒记录数组（最新在前）
const MENTION_KEEP = 50; // 每个用户最多保留的提醒条数

// 解析文本中的 @提及（@ 后跟 3~20 位字母 / 数字 / _ . -，与用户名规则一致）
function parseMentions(text) {
  const names = new Set();
  const re = /@([A-Za-z0-9_.-]{3,20})/g;
  const s = String(text || "");
  let m;
  while ((m = re.exec(s)) !== null) names.add(m[1]);
  return [...names];
}

// 本团队「可被 @ 的人员」：团队账号本人 + 本团队所有成员
// （生产方 / 客户属外部账号，不参与站内消息）
async function listMentionable(env, teamId) {
  const list = [];
  const team = await getTeam(env, teamId);
  if (team) {
    list.push({
      username: team.username,
      role: team.role,
      isTeamAdmin: true,
      label: team.teamName || team.username,
    });
  }
  const members = await listUsers(env, teamId);
  for (const m of members) {
    list.push({
      username: m.username,
      role: m.role,
      dept: m.dept || "",
      isTeamAdmin: false,
      label: m.username,
    });
  }
  return list;
}

// 某用户的站内消息（@提及提醒），最新在前
async function getMentions(env, username) {
  const raw = await env.TODO_KV.get(`mentions:${username}`);
  return raw ? JSON.parse(raw) : [];
}

// 保存某用户的站内消息（最多保留 MENTION_KEEP 条）
async function saveMentions(env, username, list) {
  await env.TODO_KV.put(
    `mentions:${username}`,
    JSON.stringify(list.slice(0, MENTION_KEEP))
  );
}

// 某用户站内消息的统计：unread=未读条数、total=总条数
async function mentionStats(env, username) {
  const list = await getMentions(env, username);
  return {
    unread: list.filter((m) => !m.read).length,
    total: list.length,
  };
}

// 某用户未读的 @ 提醒数
async function unreadMentionCount(env, username) {
  return (await mentionStats(env, username)).unread;
}

// 为被 @ 的成员写入站内消息提醒（同一条备注里重复 @ 同一人只记 1 次）
async function addMentionRecords(env, author, mentions, ctx) {
  if (!mentions || !mentions.length) return;
  const at = new Date().toISOString();
  for (const name of mentions) {
    const list = await getMentions(env, name);
    list.unshift({
      id: genToken().slice(0, 12),
      from: author.username, // 谁 @ 的
      todoId: ctx.todoId, // 出现在哪条待办
      todoTitle: ctx.todoTitle || "",
      todoOwner: ctx.owner || "", // 待办归属（点击提醒时定位用）
      text: ctx.text || "",
      at,
      read: false,
    });
    await saveMentions(env, name, list);
  }
}

// 「生产部」类部门（role = restricted）：**功能与生产部完全相同**，只是显示名称不同
//   成员记录上以 dept 字段区分（生产部 / 计划部 / 采购部 / 品质部 / 财务部）
//   权限判断一律仍按 role === "restricted" 处理，因此新增部门不影响任何既有逻辑
const DEPT_LABELS = ["生产部", "计划部", "采购部", "品质部", "财务部"];
const DEFAULT_DEPT = "生产部";

function normalizeDept(raw, role) {
  if (role !== "restricted") return "";
  const v = String(raw === undefined || raw === null ? "" : raw).trim();
  return DEPT_LABELS.includes(v) ? v : DEFAULT_DEPT;
}

// 角色名称
const ROLE_LABEL = {
  superadmin: "超级管理员",
  team: "团队管理员",
  editor: "业务部",
  viewer: "业务主管",
  restricted: "生产部",
  producer: "生产方",
  customer: "客户",
  superviewer: "总经理",
};

function roleLabel(role) {
  return ROLE_LABEL[role] || role || "";
}

// 成员的角色名称：属于「生产部」类部门时优先显示具体部门（计划部 / 采购部 / 品质部 / 财务部）
function memberRoleLabel(u) {
  if (!u) return "";
  return u.dept || ROLE_LABEL[u.role] || u.role || "";
}

// 观察类角色（业务主管 / 生产部 / 生产方 / 客户）：只读，但可添加备注
function isObserverRole(role) {
  return (
    role === "viewer" ||
    role === "restricted" ||
    role === "producer" ||
    role === "customer"
  );
}

// 生产单下单权限（团队管理员可在「成员管理」里对每个成员逐个开关）：
//   · 团队管理员本人固定「有」；
//   · 「品质部 / 财务部」成员（restricted + dept）不需要下生产单：固定「无」，
//     成员管理清单里也不再显示该开关（见 NO_ORDER_DEPTS）；
//   · 其他成员以 user.canPlaceOrder 为准（true=有 / false=无）；
//   · 未设置过的成员按角色默认：业务部=有，其他角色=无（与历史行为一致）。
// 注：业务部成员在「成员管理」里的开关文案显示为「客户订单录入」（含义与保存逻辑不变）。
const NO_ORDER_DEPTS = ["品质部", "财务部"]; // 这两个部门不需要「生产单下单权限」

// 是否属于「不需要下生产单」的部门成员（品质部 / 财务部）
function needsNoOrderPerm(user) {
  return !!user && user.role === "restricted" && NO_ORDER_DEPTS.includes(user.dept || "");
}

// 权限名称（界面文案）：业务部显示为「客户订单录入」，其他角色仍是「生产单下单权限」
function orderPermLabel(user) {
  const role = user && user.role;
  return role === "editor" || role === "member" ? "客户订单录入" : "生产单下单权限";
}

function canPlaceOrder(user) {
  if (!user) return false;
  if (isTeamAdmin(user.role)) return true;
  if (needsNoOrderPerm(user)) return false;
  if (typeof user.canPlaceOrder === "boolean") return user.canPlaceOrder;
  return user.role === "editor" || user.role === "member";
}

// 采购订单下单权限（订单行上黄色「自产单 / 外购单」标签：补填 / 打开采购文件链接）：
//   · 团队管理员本人固定「有」；
//   · 「品质部 / 财务部」固定「无」；
//   · 其他成员以 user.canPurchase 为准（true=有 / false=无）；
//   · 未设置过时按历史行为：与其「客户订单录入」保持一致（业务部=有，其他角色=无）。
// 与「客户订单录入」是两个独立开关：录入订单、补填采购文件链接互不影响。
function canPurchaseOrder(user) {
  if (!user) return false;
  if (isTeamAdmin(user.role)) return true;
  if (needsNoOrderPerm(user)) return false;
  if (typeof user.canPurchase === "boolean") return user.canPurchase;
  return canPlaceOrder(user);
}

// 待办管理权限：团队管理员 / 总经理（总经理拥有团队管理员的全部待办相关功能：
// 查看本团队所有用户的待办、改变状态、指定生产方、修改待确认待办、删除待办），
// 但不具备「团队设置 / 成员管理 / 生产方管理 / 客户管理」这些管理功能。
function canManageTodos(role) {
  return isTeamAdmin(role) || role === "superviewer";
}


// 获取本团队所有用户的待办
// onlyVisible=true 时仅返回「进行中/已完成」的待办（业务主管可见范围）
// producerIds 非空时仅返回指定生产方的待办（生产部可见范围）
async function getAllTodos(env, teamId, onlyVisible = false, producerIds = null) {
  const list = await env.TODO_KV.list({ prefix: "todos:" });
  const owners = list.keys.map((key) => key.name.replace("todos:", ""));
  // 先一次性取回所有录入者的记录，用于按团队过滤（历史数据无 teamId → 默认团队）
  const ownerUsers = await Promise.all(
    owners.map(async (owner) => {
      const raw = await env.TODO_KV.get(`user:${owner}`);
      return raw ? JSON.parse(raw) : null;
    })
  );
  const result = [];
  for (let i = 0; i < owners.length; i++) {
    const ownerUser = ownerUsers[i];
    // 没有账号（已删除的成员）或不属于本团队 → 不可见
    if (!ownerUser || teamIdOf(ownerUser) !== teamId) continue;
    const raw = await env.TODO_KV.get(list.keys[i].name);
    const todos = raw ? JSON.parse(raw) : [];
    for (const t of todos) {
      const status = t.status || (t.done ? "done" : "pending");
      // 业务主管只能看到非「待确认」的待办
      if (onlyVisible && status === "pending") continue;
      // 生产部：只能看到被授权生产方的待办
      if (producerIds && !producerIds.includes(t.producerId)) continue;
      result.push({ ...t, status, owner: owners[i] });
    }
  }
  // 按创建时间倒序
  result.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return result;
}

// 收集某团队下的全部账号（团队账号本人 + 成员 + 生产方 / 客户登录账号）
// 超级管理员不属于任何团队，不会被收集；用于「彻底删除团队用户」时一并清理
async function listTeamAccounts(env, teamId) {
  const list = await env.TODO_KV.list({ prefix: "user:" });
  const accounts = [];
  for (const key of list.keys) {
    const raw = await env.TODO_KV.get(key.name);
    if (!raw) continue;
    let u = null;
    try {
      u = JSON.parse(raw);
    } catch (e) {
      continue;
    }
    if (!u || isSuperAdmin(u.role)) continue;
    if (teamIdOf(u) !== teamId) continue;
    accounts.push({ username: u.username || key.name.replace(/^user:/, ""), role: u.role });
  }
  return accounts;
}

// 删除某个账号的全部数据（账号本身 + 待办 / 客户 / 可观察生产方 / 站内消息 / 邮箱确认码 / 发信频率）
// 返回 { todos }：该账号名下被清除的待办条数（供界面提示用）
async function deleteAccountData(env, username) {
  let todos = 0;
  const raw = await env.TODO_KV.get(`todos:${username}`);
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      todos = Array.isArray(arr) ? arr.length : 0;
    } catch (e) {
      todos = 0;
    }
  }
  await env.TODO_KV.delete(`user:${username}`);
  await env.TODO_KV.delete(`todos:${username}`);
  await env.TODO_KV.delete(`customers:${username}`);
  await env.TODO_KV.delete(`watch:${username}`);
  await env.TODO_KV.delete(`mentions:${username}`);
  await env.TODO_KV.delete(`emailcode:${username}`);
  await env.TODO_KV.delete(`mailrate:${username}`);
  return { todos };
}

// ============ 路由处理 ============

async function handleApi(request, env, pathname) {
  const method = request.method;

  // ---- 登录 ----
  if (pathname === "/api/login" && method === "POST") {
    await ensureSuperAdmin(env);
    const { username, password } = await readBody(request);
    if (!username || !password) {
      return json({ error: "请输入用户名和密码" }, 400);
    }
    const raw = await env.TODO_KV.get(`user:${username}`);
    if (!raw) return json({ error: "用户名或密码错误" }, 401);
    const user = JSON.parse(raw);
    const hashed = await hashPassword(password);
    if (hashed !== user.password) {
      return json({ error: "用户名或密码错误" }, 401);
    }
    // 团队用户：被停用后不允许登录（超级管理员不受影响）
    // 试用账号无限期试用；专业版订阅到期后回落为试用（受限）状态，仍可正常登录
    if (!isSuperAdmin(user.role)) {
      const team = await getTeam(env, teamIdOf(user));
      if (team && teamStatusOf(team) === "disabled") {
        return json({ error: "该账户已被停用，请联系超级管理员开通" }, 403);
      }
    }
    // 新注册的团队账号：必须先完成注册邮箱确认（确认码由注册时发送到邮箱）
    //   未确认时不下发会话，只提示到邮箱取确认码，验证通过后才允许正常登录
    if (user.role === "team" && user.emailVerified === false) {
      const issued = await ensureVerifyCode(env, user, request);
      return json({
        ok: false,
        needVerify: true,
        username: user.username,
        email: maskEmail(user.email || ""),
        codeTtlSec: CODE_TTL_SEC,
        resendAfterSec: CODE_RESEND_SEC,
        devCode: issued.devCode || undefined,
        sendError: issued.ok ? undefined : issued.error,
        message: issued.ok
          ? `确认码${issued.resent ? "已重新发送" : "已发送"}至注册邮箱，请在 ${Math.floor(
              CODE_TTL_SEC / 60
            )} 分钟内输入完成确认`
          : "确认码发送失败，请稍后点「重新发送确认码」重试",
      });
    }
    // 邮箱已确认（或无需确认的角色）：建立会话（7 天）
    return loginResponse(env, user);
  }

  // ---- 新帐户注册：申请为团队用户 ----
  // 注册提交后系统立即向「注册时填写的邮箱」发送 6 位确认码（10 分钟有效）；
  // 注册人需在登录页输入邮件中的确认码完成邮箱确认，确认通过后才允许正常登录（注册时不再直接登录）。
  if (pathname === "/api/register" && method === "POST") {
    await ensureSuperAdmin(env);
    // 系统已关闭新用户注册（超级管理员在「系统设置」中取消勾选「允许新用户注册」）
    const globalSettings = await getGlobalSettings(env);
    if (!globalSettings.allowRegister) {
      return json({ error: "系统当前已关闭新用户注册，如需开通请联系超级管理员" }, 403);
    }
    const { teamName, username, email, password, confirmPassword, contact, remark } =
      await readBody(request);
    const uname = (username || "").trim();
    const tname = (teamName || "").trim();
    const mail = String(email || "").trim();
    const pwd = String(password || "");
    if (!tname) return json({ error: "请输入团队名称" }, 400);
    if (!uname) return json({ error: "请输入登录用户名" }, 400);
    if (!/^[A-Za-z0-9_.-]{3,20}$/.test(uname)) {
      return json({ error: "用户名为 3~20 位字母、数字、下划线、点或短横线" }, 400);
    }
    if (uname === "admin") return json({ error: "该用户名不可用，请更换" }, 400);
    // 邮箱：必填项（用于接收注册确认码，也便于超级管理员与团队联系）
    if (!mail) return json({ error: "请输入邮箱" }, 400);
    if (mail.length > 60) return json({ error: "邮箱长度不能超过 60 个字符" }, 400);
    if (!EMAIL_RE.test(mail)) return json({ error: "邮箱格式不正确，请检查后重试" }, 400);
    if (!pwd) return json({ error: "请输入密码" }, 400);
    if (pwd.length < 6) return json({ error: "密码至少 6 位" }, 400);
    if (confirmPassword !== undefined && pwd !== String(confirmPassword)) {
      return json({ error: "两次输入的密码不一致" }, 400);
    }
    const occupied = await env.TODO_KV.get(`user:${uname}`);
    if (occupied) return json({ error: "该用户名已被占用，请更换" }, 400);
    const now = new Date();
    // 团队用户（团队管理员）：teamId 即自己的用户名，其他成员/生产方/客户都归属该团队
    // 试用期无期限：不写入到期时间（trialEndsAt / expiresAt 均为空）；
    // 试用期间仅限本人使用（无成员 / 生产方 / 客户管理功能），可添加订单
    const teamUser = {
      username: uname,
      password: await hashPassword(pwd),
      role: "team",
      teamId: uname,
      teamName: tname,
      contact: String(contact || "").trim(),
      email: mail,
      remark: String(remark || "").trim(),
      // 邮箱确认码未验证通过前不允许登录（验证通过后置为 true）
      emailVerified: false,
      plan: "trial",
      status: "active",
      trialEndsAt: "",
      expiresAt: "",
      createdAt: now.toISOString(),
    };
    await env.TODO_KV.put(`user:${uname}`, JSON.stringify(teamUser));
    // 发送邮箱确认码；发送失败则回滚本次注册（避免占着用户名却收不到确认码）
    const issued = await issueVerifyCode(env, teamUser, request);
    if (!issued.ok) {
      await env.TODO_KV.delete(`user:${uname}`);
      return json({ error: "注册未完成：" + issued.error }, 503);
    }
    return json({
      ok: true,
      needVerify: true, // 需先完成邮箱确认才能登录
      username: uname,
      role: "team",
      teamName: tname,
      email: maskEmail(mail),
      codeTtlSec: CODE_TTL_SEC,
      resendAfterSec: CODE_RESEND_SEC,
      devCode: issued.devCode || undefined, // 调试模式才返回
      unlimitedTrial: true, // 试用期无期限
      message: `确认码已发送至 ${maskEmail(mail)}，请在 ${Math.floor(
        CODE_TTL_SEC / 60
      )} 分钟内输入完成邮箱确认`,
    });
  }

  // ---- 邮箱确认：输入邮件中的确认码完成注册验证 ----
  // 验证通过后写入 emailVerified 并直接建立会话（即「确认完成 → 正常登录」）
  if (pathname === "/api/register/verify" && method === "POST") {
    await ensureSuperAdmin(env);
    const { username, code } = await readBody(request);
    const uname = String(username || "").trim();
    if (!uname) return json({ error: "请输入用户名" }, 400);
    const raw = await env.TODO_KV.get(`user:${uname}`);
    if (!raw) return json({ error: "用户名不存在，请先注册" }, 404);
    const user = JSON.parse(raw);
    if (user.role !== "team") return json({ error: "该账号无需邮箱确认" }, 400);
    // 已确认过（如重复提交）：直接登录
    if (user.emailVerified !== false) return loginResponse(env, user);
    const checked = await checkVerifyCode(env, user, code);
    if (!checked.ok) return json({ error: checked.error }, 400);
    user.emailVerified = true;
    user.emailVerifiedAt = new Date().toISOString();
    await env.TODO_KV.put(`user:${uname}`, JSON.stringify(user));
    await env.TODO_KV.delete(`emailcode:${uname}`); // 确认码一次性使用
    return loginResponse(env, user);
  }

  // ---- 重新发送注册邮箱确认码（需提供该账号的登录密码，防止被他人滥发）----
  if (pathname === "/api/register/resend" && method === "POST") {
    await ensureSuperAdmin(env);
    const { username, password } = await readBody(request);
    const uname = String(username || "").trim();
    if (!uname) return json({ error: "请输入用户名" }, 400);
    const raw = await env.TODO_KV.get(`user:${uname}`);
    if (!raw) return json({ error: "用户名不存在，请先注册" }, 404);
    const user = JSON.parse(raw);
    if (user.role !== "team") return json({ error: "该账号无需邮箱确认" }, 400);
    if (user.emailVerified !== false) {
      return json({ error: "该账号已完成邮箱确认，可直接登录" }, 400);
    }
    if (!password || (await hashPassword(String(password))) !== user.password) {
      return json({ error: "密码不正确，无法重新发送确认码" }, 401);
    }
    const issued = await issueVerifyCode(env, user, request);
    if (!issued.ok) return json({ error: issued.error }, 429);
    return json({
      ok: true,
      email: maskEmail(user.email || ""),
      codeTtlSec: CODE_TTL_SEC,
      resendAfterSec: CODE_RESEND_SEC,
      devCode: issued.devCode || undefined,
      message: `确认码已重新发送至 ${maskEmail(user.email || "")}`,
    });
  }

  // ---- 登出 ----
  if (pathname === "/api/logout" && method === "POST") {
    const token = getToken(request);
    if (token) await env.TODO_KV.delete(`session:${token}`);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie": "token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
      },
    });
  }

  // ---- 当前用户信息 ----
  if (pathname === "/api/me" && method === "GET") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    const info = { username: user.username, role: user.role };
    // 生产单下单权限：团队管理员可在「成员管理」中为每个成员开关
    info.canPlaceOrder = canPlaceOrder(user);
    // 采购订单下单权限（补填 / 打开采购文件链接）：与上面相互独立
    info.canPurchase = canPurchaseOrder(user);
    if (isTeamAdmin(user.role)) {
      info.teamId = user.teamId || user.username;
      info.teamName = user.teamName || user.username;
      info.contact = user.contact || "";
      info.plan = isProPlan(user) ? "pro" : "trial";
      info.pro = isProTeam(user); // 专业版有效期内：可使用全部功能
      info.trialEndsAt = user.trialEndsAt || "";
      info.expiresAt = user.expiresAt || "";
      info.status = teamStatusOf(user);
      // 订阅 / 续费申请（含所选套餐），超级管理员开通后自动清除
      const subRequest = subscribeRequestOf(user);
      info.subscribeRequest = subRequest;
      info.renewRequest = subRequest; // 兼容旧字段名
    } else {
      // 团队成员 / 生产方 / 客户：附带所属团队名称，便于顶栏展示
      const team = await getTeam(env, teamIdOf(user));
      info.teamId = teamIdOf(user);
      info.teamName = team ? team.teamName || team.username : "";
      // 所在团队是否在专业版有效期内：成员据此判断改为「进行中」是否必须先指定生产方
      info.teamPro = isProTeam(team);
    }
    // 站内消息：未读 @ 次数 + 提醒总条数
    // （顶栏登录名左侧角标：未读 > 0 显示红色数字；未读 = 0 但有历史提醒时显示灰色「0」）
    const mention = await mentionStats(env, user.username);
    info.mentionsUnread = mention.unread;
    info.mentionsTotal = mention.total;
    return json(info);
  }

  // ---- 修改密码 ----
  if (pathname === "/api/change-password" && method === "POST") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    const { oldPassword, newPassword } = await readBody(request);
    if (!oldPassword || !newPassword) {
      return json({ error: "请填写完整" }, 400);
    }
    const hashedOld = await hashPassword(oldPassword);
    if (hashedOld !== user.password) {
      return json({ error: "原密码错误" }, 400);
    }
    user.password = await hashPassword(newPassword);
    await env.TODO_KV.put(`user:${user.username}`, JSON.stringify(user));
    return json({ ok: true });
  }

  // ---- 站点 / 团队设置 ----
  // 获取设置（所有登录用户可读）：siteName=全局网站名称，teamName=所属团队名称，allowRegister=是否允许新用户注册
  if (pathname === "/api/settings" && method === "GET") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    const g = await getGlobalSettings(env);
    const team = isTeamAdmin(user.role) ? user : await getTeam(env, teamIdOf(user));
    return json({
      settings: {
        siteName: g.siteName,
        allowRegister: g.allowRegister,
        supportEmail: g.supportEmail,
        favicon: g.favicon,
        teamName: team ? team.teamName || team.username : "",
      },
    });
  }

  // 保存设置：超级管理员改「网站名称 / 是否允许新用户注册」；团队管理员改「团队名称」
  if (pathname === "/api/settings" && method === "POST") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    const { siteName, teamName, allowRegister, supportEmail, favicon } = await readBody(request);
    if (teamName !== undefined) {
      if (!isTeamAdmin(user.role)) return json({ error: "无权限" }, 403);
      const tname = String(teamName).trim();
      if (!tname) return json({ error: "请输入团队名称" }, 400);
      user.teamName = tname;
      await env.TODO_KV.put(`user:${user.username}`, JSON.stringify(user));
      return json({ ok: true, settings: { teamName: tname } });
    }
    // 网站名称 / 注册开关 / 联系邮箱 / 网站图标：仅超级管理员
    if (
      siteName === undefined &&
      allowRegister === undefined &&
      supportEmail === undefined &&
      favicon === undefined
    ) {
      return json({ error: "请填写要保存的内容" }, 400);
    }
    if (!isSuperAdmin(user.role)) return json({ error: "无权限" }, 403);
    const raw = await env.TODO_KV.get("settings");
    const settings = raw ? JSON.parse(raw) : {};
    if (siteName !== undefined) {
      if (!siteName || !siteName.trim()) {
        return json({ error: "请输入网站名称" }, 400);
      }
      settings.siteName = siteName.trim();
    }
    if (allowRegister !== undefined) {
      settings.allowRegister = allowRegister === true || allowRegister === "true";
    }
    if (supportEmail !== undefined) {
      const v = String(supportEmail || "").trim();
      if (v.length > 60) return json({ error: "联系邮箱长度不能超过 60 个字符" }, 400);
      if (v && !EMAIL_RE.test(v)) {
        return json({ error: "联系邮箱格式不正确，请检查后重试（留空则不显示该提示）" }, 400);
      }
      settings.supportEmail = v; // 允许为空：登录页不再显示「忘记密码请联系」
    }
    if (favicon !== undefined) {
      const v = String(favicon || "").trim();
      if (v.length > 300) return json({ error: "网站图标链接不能超过 300 个字符" }, 400);
      const url = normalizeOrderUrl(v); // 与订单链接同一套校验：http(s) 开头、不含空格
      if (url === null) {
        return json({ error: "网站图标需填写以 http:// 或 https:// 开头的图片链接（留空则使用默认图标）" }, 400);
      }
      settings.favicon = url; // 允许为空：使用默认图标
    }
    await env.TODO_KV.put("settings", JSON.stringify(settings));
    const g = await getGlobalSettings(env);
    return json({
      ok: true,
      settings: {
        siteName: g.siteName,
        allowRegister: g.allowRegister,
        supportEmail: g.supportEmail,
        favicon: g.favicon,
      },
    });
  }

  // ---- 订阅 / 续费申请（团队管理员提交；超级管理员在控制台看到待处理标记，开通后自动清除）----
  //   · 试用账号（未订阅）提交的是「订阅申请」：申请升级为专业用户，可使用全部功能；
  //   · 专业版账号提交的是「续费申请」：延长专业版有效期（订阅时限与价格与原来一致）；
  //   · 收款方式已取消（原「微信支付」界面演示已移除），一律由超级管理员在控制台开通。
  if (
    (pathname === "/api/subscribe-request" || pathname === "/api/renew-request") &&
    method === "POST"
  ) {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isTeamAdmin(user.role)) return json({ error: "无权限" }, 403);
    const { note, contact, plan } = await readBody(request);
    if (contact !== undefined) {
      user.contact = String(contact || "").trim().slice(0, 50);
    }
    // 所选套餐（天数口径与超级管理员「开通 / 续费」接口一致）
    const picked = plan && typeof plan === "object" ? plan : null;
    const days =
      picked && Number(picked.days) > 0 ? Math.floor(Number(picked.days)) : 0;
    const subscribeRequest = {
      at: new Date().toISOString(),
      kind: isProTeam(user) ? "renew" : "subscribe", // renew=专业版续费；subscribe=订阅升级
      plan:
        picked && days
          ? {
              id: String(picked.id || "").slice(0, 20),
              term: String(picked.term || "").slice(0, 20),
              price: Number(picked.price) >= 0 ? Number(picked.price) : 0,
              days,
            }
          : null,
      note: String(note || "").trim().slice(0, 200),
      contact: user.contact || "",
    };
    user.subscribeRequest = subscribeRequest;
    delete user.renewRequest; // 兼容历史字段名
    await env.TODO_KV.put(`user:${user.username}`, JSON.stringify(user));
    // ---- 提交成功后发送邮件：收件人 = 申请人（注册邮箱），抄送 = 管理员提醒邮箱 ----
    //   邮件内容：申请人信息 + 订阅套餐信息 + 「邮件设置」里维护的自定义说明与收款二维码
    //   发信失败不影响申请提交（前端会提示邮件是否发送成功）
    const mail = { ok: false, to: user.email || "", cc: [], error: "" };
    try {
      if (!user.email) {
        mail.error = "该账号没有可用邮箱，无法发送申请邮件";
      } else {
        const cfg = await getMailConfig(env);
        const g = await getGlobalSettings(env);
        const notify = adminNotifyEmailOf(cfg, g);
        mail.cc = ccListOf({ to: user.email, cc: notify ? [notify] : [] });
        if (cfg.devMode) {
          mail.ok = true;
          mail.devMode = true;
        } else {
          const body = await subscribeRequestMailBody(
            env,
            user,
            subscribeRequest,
            cfg,
            subscribeRequest.kind
          );
          const sent = await sendMail(
            env,
            cfg,
            {
              to: user.email,
              cc: mail.cc,
              subject: body.subject,
              text: body.text,
              html: body.html,
            },
            { local: isLocalRequest(request) }
          );
          mail.ok = !!sent.ok;
          if (!sent.ok) mail.error = sent.error || "邮件发送失败";
        }
      }
    } catch (e) {
      mail.ok = false;
      mail.error = "邮件发送异常：" + (e && e.message ? e.message : String(e));
    }
    console.log(
      `[订阅申请邮件] ${user.username} -> ${mail.to || "-"}` +
        (mail.cc && mail.cc.length ? `（抄送 ${mail.cc.join(", ")}）` : "") +
        ` ${mail.ok ? "成功" : "失败：" + mail.error}`
    );
    return json({ ok: true, subscribeRequest, mail });
  }

  // ---- 团队用户管理（仅超级管理员：开通 / 停用 / 续费 / 重置密码 / 备注）----
  const teamsPrefix = "/api/teams";

  // 团队用户列表
  if (pathname === teamsPrefix && method === "GET") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isSuperAdmin(user.role)) return json({ error: "无权限" }, 403);
    return json({ teams: await listTeams(env) });
  }

  // 开通 / 停用（body.status: active | disabled）
  if (
    pathname.startsWith(`${teamsPrefix}/`) &&
    pathname.endsWith("/status") &&
    method === "POST"
  ) {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isSuperAdmin(user.role)) return json({ error: "无权限" }, 403);
    const target = decodeURIComponent(
      pathname.replace(`${teamsPrefix}/`, "").replace("/status", "")
    );
    const { status } = await readBody(request);
    if (!["active", "disabled"].includes(status)) {
      return json({ error: "无效的状态" }, 400);
    }
    const team = await getTeam(env, target);
    if (!team) return json({ error: "团队用户不存在" }, 404);
    team.status = status;
    await env.TODO_KV.put(`user:${target}`, JSON.stringify(team));
    return json({
      ok: true,
      status: teamStatusOf(team),
      expiresAt: team.expiresAt || team.trialEndsAt || "",
    });
  }

  // 开通 / 续费（升级为专业版）：body.days 默认 30 天；从「当前时间」与「原到期时间」中较晚者起顺延
  if (
    pathname.startsWith(`${teamsPrefix}/`) &&
    pathname.endsWith("/renew") &&
    method === "POST"
  ) {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isSuperAdmin(user.role)) return json({ error: "无权限" }, 403);
    const target = decodeURIComponent(
      pathname.replace(`${teamsPrefix}/`, "").replace("/renew", "")
    );
    const body = await readBody(request);
    const days = Number(body.days) > 0 ? Math.floor(Number(body.days)) : 30;
    if (days > 3650) return json({ error: "续费天数过大" }, 400);
    const team = await getTeam(env, target);
    if (!team) return json({ error: "团队用户不存在" }, 404);
    const now = Date.now();
    const cur = new Date(team.expiresAt || "").getTime();
    const base = Number.isNaN(cur) || cur < now ? now : cur;
    const expiresAt = new Date(base + days * DAY_MS).toISOString();
    team.expiresAt = expiresAt;
    team.status = "active";
    team.plan = "pro"; // 开通 / 续费后即为「专业版」（有效期内可使用全部功能）
    team.renewedAt = new Date().toISOString();
    // 开通 / 续费即视为已处理团队提交的订阅 / 续费申请
    delete team.subscribeRequest;
    delete team.renewRequest;
    await env.TODO_KV.put(`user:${target}`, JSON.stringify(team));
    return json({ ok: true, days, expiresAt, status: "active", pro: true });
  }

  // 重置团队用户登录密码
  if (
    pathname.startsWith(`${teamsPrefix}/`) &&
    pathname.endsWith("/reset-password") &&
    method === "POST"
  ) {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isSuperAdmin(user.role)) return json({ error: "无权限" }, 403);
    const target = decodeURIComponent(
      pathname.replace(`${teamsPrefix}/`, "").replace("/reset-password", "")
    );
    const { newPassword } = await readBody(request);
    if (!newPassword || !String(newPassword).trim()) {
      return json({ error: "请输入新密码" }, 400);
    }
    const team = await getTeam(env, target);
    if (!team) return json({ error: "团队用户不存在" }, 404);
    team.password = await hashPassword(String(newPassword).trim());
    await env.TODO_KV.put(`user:${target}`, JSON.stringify(team));
    return json({ ok: true });
  }

  // 团队备注（留空即清除备注）
  if (
    pathname.startsWith(`${teamsPrefix}/`) &&
    pathname.endsWith("/remark") &&
    method === "POST"
  ) {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isSuperAdmin(user.role)) return json({ error: "无权限" }, 403);
    const target = decodeURIComponent(
      pathname.replace(`${teamsPrefix}/`, "").replace("/remark", "")
    );
    const { remark } = await readBody(request);
    const team = await getTeam(env, target);
    if (!team) return json({ error: "团队用户不存在" }, 404);
    team.remark = String(remark || "").trim();
    await env.TODO_KV.put(`user:${target}`, JSON.stringify(team));
    return json({ ok: true, remark: team.remark });
  }

  // 彻底删除团队用户（仅超级管理员）：连同该团队的成员 / 生产方 / 客户账号与全部数据一起删除
  //   安全要求：必须先把团队「停用」（列表中停用后才会出现「删除」按钮），避免误删线上正在使用的团队
  if (pathname.startsWith(`${teamsPrefix}/`) && method === "DELETE") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isSuperAdmin(user.role)) return json({ error: "无权限" }, 403);
    const target = decodeURIComponent(pathname.slice(teamsPrefix.length + 1));
    if (!target || target.indexOf("/") !== -1) return json({ error: "接口不存在" }, 404);
    const team = await getTeam(env, target);
    if (!team) return json({ error: "团队用户不存在" }, 404);
    if (team.status !== "disabled") {
      return json({ error: "请先「停用」该团队用户，确认无误后再删除" }, 400);
    }
    // 该团队下的全部账号（含团队用户本人、成员、生产方、客户）
    const accounts = await listTeamAccounts(env, target);
    const roles = accounts.reduce((m, a) => {
      m[a.role] = (m[a.role] || 0) + 1;
      return m;
    }, {});
    let todos = 0;
    for (const acc of accounts) {
      const r = await deleteAccountData(env, acc.username);
      todos += r.todos;
    }
    // 团队内共享数据：生产方列表 / 客户列表（团队 id 即团队用户的登录用户名）
    const producers = await getProducers(env, target);
    const customers = await getCustomerList(env, target);
    await env.TODO_KV.delete(`producers:${target}`);
    await env.TODO_KV.delete(`customerList:${target}`);
    return json({
      ok: true,
      deleted: {
        team: target,
        teamName: team.teamName || target,
        accounts: accounts.length,
        members: accounts.filter((a) => !["team", "producer", "customer"].includes(a.role)).length,
        producers: producers.length,
        customers: customers.length,
        todos,
        roles,
      },
    });
  }

  // ---- 邮件设置（仅超级管理员）：注册邮箱确认码的发件服务配置 ----
  //   支持 QQ 邮箱 SMTP（SMTP_USER + SMTP_PASS 授权码）、Resend API、Cloudflare 邮件绑定；
  //   环境变量（SMTP_* / QQ_MAIL_* / RESEND_API_KEY / MAIL_FROM / MAIL_FROM_NAME）优先于此处保存的配置。
  if (pathname === "/api/admin/email-settings" && method === "GET") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isSuperAdmin(user.role)) return json({ error: "无权限" }, 403);
    const cfg = await getMailConfig(env);
    return json({ settings: mailSettingsView(cfg, env) });
  }

  // 保存邮件设置：apiKey / smtpPass 留空表示不修改，填 "-" 表示清除
  if (pathname === "/api/admin/email-settings" && method === "POST") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isSuperAdmin(user.role)) return json({ error: "无权限" }, 403);
    const {
      from,
      fromName,
      apiKey,
      devMode,
      smtpHost,
      smtpPort,
      smtpUser,
      smtpPass,
      adminNotifyEmail,
      subExtraText,
      subQrCodes,
    } = await readBody(request);
    const raw = await env.TODO_KV.get("emailSettings");
    const saved = raw ? JSON.parse(raw) : {};
    if (from !== undefined) {
      const v = String(from || "").trim();
      if (v && !EMAIL_RE.test(v)) {
        return json({ error: "发件邮箱格式不正确，请检查后重试" }, 400);
      }
      saved.from = v;
    }
    if (fromName !== undefined) {
      saved.fromName = String(fromName || "").trim().slice(0, 30);
    }
    if (apiKey !== undefined) {
      const v = String(apiKey || "").trim();
      if (v === "-") delete saved.apiKey;
      else if (v) saved.apiKey = v;
    }
    // ---- SMTP（QQ 邮箱等）----
    if (smtpHost !== undefined) {
      const v = String(smtpHost || "").trim();
      if (v && !/^[A-Za-z0-9.-]{1,60}$/.test(v)) {
        return json({ error: "SMTP 服务器地址格式不正确（例如 smtp.qq.com）" }, 400);
      }
      saved.smtpHost = v || "smtp.qq.com";
    }
    if (smtpPort !== undefined) {
      const rawPort = String(smtpPort === null || smtpPort === undefined ? "" : smtpPort).trim();
      const port = Number(rawPort) || 0;
      if (rawPort && (port < 1 || port > 65535)) {
        return json({ error: "SMTP 端口需为 1~65535 的数字（QQ 邮箱用 465，或 587 + STARTTLS）" }, 400);
      }
      saved.smtpPort = port || 465;
    }
    if (smtpUser !== undefined) {
      const v = String(smtpUser || "").trim();
      if (v && !EMAIL_RE.test(v)) {
        return json({ error: "SMTP 账号需填写完整邮箱地址（例如 xxx@qq.com）" }, 400);
      }
      saved.smtpUser = v;
    }
    if (smtpPass !== undefined) {
      const v = String(smtpPass || "").trim();
      if (v === "-") delete saved.smtpPass;
      else if (v) saved.smtpPass = v;
    }
    if (devMode !== undefined) saved.devMode = !!devMode;
    // ---- 订阅 / 续费申请邮件：管理员提醒邮箱（抄送）+ 自定义说明 + 收款二维码图片链接 ----
    if (adminNotifyEmail !== undefined) {
      const v = String(adminNotifyEmail || "").trim();
      if (v && !EMAIL_RE.test(v)) {
        return json({ error: "管理员提醒邮箱格式不正确（留空则默认抄送到发件邮箱）" }, 400);
      }
      saved.adminNotifyEmail = v;
    }
    if (subExtraText !== undefined) {
      const v = String(subExtraText || "").replace(/\r\n/g, "\n").trim();
      if (v.length > 1000) {
        return json({ error: "自定义说明不能超过 1000 个字符" }, 400);
      }
      saved.subExtraText = v;
    }
    if (subQrCodes !== undefined) {
      const list = Array.isArray(subQrCodes) ? subQrCodes.slice(0, SUB_QR_MAX) : [];
      if (list.length && subQrCodes.length > SUB_QR_MAX) {
        return json({ error: `收款二维码最多 ${SUB_QR_MAX} 个` }, 400);
      }
      for (let i = 0; i < list.length; i++) {
        const v = String(list[i] || "").trim();
        if (!v) continue;
        if (v.length > 300) {
          return json({ error: `收款二维码链接太长（第 ${i + 1} 个，最多 300 个字符）` }, 400);
        }
        if (normalizeOrderUrl(v) === null) {
          return json(
            { error: `收款二维码需填写以 http:// 或 https:// 开头的图片链接（第 ${i + 1} 个，留空则不显示）` },
            400
          );
        }
      }
      const arr = normalizeQrCodes(list);
      while (arr.length && !arr[arr.length - 1]) arr.pop(); // 去掉末尾空槽位，保持 KV 精简
      saved.subQrCodes = arr;
    }
    await env.TODO_KV.put("emailSettings", JSON.stringify(saved));
    const cfg = await getMailConfig(env);
    return json({ ok: true, settings: mailSettingsView(cfg, env) });
  }

  // 发送测试邮件（用于验证邮件服务配置是否正确）
  if (pathname === "/api/admin/email-test" && method === "POST") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isSuperAdmin(user.role)) return json({ error: "无权限" }, 403);
    const { to } = await readBody(request);
    const mail = String(to || "").trim();
    if (!mail) return json({ error: "请输入测试收件邮箱" }, 400);
    if (!EMAIL_RE.test(mail)) return json({ error: "测试收件邮箱格式不正确" }, 400);
    const cfg = await getMailConfig(env);
    if (cfg.devMode) {
      return json({ ok: true, devMode: true, message: "当前为调试模式（不真实发送邮件），无需测试发信" });
    }
    if (!cfg.provider) {
      return json(
        {
          error:
            "邮件服务未配置：请填写 QQ 邮箱 SMTP 账号与授权码（或 Resend API Key）并保存后，再发送测试邮件",
        },
        400
      );
    }
    const providerName =
      cfg.provider === "smtp" ? "QQ 邮箱 SMTP" : cfg.provider === "resend" ? "Resend" : "Cloudflare 邮件绑定";
    const sent = await sendMail(
      env,
      cfg,
      {
        to: mail,
        subject: "【测试】邮件服务配置正常",
        text: "这是一封测试邮件：收到本邮件说明「注册邮箱确认码」的发件服务已配置成功。",
        html: `<p>这是一封测试邮件：收到本邮件说明「注册邮箱确认码」的发件服务已配置成功。</p>`,
      },
      { local: isLocalRequest(request) }
    );
    if (!sent.ok) return json({ error: sent.error }, 400);
    return json({
      ok: true,
      message: `测试邮件已通过 ${providerName} 发送至 ${mail}，请查收（若没收到，请检查垃圾邮件箱）`,
    });
  }

  // ---- 成员管理（专业版功能；试用账号仅限本人一人使用，不可用）----
  if (pathname === "/api/users" && method === "GET") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isTeamAdmin(user.role)) return json({ error: "无权限" }, 403);
    if (!isProTeam(user)) return proOnly();
    return json({ users: await listUsers(env, teamIdOf(user)) });
  }

  // 新增成员（专业版功能；试用账号仅限本人使用）
  if (pathname === "/api/users" && method === "POST") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isTeamAdmin(user.role)) return json({ error: "无权限" }, 403);
    if (!isProTeam(user)) return proOnly();
    const { username, password, role, dept } = await readBody(request);
    if (!username || !password) {
      return json({ error: "请填写用户名和密码" }, 400);
    }
    // 角色：editor=业务部（默认）；restricted=生产部 / 计划部 / 采购部 / 品质部 / 财务部
    //（这 5 个部门权限完全相同，仅 dept 显示名不同）；superviewer=总经理
    // 注：viewer（业务主管）已不再作为新增成员的选项 —— 历史账号仍保留该角色（只读查看「进行中/已完成」订单）
    const finalRole = ["restricted", "superviewer"].includes(role) ? role : "editor";
    const existing = await env.TODO_KV.get(`user:${username}`);
    if (existing) return json({ error: "用户名已存在" }, 400);
    const newUser = {
      username,
      password: await hashPassword(password),
      role: finalRole,
      teamId: teamIdOf(user), // 归属创建者所在团队
      createdAt: new Date().toISOString(),
    };
    // 部门名（仅「生产部」类角色写入；未传或非法时按「生产部」处理）
    const deptName = normalizeDept(dept, finalRole);
    if (deptName) newUser.dept = deptName;
    await env.TODO_KV.put(`user:${username}`, JSON.stringify(newUser));
    return json({ ok: true });
  }

  if (pathname.startsWith("/api/users/") && method === "DELETE") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isTeamAdmin(user.role)) return json({ error: "无权限" }, 403);
    if (!isProTeam(user)) return proOnly();
    const target = decodeURIComponent(pathname.replace("/api/users/", ""));
    // 只能删除本团队成员
    const targetUser = await getTeamMember(env, target, teamIdOf(user));
    if (!targetUser) return json({ error: "成员不存在" }, 404);
    await env.TODO_KV.delete(`user:${target}`);
    await env.TODO_KV.delete(`todos:${target}`);
    await env.TODO_KV.delete(`customers:${target}`);
    await env.TODO_KV.delete(`watch:${target}`);
    await env.TODO_KV.delete(`mentions:${target}`); // 站内消息（@提醒）一并清理
    return json({ ok: true });
  }

  // ---- 重置成员密码（专业版功能）----
  if (
    pathname.startsWith("/api/users/") &&
    pathname.endsWith("/reset-password") &&
    method === "POST"
  ) {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isTeamAdmin(user.role)) return json({ error: "无权限" }, 403);
    if (!isProTeam(user)) return proOnly();
    const teamId = teamIdOf(user);
    const target = decodeURIComponent(
      pathname.replace("/api/users/", "").replace("/reset-password", "")
    );
    const { newPassword } = await readBody(request);
    if (!newPassword || !newPassword.trim()) {
      return json({ error: "请输入新密码" }, 400);
    }
    const raw = await env.TODO_KV.get(`user:${target}`);
    if (!raw) {
      // 兼容历史生产方：还没有登录账号时，用本次设置的新密码创建生产方账号（限定本团队）
      const producers = await getProducers(env, teamId);
      const prod = producers.find((p) => p.username === target);
      if (prod) {
        await env.TODO_KV.put(
          `user:${target}`,
          JSON.stringify({
            username: target,
            password: await hashPassword(newPassword),
            role: "producer",
            producerId: prod.id,
            teamId,
            createdAt: new Date().toISOString(),
          })
        );
        return json({ ok: true, created: true });
      }
      // 兼容历史客户：还没有登录账号时，用本次设置的新密码创建客户账号（限定本团队）
      const customers = await getCustomerList(env, teamId);
      const cust = customers.find((c) => c.name === target);
      if (cust) {
        await env.TODO_KV.put(
          `user:${target}`,
          JSON.stringify({
            username: target,
            password: await hashPassword(newPassword),
            role: "customer",
            customerId: cust.id,
            customerName: cust.name,
            teamId,
            createdAt: new Date().toISOString(),
          })
        );
        return json({ ok: true, created: true });
      }
      return json({ error: "成员不存在" }, 404);
    }
    const targetUser = JSON.parse(raw);
    // 只能重置本团队成员 / 生产方 / 客户的密码
    if (isSuperAdmin(targetUser.role) || teamIdOf(targetUser) !== teamId) {
      return json({ error: "成员不存在" }, 404);
    }
    targetUser.password = await hashPassword(newPassword);
    await env.TODO_KV.put(`user:${target}`, JSON.stringify(targetUser));
    return json({ ok: true });
  }

  // ---- 成员备注（专业版功能；留空表示清除备注）----
  if (
    pathname.startsWith("/api/users/") &&
    pathname.endsWith("/remark") &&
    method === "POST"
  ) {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isTeamAdmin(user.role)) return json({ error: "无权限" }, 403);
    if (!isProTeam(user)) return proOnly();
    const target = decodeURIComponent(
      pathname.replace("/api/users/", "").replace("/remark", "")
    );
    const { remark } = await readBody(request);
    const targetUser = await getTeamMember(env, target, teamIdOf(user));
    if (!targetUser) return json({ error: "成员不存在" }, 404);
    targetUser.remark = String(remark || "").trim();
    await env.TODO_KV.put(`user:${target}`, JSON.stringify(targetUser));
    return json({ ok: true, remark: targetUser.remark });
  }

  // ---- 生产单下单权限 / 采购订单下单权限「有 / 无」（专业版功能；团队管理员在「成员管理」里逐个开关）----
  //   body 可带 canPlaceOrder（客户订单录入）、canPurchase（采购订单下单）任一或两者，均为布尔值
  if (
    pathname.startsWith("/api/users/") &&
    pathname.endsWith("/order-permission") &&
    method === "POST"
  ) {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isTeamAdmin(user.role)) return json({ error: "无权限" }, 403);
    if (!isProTeam(user)) return proOnly();
    const target = decodeURIComponent(
      pathname.replace("/api/users/", "").replace("/order-permission", "")
    );
    const body = await readBody(request);
    const hasPlace = typeof body.canPlaceOrder === "boolean";
    const hasPurchase = typeof body.canPurchase === "boolean";
    if (!hasPlace && !hasPurchase) {
      return json({ error: "请传入 true（有）或 false（无）" }, 400);
    }
    const targetUser = await getTeamMember(env, target, teamIdOf(user));
    if (!targetUser) return json({ error: "成员不存在" }, 404);
    // 「品质部 / 财务部」成员不需要下单相关权限：成员管理里不显示开关，接口也不允许开启
    if (needsNoOrderPerm(targetUser) && (hasPlace || hasPurchase)) {
      return json(
        {
          error:
            memberRoleLabel(targetUser) +
            "成员不需要「" +
            (hasPurchase ? "采购订单下单" : "生产单下单权限") +
            "」（该部门无录入/下单需求），无需设置",
        },
        400
      );
    }
    if (hasPlace) targetUser.canPlaceOrder = body.canPlaceOrder;
    if (hasPurchase) targetUser.canPurchase = body.canPurchase;
    await env.TODO_KV.put(`user:${target}`, JSON.stringify(targetUser));
    return json({
      ok: true,
      canPlaceOrder: canPlaceOrder(targetUser),
      canPurchase: canPurchaseOrder(targetUser),
    });
  }


  // ---- 客户分配（团队管理员可操作本团队成员；业务部可查自己的）----
  // 获取某成员的客户列表
  if (pathname.startsWith("/api/customers/") && method === "GET") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    const target = decodeURIComponent(pathname.replace("/api/customers/", ""));
    if (target !== user.username) {
      const member = isTeamAdmin(user.role)
        ? await getTeamMember(env, target, teamIdOf(user))
        : null;
      if (!member) return json({ error: "无权限" }, 403);
    }
    return json({ customers: await getCustomers(env, target) });
  }

  // 为某成员新增客户（专业版功能）
  if (pathname.startsWith("/api/customers/") && method === "POST") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isTeamAdmin(user.role)) return json({ error: "无权限" }, 403);
    if (!isProTeam(user)) return proOnly();
    const target = decodeURIComponent(pathname.replace("/api/customers/", ""));
    const member = await getTeamMember(env, target, teamIdOf(user));
    if (!member) return json({ error: "成员不存在" }, 404);
    // globalId：来自「客户管理」的团队客户 id；传了就直接复用（便于去重）
    const { name, globalId } = await readBody(request);
    if (!name || !name.trim()) return json({ error: "请输入客户名称" }, 400);
    const customers = await getCustomers(env, target);
    const trimmed = name.trim();
    const gid = globalId ? String(globalId).trim() : "";
    if (customers.some((c) => c.name === trimmed || (gid && c.id === gid))) {
      return json({ error: "客户已存在" }, 400);
    }
    const customer = {
      id: gid || genToken().slice(0, 12),
      name: trimmed,
      createdAt: new Date().toISOString(),
    };
    customers.push(customer);
    await saveCustomers(env, target, customers);
    return json({ ok: true, customer });
  }

  // 删除某成员的客户（仅本团队管理员）
  if (pathname.startsWith("/api/customers/") && method === "DELETE") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isTeamAdmin(user.role)) return json({ error: "无权限" }, 403);
    if (!isProTeam(user)) return proOnly();
    const rest = decodeURIComponent(pathname.replace("/api/customers/", ""));
    const slash = rest.lastIndexOf("/");
    if (slash === -1) return json({ error: "参数错误" }, 400);
    const target = rest.slice(0, slash);
    const cid = rest.slice(slash + 1);
    const member = await getTeamMember(env, target, teamIdOf(user));
    if (!member) return json({ error: "成员不存在" }, 404);
    let customers = await getCustomers(env, target);
    customers = customers.filter((c) => c.id !== cid);
    await saveCustomers(env, target, customers);
    return json({ ok: true });
  }


  // ---- 客户管理（专业版功能；团队内共享，成员管理中为「业务部」分配客户时从这里选择）----
  // 获取本团队客户列表（专业版功能：仅专业版团队账号可读）
  if (pathname === "/api/customer-list" && method === "GET") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isTeamAdmin(user.role) || !isProTeam(user)) return proOnly();
    return json({ customers: await getCustomerList(env, teamIdOf(user)) });
  }

  // 新增客户（仅本团队管理员）：字段为「用户名」（也是客户名称）、「密码」和「说明」；同时创建客户登录账号
  if (pathname === "/api/customer-list" && method === "POST") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isTeamAdmin(user.role)) return json({ error: "无权限" }, 403);
    const teamId = teamIdOf(user);
    const { name, password, description } = await readBody(request);
    if (!name || !name.trim()) return json({ error: "请输入用户名" }, 400);
    if (!password || !String(password).trim()) {
      return json({ error: "请输入密码" }, 400);
    }
    const list = await getCustomerList(env, teamId);
    const trimmed = name.trim();
    if (list.some((c) => c.name === trimmed)) {
      return json({ error: "该用户名已存在" }, 400);
    }
    // 不能与已有成员 / 生产方账号重名
    const occupied = await env.TODO_KV.get(`user:${trimmed}`);
    if (occupied) return json({ error: "该用户名已被占用" }, 400);
    const customer = {
      id: genToken().slice(0, 12),
      name: trimmed,
      description: (description || "").trim(),
      createdAt: new Date().toISOString(),
    };
    list.push(customer);
    await saveCustomerList(env, teamId, list);
    // 同时创建客户登录账号（role=customer，绑定该客户 id 与名称）
    await env.TODO_KV.put(
      `user:${trimmed}`,
      JSON.stringify({
        username: trimmed,
        password: await hashPassword(String(password).trim()),
        role: "customer",
        customerId: customer.id,
        customerName: trimmed,
        teamId,
        createdAt: customer.createdAt,
      })
    );
    return json({ ok: true, customer });
  }

  // 删除客户（专业版功能；已分配给成员的记录不会自动移除）
  if (pathname.startsWith("/api/customer-list/") && method === "DELETE") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isTeamAdmin(user.role)) return json({ error: "无权限" }, 403);
    if (!isProTeam(user)) return proOnly();
    const teamId = teamIdOf(user);
    const id = decodeURIComponent(pathname.replace("/api/customer-list/", ""));
    let list = await getCustomerList(env, teamId);
    const target = list.find((c) => c.id === id);
    list = list.filter((c) => c.id !== id);
    await saveCustomerList(env, teamId, list);
    // 同步删除该客户的登录账号（已录入的待办保留客户名称快照）
    if (target && target.name) {
      await env.TODO_KV.delete(`user:${target.name}`);
    }
    return json({ ok: true });
  }


  // 修改客户「说明」（专业版功能；留空即清除说明）
  if (
    pathname.startsWith("/api/customer-list/") &&
    pathname.endsWith("/description") &&
    method === "POST"
  ) {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isTeamAdmin(user.role)) return json({ error: "无权限" }, 403);
    if (!isProTeam(user)) return proOnly();
    const teamId = teamIdOf(user);
    const id = decodeURIComponent(
      pathname.replace("/api/customer-list/", "").replace("/description", "")
    );
    const { description } = await readBody(request);
    const list = await getCustomerList(env, teamId);
    const cust = list.find((c) => c.id === id);
    if (!cust) return json({ error: "客户不存在" }, 404);
    cust.description = String(description || "").trim();
    await saveCustomerList(env, teamId, list);
    return json({ ok: true, description: cust.description });
  }


  // ---- 生产方管理（专业版功能；团队内共享，团队内所有登录用户可读）----
  // 获取本团队生产方列表（团队内所有登录用户可读）
  if (pathname === "/api/producers" && method === "GET") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    return json({ producers: await getProducers(env, teamIdOf(user)) });
  }

  // 新增生产方（专业版功能）：字段为「用户名」「密码」（生产方用该账号登录，只看指定给自己的待办）和「说明」
  if (pathname === "/api/producers" && method === "POST") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isTeamAdmin(user.role)) return json({ error: "无权限" }, 403);
    if (!isProTeam(user)) return proOnly();
    const teamId = teamIdOf(user);
    const { username, password, description, nature } = await readBody(request);
    const uname = (username || "").trim();
    if (!uname) return json({ error: "请输入用户名" }, 400);
    if (!password || !String(password).trim()) {
      return json({ error: "请输入密码" }, 400);
    }
    const producers = await getProducers(env, teamId);
    if (producers.some((p) => p.username === uname)) {
      return json({ error: "该用户名已存在" }, 400);
    }
    // 不能与已有成员账号重名
    const occupied = await env.TODO_KV.get(`user:${uname}`);
    if (occupied) return json({ error: "该用户名已被成员占用" }, 400);
    const producer = {
      id: genToken().slice(0, 12),
      username: uname,
      description: (description || "").trim(),
      nature: normalizeProducerNature(nature),
      createdAt: new Date().toISOString(),
    };
    producers.push(producer);
    await saveProducers(env, teamId, producers);
    // 同时创建生产方登录账号（role=producer，绑定该生产方 id）
    await env.TODO_KV.put(
      `user:${uname}`,
      JSON.stringify({
        username: uname,
        password: await hashPassword(String(password).trim()),
        role: "producer",
        producerId: producer.id,
        teamId,
        createdAt: producer.createdAt,
      })
    );
    return json({ ok: true, producer });
  }

  // 删除生产方（专业版功能）
  if (pathname.startsWith("/api/producers/") && method === "DELETE") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isTeamAdmin(user.role)) return json({ error: "无权限" }, 403);
    if (!isProTeam(user)) return proOnly();
    const teamId = teamIdOf(user);
    const id = decodeURIComponent(pathname.replace("/api/producers/", ""));
    let producers = await getProducers(env, teamId);
    const target = producers.find((p) => p.id === id);
    producers = producers.filter((p) => p.id !== id);
    await saveProducers(env, teamId, producers);
    // 同步删除该生产方的登录账号（已指定该生产方的待办保留名称快照）
    if (target && target.username) {
      await env.TODO_KV.delete(`user:${target.username}`);
    }
    return json({ ok: true });
  }


  // 修改生产方「说明」（专业版功能；留空即清除说明）
  if (
    pathname.startsWith("/api/producers/") &&
    pathname.endsWith("/description") &&
    method === "POST"
  ) {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isTeamAdmin(user.role)) return json({ error: "无权限" }, 403);
    if (!isProTeam(user)) return proOnly();
    const teamId = teamIdOf(user);
    const id = decodeURIComponent(
      pathname.replace("/api/producers/", "").replace("/description", "")
    );
    const { description } = await readBody(request);
    const producers = await getProducers(env, teamId);
    const prod = producers.find((p) => p.id === id);
    if (!prod) return json({ error: "生产方不存在" }, 404);
    prod.description = String(description || "").trim();
    await saveProducers(env, teamId, producers);
    return json({ ok: true, description: prod.description });
  }


  // 修改生产方「性质」（自产 / 外购）（专业版功能）
  if (
    pathname.startsWith("/api/producers/") &&
    pathname.endsWith("/nature") &&
    method === "POST"
  ) {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isTeamAdmin(user.role)) return json({ error: "无权限" }, 403);
    if (!isProTeam(user)) return proOnly();
    const teamId = teamIdOf(user);
    const id = decodeURIComponent(
      pathname.replace("/api/producers/", "").replace("/nature", "")
    );
    const { nature } = await readBody(request);
    const value = String(nature === undefined || nature === null ? "" : nature).trim();
    if (!PRODUCER_NATURES.includes(value)) {
      return json({ error: "生产方性质只能是「自产」或「外购」" }, 400);
    }
    const producers = await getProducers(env, teamId);
    const prod = producers.find((p) => p.id === id);
    if (!prod) return json({ error: "生产方不存在" }, 404);
    prod.nature = value;
    await saveProducers(env, teamId, producers);
    return json({ ok: true, nature: prod.nature });
  }


  // ---- 生产部「可观察生产方」授权（仅本团队管理员可改；本人可读）----
  const watchPrefix = "/api/watch/";

  // 查询某生产部可观察的生产方（团队管理员可查本团队成员；本人可查自己）
  if (pathname.startsWith(watchPrefix) && method === "GET") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    const teamId = teamIdOf(user);
    const target = decodeURIComponent(pathname.replace(watchPrefix, ""));
    if (target !== user.username) {
      const member = isTeamAdmin(user.role)
        ? await getTeamMember(env, target, teamId)
        : null;
      if (!member) return json({ error: "无权限" }, 403);
    }
    const ids = await getWatchProducers(env, target);
    const producers = await getProducers(env, teamId);
    // 已删除的生产方以占位形式返回，便于管理员清理授权（与「可见范围」保持一致）
    const granted = ids.map((id) => {
      const p = producers.find((x) => x.id === id);
      return p ? p : { id, username: "（已删除的生产方）", description: "", deleted: true };
    });
    return json({ producers: granted });
  }

  // 授权某生产部可观察某生产方（专业版功能）
  if (pathname.startsWith(watchPrefix) && method === "POST") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isTeamAdmin(user.role)) return json({ error: "无权限" }, 403);
    if (!isProTeam(user)) return proOnly();
    const teamId = teamIdOf(user);
    const target = decodeURIComponent(pathname.replace(watchPrefix, ""));
    const member = await getTeamMember(env, target, teamId);
    if (!member) return json({ error: "成员不存在" }, 404);
    const { producerId } = await readBody(request);
    if (!producerId || !String(producerId).trim()) {
      return json({ error: "请选择生产方" }, 400);
    }
    const pid = String(producerId).trim();
    const producers = await getProducers(env, teamId);
    if (!producers.some((p) => p.id === pid)) {
      return json({ error: "生产方不存在，请先在「生产方管理」中添加" }, 400);
    }
    if (member.role !== "restricted") {
      return json({ error: "该成员不是「生产部」成员，无法授权可观察的生产方" }, 400);
    }
    const ids = await getWatchProducers(env, target);
    if (ids.includes(pid)) return json({ error: "已授权该生产方" }, 400);
    ids.push(pid);
    await saveWatchProducers(env, target, ids);
    return json({ ok: true, producerIds: ids });
  }

  // 取消授权（专业版功能）
  if (pathname.startsWith(watchPrefix) && method === "DELETE") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!isTeamAdmin(user.role)) return json({ error: "无权限" }, 403);
    if (!isProTeam(user)) return proOnly();
    const rest = decodeURIComponent(pathname.replace(watchPrefix, ""));
    const slash = rest.lastIndexOf("/");
    if (slash === -1) return json({ error: "参数错误" }, 400);
    const target = rest.slice(0, slash);
    const pid = rest.slice(slash + 1);
    const member = await getTeamMember(env, target, teamIdOf(user));
    if (!member) return json({ error: "成员不存在" }, 404);
    let ids = await getWatchProducers(env, target);
    ids = ids.filter((x) => x !== pid);
    await saveWatchProducers(env, target, ids);
    return json({ ok: true, producerIds: ids });
  }


  // ---- 可 @ 的人员列表（备注中输入「@」时弹出：团队账号本人 + 本团队所有成员）----
  if (pathname === "/api/team-members" && method === "GET") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    return json({ members: await listMentionable(env, teamIdOf(user)) });
  }

  // ---- 站内消息（被 @ 的提醒）----
  // 查询：items（最新在前）+ unread（未读条数，前端 >9 显示 9+）+ total
  if (pathname === "/api/mentions" && method === "GET") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    const items = await getMentions(env, user.username);
    return json({
      items,
      unread: items.filter((m) => !m.read).length,
      total: items.length,
    });
  }

  // 标记已读 / 未读：
  //   body.id + body.read=false → 该条重新标记为「未读」（顶栏红点数量 +1）
  //   body.id（不带 read）      → 该条标记为「已读」（未读数 -1）
  //   不带 id                   → 全部标记为已读
  if (pathname === "/api/mentions/read" && method === "POST") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    const body = await readBody(request);
    const id = body && body.id ? String(body.id).trim() : "";
    const wantRead = !(body && body.read === false); // 默认：标记为已读
    const items = await getMentions(env, user.username);
    let changed = 0;
    for (const it of items) {
      if (it.read === wantRead) continue; // 已是指定状态：跳过（幂等）
      if (id && it.id !== id) continue; // 指定单条时只处理这一条
      it.read = wantRead;
      changed++;
    }
    if (changed) await saveMentions(env, user.username, items);
    return json({
      ok: true,
      changed,
      read: wantRead,
      unread: items.filter((m) => !m.read).length,
      total: items.length,
    });
  }


  // ---- 待办列表 ----
  if (pathname === "/api/todos" && method === "GET") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    const teamId = teamIdOf(user);
    // 团队管理员 / 总经理：可查看本团队所有用户的待办（含待确认）
    if (canManageTodos(user.role)) {
      return json({
        todos: await getAllTodos(env, teamId, false),
        readonly: false,
        allUsers: true,
      });
    }
    // 业务主管仅能看到本团队「进行中/已完成」的待办（待确认不可见）
    if (user.role === "viewer") {
      return json({
        todos: await getAllTodos(env, teamId, true),
        readonly: true,
        allUsers: true,
      });
    }
    // 生产部仅能看到「被授权生产方」且非「待确认」的待办
    if (user.role === "restricted") {
      const ids = await getWatchProducers(env, user.username);
      return json({
        todos: await getAllTodos(env, teamId, true, ids),
        readonly: true,
        allUsers: true,
      });
    }
    // 生产方账号：仅能看到「指定给自己」且非「待确认」的待办
    if (user.role === "producer") {
      const producers = await getProducers(env, teamId);
      const me = producers.find((p) => p.id === user.producerId);
      return json({
        todos: await getAllTodos(env, teamId, true, me ? [me.id] : []),
        readonly: true,
        allUsers: true,
      });
    }
    // 客户账号：仅能看到「该客户名下」且非「待确认」的待办
    if (user.role === "customer") {
      const cname = user.customerName || "";
      const visible = cname ? await getAllTodos(env, teamId, true) : [];
      return json({
        todos: visible.filter((t) => t.customer === cname),
        readonly: true,
        allUsers: true,
      });
    }
    // 业务部成员关闭「客户订单录入」后：改为**只读查看本团队全部订单**（含待确认），
    // 便于其继续了解团队订单进度；不能录入 / 修改状态 / 删除（相关接口另有角色校验）。
    if (!canPlaceOrder(user)) {
      return json({ todos: await getAllTodos(env, teamId, false), readonly: true, allUsers: true });
    }
    // 业务部成员：只返回自己的订单，但同样携带 owner（清单里每条订单都显示录入者）
    const own = await getTodos(env, user.username);
    return json({
      todos: own.map((t) => Object.assign({}, t, { owner: user.username })),
      readonly: false,
    });
  }

  if (pathname === "/api/todos" && method === "POST") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    // 生产单下单权限：团队管理员本人固定有；成员可视「成员管理」里逐个开关
    // （历史行为不变：业务部有、业务主管/生产部/总经理无）
    if (!canPlaceOrder(user)) {
      return json(
        {
          error:
            memberRoleLabel(user) +
            "无「" +
            orderPermLabel(user) +
            "」，请联系团队管理员在「成员管理」中开通",
        },
        403
      );
    }
    const { title, customer, dueDate, amount, orderUrl, purchaseUrl, currency } =
      await readBody(request);
    if (!customer || !customer.trim()) return json({ error: "选择客户" }, 400);
    if (!title || !title.trim()) return json({ error: "请输入主题" }, 400);
    if (!dueDate || !String(dueDate).trim()) {
      return json({ error: "选择交期" }, 400);
    }
    const oUrl = normalizeOrderUrl(orderUrl);
    if (oUrl === null) {
      return json({ error: "订单文件链接需以 http:// 或 https:// 开头" }, 400);
    }
    const pUrl = normalizeOrderUrl(purchaseUrl);
    if (pUrl === null) {
      return json({ error: "采购文件链接需以 http:// 或 https:// 开头" }, 400);
    }
    if (amount === undefined || amount === null || String(amount).trim() === "") {
      return json({ error: "输入金额" }, 400);
    }
    const amountNum = Number(amount);
    if (Number.isNaN(amountNum) || amountNum < 0) {
      return json({ error: "金额必须为非负数字" }, 400);
    }
    // 客户校验：
    //   ① 试用团队账号（未订阅，仅本人使用、无「客户管理」功能）：客户名称直接手工填写，
    //      放行并自动记入本人客户列表与团队客户列表（订阅后可在「客户管理」中看到）；
    //   ② 专业版团队管理员：从团队客户列表（或本人已分配客户）中选择；
    //   ③ 其他角色（业务部等）：必须在其被分配的客户列表中。
    const cname = customer.trim();
    if (isTeamAdmin(user.role) && !isProTeam(user)) {
      await rememberTrialCustomer(env, user, cname);
    } else if (isTeamAdmin(user.role)) {
      const teamCustomers = await getCustomerList(env, teamIdOf(user));
      const ownCustomers = await getCustomers(env, user.username);
      if (
        !teamCustomers.some((c) => c.name === cname) &&
        !ownCustomers.some((c) => c.name === cname)
      ) {
        return json({ error: "客户不存在，请先在「客户管理」中添加" }, 400);
      }
    } else {
      const customers = await getCustomers(env, user.username);
      if (!customers.some((c) => c.name === cname)) {
        return json({ error: "客户不存在，请联系管理员添加" }, 400);
      }
    }
    const todos = await getTodos(env, user.username);
    const todo = {
      id: genToken().slice(0, 12),
      customer: customer.trim(),
      title: title.trim(),
      dueDate: String(dueDate).trim(),
      amount: amountNum,
      currency: normalizeCurrency(currency), // USD=美元（默认）/ CNY=人民币
      orderUrl: oUrl,
      purchaseUrl: pUrl,
      notes: [],
      status: "pending", // 新建待办默认「待确认」
      done: false,
      createdAt: new Date().toISOString(),
    };


    todos.unshift(todo);
    await saveTodos(env, user.username, todos);
    return json({ ok: true, todo });
  }

  // ---- 追加备注（所有登录用户均可，包括业务主管；添加后不可删除）----
  if (pathname.startsWith("/api/todos/") && pathname.endsWith("/notes") && method === "POST") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    const id = decodeURIComponent(
      pathname.replace("/api/todos/", "").replace("/notes", "")
    );
    const body = await readBody(request);
    const text = body.text;
    if (!text || !text.trim()) return json({ error: "请输入备注内容" }, 400);

    // 观察类用户/团队管理员/总经理可对任意用户的待办添加备注；其他用户仅能对自己的待办添加
    let owner = user.username;
    if (isObserverRole(user.role) || canManageTodos(user.role)) {
      const requested = body.owner || user.username;
      if (requested !== user.username) {
        // 只能操作本团队成员（跨团队不可见）
        const member = await getTeamMember(env, requested, teamIdOf(user));
        if (!member) return json({ error: "无权操作该用户的待办" }, 403);
      }
      owner = requested;
    }

    const todos = await getTodos(env, owner);
    const idx = todos.findIndex((t) => t.id === id);
    if (idx === -1) return json({ error: "未找到" }, 404);
    if (!Array.isArray(todos[idx].notes)) todos[idx].notes = [];

    // @提及：取「前端选中」与「文本中解析」的并集，只保留本团队可 @ 的人员，且不提醒自己
    const mentionable = await listMentionable(env, teamIdOf(user));
    const allowed = new Set(mentionable.map((m) => m.username));
    const want = new Set();
    if (Array.isArray(body.mentions)) {
      for (const raw of body.mentions) {
        const name = String(raw || "").trim();
        if (name && allowed.has(name)) want.add(name);
      }
    }
    for (const name of parseMentions(text)) {
      if (allowed.has(name)) want.add(name);
    }
    want.delete(user.username); // 不给自己发提醒
    const mentions = [...want];

    const note = {
      id: genToken().slice(0, 12),
      text: text.trim(),
      author: user.username,
      createdAt: new Date().toISOString(),
      mentions, // 被 @ 的用户名（前端据此高亮显示）
    };
    todos[idx].notes.push(note);
    await saveTodos(env, owner, todos);
    // 被 @ 的成员各收到一条站内消息（顶栏登录名左侧红点，数字为未读 @ 次数）
    await addMentionRecords(env, user, mentions, {
      todoId: todos[idx].id,
      todoTitle: todos[idx].title,
      owner,
      text: note.text,
    });
    return json({ ok: true, note });
  }

  if (pathname.startsWith("/api/todos/") && method === "PUT") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (isObserverRole(user.role)) {
      return json({ error: memberRoleLabel(user) + "无编辑权限" }, 403);
    }
    const id = decodeURIComponent(pathname.replace("/api/todos/", ""));
    const body = await readBody(request);

    // 只有团队管理员 / 总经理可以改变待办状态（待确认/进行中/已完成）
    const wantsStatusChange =
      typeof body.status === "string" || typeof body.done === "boolean";
    if (wantsStatusChange && !canManageTodos(user.role)) {
      return json({ error: "只有团队管理员或总经理可以改变待办状态" }, 403);
    }

    // 团队管理员 / 总经理可操作本团队任意用户的待办；其他用户仅能操作自己的
    let owner = user.username;
    if (canManageTodos(user.role) && body.owner && body.owner !== user.username) {
      const member = await getTeamMember(env, body.owner, teamIdOf(user));
      if (!member) return json({ error: "无权操作该用户的待办" }, 403);
      owner = body.owner;
    }
    const todos = await getTodos(env, owner);
    const idx = todos.findIndex((t) => t.id === id);
    if (idx === -1) return json({ error: "未找到" }, 404);
    if (typeof body.title === "string") {
      const trimmedTitle = body.title.trim();
      if (!trimmedTitle) return json({ error: "请输入 PO# / 主题" }, 400);
      todos[idx].title = trimmedTitle;
    }
    // 交期 / 金额 / 订单文件链接 / 采购文件链接：仅「待确认」的待办可修改（管理员在列表上直接改）
    if (
      typeof body.dueDate === "string" ||
      body.amount !== undefined ||
      body.orderUrl !== undefined ||
      body.purchaseUrl !== undefined
    ) {
      const curStatus =
        todos[idx].status || (todos[idx].done ? "done" : "pending");
      if (curStatus !== "pending") {
        return json({ error: "仅「待确认」的待办可修改交期/金额/文件链接" }, 403);
      }
      if (typeof body.dueDate === "string") {
        const d = body.dueDate.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
          return json({ error: "请输入正确的交期" }, 400);
        }
        todos[idx].dueDate = d;
      }
      if (
        body.amount !== undefined &&
        body.amount !== null &&
        String(body.amount).trim() !== ""
      ) {
        const amountNum = Number(body.amount);
        if (Number.isNaN(amountNum) || amountNum < 0) {
          return json({ error: "金额必须为非负数字" }, 400);
        }
        todos[idx].amount = amountNum;
      }
      // 订单文件链接：传空字符串即清除
      if (body.orderUrl !== undefined) {
        const oUrl = normalizeOrderUrl(body.orderUrl);
        if (oUrl === null) {
          return json({ error: "订单文件链接需以 http:// 或 https:// 开头" }, 400);
        }
        todos[idx].orderUrl = oUrl;
      }
      // 采购文件链接：传空字符串即清除
      if (body.purchaseUrl !== undefined) {
        const pUrl = normalizeOrderUrl(body.purchaseUrl);
        if (pUrl === null) {
          return json({ error: "采购文件链接需以 http:// 或 https:// 开头" }, 400);
        }
        todos[idx].purchaseUrl = pUrl;
      }
    }
    // 指定生产方（来自本团队「生产方管理」列表）
    if (typeof body.producerId === "string" && body.producerId.trim()) {
      const producers = await getProducers(env, teamIdOf(user));
      const prod = producers.find((p) => p.id === body.producerId.trim());
      if (!prod) return json({ error: "生产方不存在，请先在「生产方管理」中添加" }, 400);
      todos[idx].producerId = prod.id;
      todos[idx].producerName = prod.username;
      todos[idx].producerAssignedAt = new Date().toISOString();
    }
    // 状态：pending=待确认，doing=进行中，done=已完成
    if (typeof body.status === "string") {
      const valid = ["pending", "doing", "done"];
      if (!valid.includes(body.status)) {
        return json({ error: "无效的状态" }, 400);
      }
      todos[idx].status = body.status;
      todos[idx].done = body.status === "done";
    } else if (typeof body.done === "boolean") {
      todos[idx].done = body.done;
      todos[idx].status = body.done ? "done" : "doing";
    }
    // 转入「进行中」时：**专业版团队**必须同时指定生产方（生产部据此可见）；
    // 试用团队没有「生产方管理」功能（无法添加生产方），不做此限制，允许直接改为「进行中」
    if (todos[idx].status === "doing" && !todos[idx].producerId) {
      if (await isProTeamOf(env, user)) {
        return json({ error: "请为该待办指定生产方（生产方来自「生产方管理」）" }, 400);
      }
    }
    await saveTodos(env, owner, todos);
    return json({ ok: true, todo: todos[idx] });
  }

  // ---- 补填「采购文件链接」（订单行上缺链接的黄色「自产单 / 外购单」标签）----
  //   规则：① 登录且「采购订单下单」权限 = 有（团队管理员固定有；业务部成员在「成员管理」中单独开关，
  //          与「客户订单录入」相互独立）；
  //         ② 只能补「当前没有采购文件链接」的订单（已有链接仍需团队管理员在「待确认」阶段修改）；
  //         ③ 只能操作自己或本团队成员的订单（团队隔离）；不限订单状态。
  if (
    pathname.startsWith("/api/todos/") &&
    pathname.endsWith("/purchase-link") &&
    method === "POST"
  ) {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (!canPurchaseOrder(user)) {
      return json(
        {
          error:
            memberRoleLabel(user) +
            "无「采购订单下单」权限，请联系团队管理员在「成员管理」中开通",
        },
        403
      );
    }
    const id = decodeURIComponent(
      pathname.replace("/api/todos/", "").replace("/purchase-link", "")
    );
    const body = await readBody(request);
    let owner = user.username;
    if (body.owner && body.owner !== user.username) {
      const member = await getTeamMember(env, body.owner, teamIdOf(user));
      if (!member) return json({ error: "无权操作该用户的待办" }, 403);
      owner = body.owner;
    }
    const todos = await getTodos(env, owner);
    const idx = todos.findIndex((t) => t.id === id);
    if (idx === -1) return json({ error: "未找到" }, 404);
    if (todos[idx].purchaseUrl) {
      return json({ error: "该订单已有采购文件链接，如需修改请联系团队管理员" }, 403);
    }
    const link = normalizeOrderUrl(body.purchaseUrl);
    if (link === null) {
      return json({ error: "采购文件链接需以 http:// 或 https:// 开头" }, 400);
    }
    if (!link) return json({ error: "请输入采购文件链接" }, 400);
    todos[idx].purchaseUrl = link;
    await saveTodos(env, owner, todos);
    return json({ ok: true, purchaseUrl: link });
  }

  if (pathname.startsWith("/api/todos/") && method === "DELETE") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (isObserverRole(user.role)) {
      return json({ error: memberRoleLabel(user) + "无删除权限" }, 403);
    }
    const id = decodeURIComponent(pathname.replace("/api/todos/", ""));
    // 团队管理员 / 总经理可通过 ?owner= 删除本团队任意用户的待办
    let owner = user.username;
    if (canManageTodos(user.role)) {
      const qOwner = new URL(request.url).searchParams.get("owner");
      if (qOwner && qOwner !== user.username) {
        const member = await getTeamMember(env, qOwner, teamIdOf(user));
        if (!member) return json({ error: "无权操作该用户的待办" }, 403);
        owner = qOwner;
      }
    }
    let todos = await getTodos(env, owner);
    const target = todos.find((t) => t.id === id);
    if (!target) return json({ error: "未找到" }, 404);
    // 已进入「进行中/已完成」状态的事件不可删除（含管理员，避免误删）
    const targetStatus = target.status || (target.done ? "done" : "pending");
    if (targetStatus !== "pending") {
      return json({ error: "该事件已进入「进行中/已完成」状态，无法删除" }, 403);
    }

    todos = todos.filter((t) => t.id !== id);
    await saveTodos(env, owner, todos);
    return json({ ok: true });
  }


  return json({ error: "接口不存在" }, 404);
}

// ============ 主入口 ============

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // API 路由
    if (pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, pathname);
      } catch (e) {
        return json({ error: "服务器错误: " + e.message }, 500);
      }
    }

    // 页面路由
    if (pathname === "/" || pathname === "/login") {
      // 网站名称 + 是否允许新用户注册 + 联系邮箱 + 网站图标
      //（关闭注册时登录页不渲染「新帐户注册」入口）
      const g = await getGlobalSettings(env);
      return new Response(loginPage(g.siteName, g.allowRegister, g.supportEmail, g.favicon), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }


    if (pathname === "/todos") {
      const g = await getGlobalSettings(env);
      return new Response(todoPage(g.favicon), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // 超级管理员控制台（团队用户管理）：仅超级管理员可访问
    if (pathname === "/admin") {
      const user = await getCurrentUser(request, env);
      if (!user) {
        return Response.redirect(url.origin + "/", 302);
      }
      if (!isSuperAdmin(user.role)) {
        return Response.redirect(url.origin + "/todos", 302);
      }
      const g = await getGlobalSettings(env);
      return new Response(adminPage(g.favicon), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};
