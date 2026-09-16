import { loginPage, todoPage } from "./pages.js";

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

// 获取当前登录用户
async function getCurrentUser(request, env) {
  const token = getToken(request);
  if (!token) return null;
  const username = await env.TODO_KV.get(`session:${token}`);
  if (!username) return null;
  const userRaw = await env.TODO_KV.get(`user:${username}`);
  if (!userRaw) return null;
  return JSON.parse(userRaw);
}

// 初始化默认管理员
async function ensureAdmin(env) {
  const existing = await env.TODO_KV.get("user:admin");
  if (!existing) {
    const admin = {
      username: "admin",
      password: await hashPassword("admin"),
      role: "admin",
      createdAt: new Date().toISOString(),
    };
    await env.TODO_KV.put("user:admin", JSON.stringify(admin));
  }
}

// 获取所有用户列表
async function listUsers(env) {
  const list = await env.TODO_KV.list({ prefix: "user:" });
  const users = [];
  for (const key of list.keys) {
    const raw = await env.TODO_KV.get(key.name);
    if (raw) {
      const u = JSON.parse(raw);
      // 生产方 / 客户登录账号在各自的管理弹窗中维护，不出现在成员管理列表里
      if (u.role === "producer" || u.role === "customer") continue;
      const record = {
        username: u.username,
        role: u.role,
        createdAt: u.createdAt,
        remark: u.remark || "",
      };
      // 受限观察用户附带「可观察生产方」id 列表
      if (u.role === "restricted") {
        record.watched = await getWatchProducers(env, u.username);
      }
      users.push(record);
    }
  }
  return users;
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

// 获取全局客户列表（「客户管理」维护；成员管理中为「可录入用户」分配客户时从这里选择）
async function getCustomerList(env) {
  const raw = await env.TODO_KV.get("customerList");
  return raw ? JSON.parse(raw) : [];
}

// 保存全局客户列表
async function saveCustomerList(env, list) {
  await env.TODO_KV.put("customerList", JSON.stringify(list));
}

// 获取生产方列表（全局共享，所有成员可见）
// 兼容历史数据：早期字段名为 shortName，现统一为 username（同时作为生产方登录账号）
async function getProducers(env) {
  const raw = await env.TODO_KV.get("producers");
  const list = raw ? JSON.parse(raw) : [];
  return list.map((p) => ({
    id: p.id,
    username: p.username || p.shortName || "",
    description: p.description || "",
    createdAt: p.createdAt,
  }));
}

// 保存生产方列表（全局共享）
async function saveProducers(env, producers) {
  await env.TODO_KV.put("producers", JSON.stringify(producers));
}

// 获取某受限观察用户「可观察的生产方」id 列表
async function getWatchProducers(env, username) {
  const raw = await env.TODO_KV.get(`watch:${username}`);
  return raw ? JSON.parse(raw) : [];
}

// 保存某受限观察用户「可观察的生产方」id 列表
async function saveWatchProducers(env, username, ids) {
  await env.TODO_KV.put(`watch:${username}`, JSON.stringify(ids));
}

// 角色名称
const ROLE_LABEL = {
  admin: "管理员",
  editor: "可录入用户",
  viewer: "观察用户",
  restricted: "受限观察用户",
  producer: "生产方",
  customer: "客户",
  superviewer: "超级观察者",
};

function roleLabel(role) {
  return ROLE_LABEL[role] || role || "";
}

// 观察类角色（观察用户 / 受限观察用户 / 生产方 / 客户）：只读，但可添加备注
function isObserverRole(role) {
  return (
    role === "viewer" ||
    role === "restricted" ||
    role === "producer" ||
    role === "customer"
  );
}

// 待办管理权限：管理员 / 超级观察者（超级观察者拥有管理员的全部待办相关功能：
// 查看所有用户的待办、改变状态、指定生产方、修改待确认待办、删除待办），
// 但不具备「系统设置 / 成员管理 / 生产方管理 / 客户管理」这些管理功能。
function canManageTodos(role) {
  return role === "admin" || role === "superviewer";
}


// 获取所有用户的待办
// onlyVisible=true 时仅返回「进行中/已完成」的待办（观察用户可见范围）
// producerIds 非空时仅返回指定生产方的待办（受限观察用户可见范围）
async function getAllTodos(env, onlyVisible = false, producerIds = null) {
  const list = await env.TODO_KV.list({ prefix: "todos:" });
  const result = [];
  for (const key of list.keys) {
    const owner = key.name.replace("todos:", "");
    const raw = await env.TODO_KV.get(key.name);
    const todos = raw ? JSON.parse(raw) : [];
    for (const t of todos) {
      const status = t.status || (t.done ? "done" : "pending");
      // 观察用户只能看到非「待确认」的待办
      if (onlyVisible && status === "pending") continue;
      // 受限观察用户：只能看到被授权生产方的待办
      if (producerIds && !producerIds.includes(t.producerId)) continue;
      result.push({ ...t, status, owner });
    }
  }
  // 按创建时间倒序
  result.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return result;
}

// ============ 路由处理 ============

async function handleApi(request, env, pathname) {
  const method = request.method;

  // ---- 登录 ----
  if (pathname === "/api/login" && method === "POST") {
    await ensureAdmin(env);
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
    const token = genToken();
    // session 有效期 7 天
    await env.TODO_KV.put(`session:${token}`, username, {
      expirationTtl: 60 * 60 * 24 * 7,
    });
    return new Response(JSON.stringify({ ok: true, username, role: user.role }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie": `token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
          60 * 60 * 24 * 7
        }`,
      },
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
    return json({ username: user.username, role: user.role });
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

  // ---- 站点设置 ----
  // 获取设置（所有登录用户可读）
  if (pathname === "/api/settings" && method === "GET") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    const raw = await env.TODO_KV.get("settings");
    const settings = raw ? JSON.parse(raw) : {};
    return json({ settings: { siteName: settings.siteName || "待办清单" } });
  }

  // 保存设置（仅 admin）
  if (pathname === "/api/settings" && method === "POST") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (user.role !== "admin") return json({ error: "无权限" }, 403);
    const { siteName } = await readBody(request);
    if (!siteName || !siteName.trim()) {
      return json({ error: "请输入网站名称" }, 400);
    }
    const raw = await env.TODO_KV.get("settings");
    const settings = raw ? JSON.parse(raw) : {};
    settings.siteName = siteName.trim();
    await env.TODO_KV.put("settings", JSON.stringify(settings));
    return json({ ok: true, settings: { siteName: settings.siteName } });
  }

  // ---- 用户管理（仅 admin）----
  if (pathname === "/api/users" && method === "GET") {

    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (user.role !== "admin") return json({ error: "无权限" }, 403);
    return json({ users: await listUsers(env) });
  }

  if (pathname === "/api/users" && method === "POST") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (user.role !== "admin") return json({ error: "无权限" }, 403);
    const { username, password, role } = await readBody(request);
    if (!username || !password) {
      return json({ error: "请填写用户名和密码" }, 400);
    }
    // 角色：editor=可录入用户，viewer=观察用户，restricted=受限观察用户，superviewer=超级观察者
    const finalRole = ["viewer", "restricted", "superviewer"].includes(role)
      ? role
      : "editor";
    const existing = await env.TODO_KV.get(`user:${username}`);
    if (existing) return json({ error: "用户名已存在" }, 400);
    const newUser = {
      username,
      password: await hashPassword(password),
      role: finalRole,
      createdAt: new Date().toISOString(),
    };
    await env.TODO_KV.put(`user:${username}`, JSON.stringify(newUser));
    return json({ ok: true });
  }

  if (pathname.startsWith("/api/users/") && method === "DELETE") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (user.role !== "admin") return json({ error: "无权限" }, 403);
    const target = decodeURIComponent(pathname.replace("/api/users/", ""));
    if (target === "admin") return json({ error: "不能删除管理员" }, 400);
    await env.TODO_KV.delete(`user:${target}`);
    await env.TODO_KV.delete(`todos:${target}`);
    await env.TODO_KV.delete(`customers:${target}`);
    await env.TODO_KV.delete(`watch:${target}`);
    return json({ ok: true });
  }

  // ---- 重置成员密码（仅 admin）----
  if (
    pathname.startsWith("/api/users/") &&
    pathname.endsWith("/reset-password") &&
    method === "POST"
  ) {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (user.role !== "admin") return json({ error: "无权限" }, 403);
    const target = decodeURIComponent(
      pathname.replace("/api/users/", "").replace("/reset-password", "")
    );
    const { newPassword } = await readBody(request);
    if (!newPassword || !newPassword.trim()) {
      return json({ error: "请输入新密码" }, 400);
    }
    const raw = await env.TODO_KV.get(`user:${target}`);
    if (!raw) {
      // 兼容历史生产方：还没有登录账号时，用本次设置的新密码创建生产方账号
      const producers = await getProducers(env);
      const prod = producers.find((p) => p.username === target);
      if (prod) {
        await env.TODO_KV.put(
          `user:${target}`,
          JSON.stringify({
            username: target,
            password: await hashPassword(newPassword),
            role: "producer",
            producerId: prod.id,
            createdAt: new Date().toISOString(),
          })
        );
        return json({ ok: true, created: true });
      }
      // 兼容历史客户：还没有登录账号时，用本次设置的新密码创建客户账号
      const customers = await getCustomerList(env);
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
            createdAt: new Date().toISOString(),
          })
        );
        return json({ ok: true, created: true });
      }
      return json({ error: "成员不存在" }, 404);
    }
    const targetUser = JSON.parse(raw);
    targetUser.password = await hashPassword(newPassword);
    await env.TODO_KV.put(`user:${target}`, JSON.stringify(targetUser));
    return json({ ok: true });
  }

  // ---- 成员备注（仅 admin；留空表示清除备注）----
  if (
    pathname.startsWith("/api/users/") &&
    pathname.endsWith("/remark") &&
    method === "POST"
  ) {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (user.role !== "admin") return json({ error: "无权限" }, 403);
    const target = decodeURIComponent(
      pathname.replace("/api/users/", "").replace("/remark", "")
    );
    const { remark } = await readBody(request);
    const raw = await env.TODO_KV.get(`user:${target}`);
    if (!raw) return json({ error: "成员不存在" }, 404);
    const targetUser = JSON.parse(raw);
    targetUser.remark = String(remark || "").trim();
    await env.TODO_KV.put(`user:${target}`, JSON.stringify(targetUser));
    return json({ ok: true, remark: targetUser.remark });
  }


  // ---- 客户管理 ----
  // 获取某成员的客户列表（管理员可查任意成员；可录入用户可查自己的）
  if (pathname.startsWith("/api/customers/") && method === "GET") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    const target = decodeURIComponent(pathname.replace("/api/customers/", ""));
    if (user.role !== "admin" && target !== user.username) {
      return json({ error: "无权限" }, 403);
    }
    return json({ customers: await getCustomers(env, target) });
  }

  // 为某成员新增客户（仅 admin）
  if (pathname.startsWith("/api/customers/") && method === "POST") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (user.role !== "admin") return json({ error: "无权限" }, 403);
    const target = decodeURIComponent(pathname.replace("/api/customers/", ""));
    // globalId：来自「客户管理」的全局客户 id；传了就直接复用（便于去重）
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

  // 删除某成员的客户（仅 admin）
  if (pathname.startsWith("/api/customers/") && method === "DELETE") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (user.role !== "admin") return json({ error: "无权限" }, 403);
    const rest = decodeURIComponent(pathname.replace("/api/customers/", ""));
    const slash = rest.lastIndexOf("/");
    if (slash === -1) return json({ error: "参数错误" }, 400);
    const target = rest.slice(0, slash);
    const cid = rest.slice(slash + 1);
    let customers = await getCustomers(env, target);
    customers = customers.filter((c) => c.id !== cid);
    await saveCustomers(env, target, customers);
    return json({ ok: true });
  }


  // ---- 客户管理（全局共享；成员管理中为「可录入用户」分配客户时从这里选择；仅 admin 可增删）----
  // 获取全局客户列表（所有登录用户可读）
  if (pathname === "/api/customer-list" && method === "GET") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    return json({ customers: await getCustomerList(env) });
  }

  // 新增客户（仅 admin）：字段为「用户名」（也是客户名称）、「密码」和「说明」；同时创建客户登录账号
  if (pathname === "/api/customer-list" && method === "POST") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (user.role !== "admin") return json({ error: "无权限" }, 403);
    const { name, password, description } = await readBody(request);
    if (!name || !name.trim()) return json({ error: "请输入用户名" }, 400);
    if (!password || !String(password).trim()) {
      return json({ error: "请输入密码" }, 400);
    }
    const list = await getCustomerList(env);
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
    await saveCustomerList(env, list);
    // 同时创建客户登录账号（role=customer，绑定该客户 id 与名称）
    await env.TODO_KV.put(
      `user:${trimmed}`,
      JSON.stringify({
        username: trimmed,
        password: await hashPassword(String(password).trim()),
        role: "customer",
        customerId: customer.id,
        customerName: trimmed,
        createdAt: customer.createdAt,
      })
    );
    return json({ ok: true, customer });
  }

  // 删除客户（仅 admin；已分配给成员的记录不会自动移除）
  if (pathname.startsWith("/api/customer-list/") && method === "DELETE") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (user.role !== "admin") return json({ error: "无权限" }, 403);
    const id = decodeURIComponent(pathname.replace("/api/customer-list/", ""));
    let list = await getCustomerList(env);
    const target = list.find((c) => c.id === id);
    list = list.filter((c) => c.id !== id);
    await saveCustomerList(env, list);
    // 同步删除该客户的登录账号（已录入的待办保留客户名称快照）
    if (target && target.name) {
      await env.TODO_KV.delete(`user:${target.name}`);
    }
    return json({ ok: true });
  }


  // 修改全局客户「说明」（仅 admin；留空即清除说明）
  if (
    pathname.startsWith("/api/customer-list/") &&
    pathname.endsWith("/description") &&
    method === "POST"
  ) {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (user.role !== "admin") return json({ error: "无权限" }, 403);
    const id = decodeURIComponent(
      pathname.replace("/api/customer-list/", "").replace("/description", "")
    );
    const { description } = await readBody(request);
    const list = await getCustomerList(env);
    const cust = list.find((c) => c.id === id);
    if (!cust) return json({ error: "客户不存在" }, 404);
    cust.description = String(description || "").trim();
    await saveCustomerList(env, list);
    return json({ ok: true, description: cust.description });
  }


  // ---- 生产方管理（全局共享；仅 admin 可增删）----
  // 获取生产方列表（所有登录用户可读）
  if (pathname === "/api/producers" && method === "GET") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    return json({ producers: await getProducers(env) });
  }

  // 新增生产方（仅 admin）：字段为「用户名」「密码」（生产方用该账号登录，只看指定给自己的待办）和「说明」
  if (pathname === "/api/producers" && method === "POST") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (user.role !== "admin") return json({ error: "无权限" }, 403);
    const { username, password, description } = await readBody(request);
    const uname = (username || "").trim();
    if (!uname) return json({ error: "请输入用户名" }, 400);
    if (!password || !String(password).trim()) {
      return json({ error: "请输入密码" }, 400);
    }
    const producers = await getProducers(env);
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
      createdAt: new Date().toISOString(),
    };
    producers.push(producer);
    await saveProducers(env, producers);
    // 同时创建生产方登录账号（role=producer，绑定该生产方 id）
    await env.TODO_KV.put(
      `user:${uname}`,
      JSON.stringify({
        username: uname,
        password: await hashPassword(String(password).trim()),
        role: "producer",
        producerId: producer.id,
        createdAt: producer.createdAt,
      })
    );
    return json({ ok: true, producer });
  }

  // 删除生产方（仅 admin）
  if (pathname.startsWith("/api/producers/") && method === "DELETE") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (user.role !== "admin") return json({ error: "无权限" }, 403);
    const id = decodeURIComponent(pathname.replace("/api/producers/", ""));
    let producers = await getProducers(env);
    const target = producers.find((p) => p.id === id);
    producers = producers.filter((p) => p.id !== id);
    await saveProducers(env, producers);
    // 同步删除该生产方的登录账号（已指定该生产方的待办保留名称快照）
    if (target && target.username) {
      await env.TODO_KV.delete(`user:${target.username}`);
    }
    return json({ ok: true });
  }


  // 修改生产方「说明」（仅 admin；留空即清除说明）
  if (
    pathname.startsWith("/api/producers/") &&
    pathname.endsWith("/description") &&
    method === "POST"
  ) {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (user.role !== "admin") return json({ error: "无权限" }, 403);
    const id = decodeURIComponent(
      pathname.replace("/api/producers/", "").replace("/description", "")
    );
    const { description } = await readBody(request);
    const producers = await getProducers(env);
    const prod = producers.find((p) => p.id === id);
    if (!prod) return json({ error: "生产方不存在" }, 404);
    prod.description = String(description || "").trim();
    await saveProducers(env, producers);
    return json({ ok: true, description: prod.description });
  }


  // ---- 受限观察用户「可观察生产方」授权（仅 admin 可改；本人可读）----
  const watchPrefix = "/api/watch/";

  // 查询某受限观察用户可观察的生产方（管理员可查任意成员；本人可查自己）
  if (pathname.startsWith(watchPrefix) && method === "GET") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    const target = decodeURIComponent(pathname.replace(watchPrefix, ""));
    if (user.role !== "admin" && target !== user.username) {
      return json({ error: "无权限" }, 403);
    }
    const ids = await getWatchProducers(env, target);
    const producers = await getProducers(env);
    // 已删除的生产方以占位形式返回，便于管理员清理授权（与「可见范围」保持一致）
    const granted = ids.map((id) => {
      const p = producers.find((x) => x.id === id);
      return p ? p : { id, username: "（已删除的生产方）", description: "", deleted: true };
    });
    return json({ producers: granted });
  }

  // 授权某受限观察用户可观察某生产方（仅 admin）
  if (pathname.startsWith(watchPrefix) && method === "POST") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (user.role !== "admin") return json({ error: "无权限" }, 403);
    const target = decodeURIComponent(pathname.replace(watchPrefix, ""));
    const { producerId } = await readBody(request);
    if (!producerId || !String(producerId).trim()) {
      return json({ error: "请选择生产方" }, 400);
    }
    const pid = String(producerId).trim();
    const producers = await getProducers(env);
    if (!producers.some((p) => p.id === pid)) {
      return json({ error: "生产方不存在，请先在「生产方管理」中添加" }, 400);
    }
    const raw = await env.TODO_KV.get(`user:${target}`);
    if (!raw) return json({ error: "成员不存在" }, 404);
    if (JSON.parse(raw).role !== "restricted") {
      return json({ error: "该成员不是受限观察用户" }, 400);
    }
    const ids = await getWatchProducers(env, target);
    if (ids.includes(pid)) return json({ error: "已授权该生产方" }, 400);
    ids.push(pid);
    await saveWatchProducers(env, target, ids);
    return json({ ok: true, producerIds: ids });
  }

  // 取消授权（仅 admin）
  if (pathname.startsWith(watchPrefix) && method === "DELETE") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (user.role !== "admin") return json({ error: "无权限" }, 403);
    const rest = decodeURIComponent(pathname.replace(watchPrefix, ""));
    const slash = rest.lastIndexOf("/");
    if (slash === -1) return json({ error: "参数错误" }, 400);
    const target = rest.slice(0, slash);
    const pid = rest.slice(slash + 1);
    let ids = await getWatchProducers(env, target);
    ids = ids.filter((x) => x !== pid);
    await saveWatchProducers(env, target, ids);
    return json({ ok: true, producerIds: ids });
  }


  // ---- 待办列表 ----
  if (pathname === "/api/todos" && method === "GET") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    // 管理员 / 超级观察者：可查看所有用户的待办（含待确认）
    if (canManageTodos(user.role)) {
      return json({
        todos: await getAllTodos(env, false),
        readonly: false,
        allUsers: true,
      });
    }
    // 观察用户仅能看到「进行中/已完成」的待办（待确认不可见）
    if (user.role === "viewer") {
      return json({
        todos: await getAllTodos(env, true),
        readonly: true,
        allUsers: true,
      });
    }
    // 受限观察用户仅能看到「被授权生产方」且非「待确认」的待办
    if (user.role === "restricted") {
      const ids = await getWatchProducers(env, user.username);
      return json({
        todos: await getAllTodos(env, true, ids),
        readonly: true,
        allUsers: true,
      });
    }
    // 生产方账号：仅能看到「指定给自己」且非「待确认」的待办
    if (user.role === "producer") {
      const producers = await getProducers(env);
      const me = producers.find((p) => p.id === user.producerId);
      return json({
        todos: await getAllTodos(env, true, me ? [me.id] : []),
        readonly: true,
        allUsers: true,
      });
    }
    // 客户账号：仅能看到「该客户名下」且非「待确认」的待办
    if (user.role === "customer") {
      const cname = user.customerName || "";
      const visible = cname ? await getAllTodos(env, true) : [];
      return json({
        todos: visible.filter((t) => t.customer === cname),
        readonly: true,
        allUsers: true,
      });
    }
    return json({ todos: await getTodos(env, user.username), readonly: false });
  }

  if (pathname === "/api/todos" && method === "POST") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (isObserverRole(user.role)) {
      return json({ error: roleLabel(user.role) + "无录入权限" }, 403);
    }
    const { title, customer, dueDate, amount, orderUrl, purchaseUrl } = await readBody(request);
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
    // 校验客户必须在该成员的客户列表中
    const customers = await getCustomers(env, user.username);
    if (!customers.some((c) => c.name === customer.trim())) {
      return json({ error: "客户不存在，请联系管理员添加" }, 400);
    }
    const todos = await getTodos(env, user.username);
    const todo = {
      id: genToken().slice(0, 12),
      customer: customer.trim(),
      title: title.trim(),
      dueDate: String(dueDate).trim(),
      amount: amountNum,
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

  // ---- 追加备注（所有登录用户均可，包括观察用户；添加后不可删除）----
  if (pathname.startsWith("/api/todos/") && pathname.endsWith("/notes") && method === "POST") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    const id = decodeURIComponent(
      pathname.replace("/api/todos/", "").replace("/notes", "")
    );
    const body = await readBody(request);
    const text = body.text;
    if (!text || !text.trim()) return json({ error: "请输入备注内容" }, 400);

    // 观察类用户/管理员/超级观察者可对任意用户的待办添加备注；其他用户仅能对自己的待办添加
    let owner = user.username;
    if (isObserverRole(user.role) || canManageTodos(user.role)) {
      owner = body.owner || user.username;
    }

    const todos = await getTodos(env, owner);
    const idx = todos.findIndex((t) => t.id === id);
    if (idx === -1) return json({ error: "未找到" }, 404);
    if (!Array.isArray(todos[idx].notes)) todos[idx].notes = [];
    const note = {
      id: genToken().slice(0, 12),
      text: text.trim(),
      author: user.username,
      createdAt: new Date().toISOString(),
    };
    todos[idx].notes.push(note);
    await saveTodos(env, owner, todos);
    return json({ ok: true, note });
  }

  if (pathname.startsWith("/api/todos/") && method === "PUT") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (isObserverRole(user.role)) {
      return json({ error: roleLabel(user.role) + "无编辑权限" }, 403);
    }
    const id = decodeURIComponent(pathname.replace("/api/todos/", ""));
    const body = await readBody(request);

    // 只有管理员 / 超级观察者可以改变待办状态（待确认/进行中/已完成）
    const wantsStatusChange =
      typeof body.status === "string" || typeof body.done === "boolean";
    if (wantsStatusChange && !canManageTodos(user.role)) {
      return json({ error: "只有管理员或超级观察者可以改变待办状态" }, 403);
    }

    // 管理员 / 超级观察者可操作任意用户的待办；其他用户仅能操作自己的
    let owner = user.username;
    if (canManageTodos(user.role) && body.owner) {
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
    // 指定生产方（来自「生产方管理」中的全局列表）
    if (typeof body.producerId === "string" && body.producerId.trim()) {
      const producers = await getProducers(env);
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
    // 转入「进行中」时，必须同时指定生产方（受限观察用户据此可见）
    if (todos[idx].status === "doing" && !todos[idx].producerId) {
      return json({ error: "请为该待办指定生产方（生产方来自「生产方管理」）" }, 400);
    }
    await saveTodos(env, owner, todos);
    return json({ ok: true, todo: todos[idx] });
  }

  if (pathname.startsWith("/api/todos/") && method === "DELETE") {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: "未登录" }, 401);
    if (isObserverRole(user.role)) {
      return json({ error: roleLabel(user.role) + "无删除权限" }, 403);
    }
    const id = decodeURIComponent(pathname.replace("/api/todos/", ""));
    // 管理员 / 超级观察者可通过 ?owner= 删除任意用户的待办
    let owner = user.username;
    if (canManageTodos(user.role)) {
      const qOwner = new URL(request.url).searchParams.get("owner");
      if (qOwner) owner = qOwner;
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
      let siteName = "待办清单";
      try {
        const raw = await env.TODO_KV.get("settings");
        if (raw) {
          const settings = JSON.parse(raw);
          if (settings.siteName) siteName = settings.siteName;
        }
      } catch (e) { /* 忽略 */ }
      return new Response(loginPage(siteName), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }


    if (pathname === "/todos") {
      return new Response(todoPage(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};
