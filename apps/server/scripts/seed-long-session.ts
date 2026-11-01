/**
 * 向本地 SQLite 注入一条"长会话"mock 数据——用于人工验证
 * 聊天页虚拟滚动（MessageList / useMessageVirtualizer）在长列表下的
 * 滚动稳定性与渲染性能。
 *
 * 用法（在 apps/server 下）：
 *   pnpm exec tsx scripts/seed-long-session.ts
 *   DATA_DIR=./data pnpm exec tsx scripts/seed-long-session.ts
 *
 * 幂等：重复执行会先删除同名会话再重建。
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

const SESSION_TITLE = '长会话压测（mock）';
const ROUNDS = 60; // 60 组问答 = 120 条消息

const dataDir = resolve(process.env.DATA_DIR || './data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
const db = new Database(resolve(dataDir, 'my-copilot.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

/** 问答模板：刻意制造高度差异——短句 / 中长 markdown / 大代码块 / 表格 / 超长文本 */
const QA_PAIRS: Array<{ user: string; assistant: string }> = [
  {
    user: '用一句话解释什么是虚拟滚动',
    assistant:
      '虚拟滚动就是只渲染视口内（及少量预加载）的列表条目，用一个总高占位元素维持真实滚动条，从而把 DOM 数量从 N 降到可视范围常数级。',
  },
  {
    user: '给我一段 TypeScript 的防抖函数示例',
    assistant: `防抖（debounce）的核心是"延迟执行 + 重置计时器"：

\`\`\`typescript
function debounce<A extends unknown[]>(fn: (...args: A) => void, waitMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  };
}

// 用法：输入停止 300ms 后才触发搜索
const onSearch = debounce((keyword: string) => {
  console.log('search:', keyword);
}, 300);
\`\`\`

与节流（throttle）的区别：防抖只在事件停止后执行一次，节流是固定频率执行。搜索框用防抖，滚动加载用节流。`,
  },
  {
    user: '对比一下 SQLite 的 WAL 和 DELETE 日志模式',
    assistant: `| 特性 | DELETE（默认） | WAL |
| --- | --- | --- |
| 写入方式 | 直接写原文件 | 先写 WAL 日志，checkpoint 合并 |
| 读写并发 | 写阻塞读 | 读写不互相阻塞 |
| 性能 | 小事务较慢 | 小事务显著更快 |
| 适用场景 | 简单、低频写 | 高频写 + 并发读 |

几点注意：

1. WAL 模式下数据库目录会多出 \`.db-wal\` 和 \`.db-shm\` 文件；
2. WAL 不支持通过网络文件系统（NFS/SMB）；
3. 建议同时开启 \`busy_timeout\`，避免写锁竞争直接报 SQLITE_BUSY。`,
  },
  {
    user: '写一个较长的 React 自定义 Hook：管理倒计时',
    assistant: `一个支持暂停/恢复/重置的倒计时 Hook：

\`\`\`typescript
import { useCallback, useEffect, useRef, useState } from 'react';

export function useCountdown(initialSeconds: number) {
  const [remaining, setRemaining] = useState(initialSeconds);
  const [running, setRunning] = useState(false);
  const deadlineRef = useRef<number>(0);

  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const left = Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) setRunning(false);
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [running]);

  const start = useCallback((seconds?: number) => {
    const total = seconds ?? initialSeconds;
    deadlineRef.current = Date.now() + total * 1000;
    setRemaining(total);
    setRunning(true);
  }, [initialSeconds]);

  const pause = useCallback(() => setRunning(false), []);
  const resume = useCallback(() => {
    deadlineRef.current = Date.now() + remaining * 1000;
    setRunning(true);
  }, [remaining]);
  const reset = useCallback(() => {
    setRunning(false);
    setRemaining(initialSeconds);
  }, [initialSeconds]);

  return { remaining, running, start, pause, resume, reset };
}
\`\`\`

设计要点：用 deadline 时间戳而非每秒减一，避免 interval 漂移；250ms 采样保证秒数切换及时；resume 以剩余秒数重建 deadline。`,
  },
  {
    user: '输出一大段没有结构的纯文本，测试超长消息渲染',
    assistant: Array.from({ length: 24 }, (_, i) =>
      `第 ${i + 1} 段：这是一段用于压力测试的填充文本。它没有代码块、没有表格、没有列表，只有连续的中文段落，目的是制造一个高度非常大的普通消息气泡，验证虚拟滚动对"超高条目"的处理：滚动经过它时估算高度与真实高度的偏差、测量修正时的滚动补偿，以及它部分进入视口时 ResizeObserver 的表现。填充内容本身没有信息量，重要的是长度与行数。`,
    ).join('\n\n'),
  },
  {
    user: '列举常见 HTTP 状态码',
    assistant: `常见状态码速查：

- **200 OK**：成功
- **201 Created**：资源已创建（POST 之后）
- **204 No Content**：成功但无返回体
- **301 / 302**：永久 / 临时重定向
- **304 Not Modified**：协商缓存命中
- **400 Bad Request**：请求参数错误
- **401 / 403**：未认证 / 无权限
- **404 Not Found**：资源不存在
- **409 Conflict**：状态冲突（如重复创建）
- **422 Unprocessable Entity**：语义校验失败
- **429 Too Many Requests**：限流
- **500 / 502 / 503**：服务端错误 / 网关错误 / 不可用`,
  },
];

// ---- 生成并写入 ----

const insertMessage = db.prepare(
  `INSERT INTO messages (id, session_id, role, content, attachments, tool_calls, tool_call_id, status, error, created_at)
   VALUES (?, ?, ?, ?, '[]', NULL, NULL, 'sent', NULL, ?)`,
);
const insertSession = db.prepare(
  `INSERT INTO sessions (id, title, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
);

const seed = db.transaction(() => {
  // 幂等：清掉同名旧会话（messages 显式删，不依赖 FK 级联）
  const oldIds = (
    db.prepare('SELECT id FROM sessions WHERE title = ?').all(SESSION_TITLE) as Array<{ id: string }>
  ).map((r) => r.id);
  for (const oldId of oldIds) {
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(oldId);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(oldId);
  }

  // 绑定第一个启用模型（避免前端"未绑定模型"警告横幅）；没有模型则留空
  const model = db
    .prepare('SELECT id FROM models WHERE enabled = 1 LIMIT 1')
    .get() as { id: string } | undefined;

  const sessionId = randomUUID();
  const base = Date.now() - ROUNDS * 2 * 60_000; // 时间戳从过去开始递增
  insertSession.run(sessionId, SESSION_TITLE, model?.id ?? null, base, base);

  let inserted = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const qa = QA_PAIRS[i % QA_PAIRS.length]!;
    const userTs = base + i * 120_000;
    const assistantTs = userTs + 60_000;
    insertMessage.run(randomUUID(), sessionId, 'user', qa.user, userTs);
    insertMessage.run(randomUUID(), sessionId, 'assistant', qa.assistant, assistantTs);
    inserted += 2;
  }
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(
    base + ROUNDS * 120_000,
    sessionId,
  );
  return { sessionId, inserted, modelId: model?.id ?? null, removed: oldIds.length };
});

const result = seed();
console.log(`[seed] 会话「${SESSION_TITLE}」已写入:`);
console.log(`  session id : ${result.sessionId}`);
console.log(`  messages   : ${result.inserted} 条（${ROUNDS} 组问答）`);
console.log(`  model      : ${result.modelId ?? '(未绑定，页面上手动选一个即可)'}`);
console.log(`  清理旧会话 : ${result.removed} 个`);
db.close();
