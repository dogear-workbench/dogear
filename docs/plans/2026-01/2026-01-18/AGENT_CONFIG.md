# Agent SDK 配置说明

## 📋 配置方式

本项目使用标准的 `.env` 文件配置 Agent SDK,通过 `dotenv` 包加载。

### 📝 使用 .env 文件

**步骤**:

1. 复制示例文件创建 `.env`:
   ```bash
   cp .env.example .env
   ```

2. 编辑 `.env` 文件:
   ```env
   ANTHROPIC_AUTH_TOKEN=your-auth-token-here
   ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic
   ```

3. 重启应用

**配置项说明**:

| 环境变量 | 必需 | 说明 | 默认值 |
|---------|------|------|--------|
| `ANTHROPIC_AUTH_TOKEN` | ✅ | API 认证 Token | - |
| `ANTHROPIC_BASE_URL` | ❌ | API Base URL | `https://api.anthropic.com` |

---

## 🔧 实现细节

### 配置加载 (一行代码!)

**文件**: [electron/main/index.ts](../electron/main/index.ts)

```typescript
import { config } from 'dotenv';
import { resolve } from 'path';

// 加载 .env 配置 (就在主进程入口,一行搞定!)
config({ path: resolve(process.cwd(), '.env') });
```

**就这么简单!**

### Worker 线程继承

**文件**: [electron/main/agents/agent-manager.ts](../electron/main/agents/agent-manager.ts)

```typescript
// Worker 自动继承主进程的 process.env
const worker = new Worker(workerPath, {
  env: process.env  // 包含从 .env 加载的配置
});
```

---

## 🔒 安全建议

1. **永远不要提交 `.env` 文件到 Git**
   - ✅ 已添加到 `.gitignore`

2. **使用不同的 Token 用于不同环境**
   - 开发环境: 测试 Token
   - 生产环境: 正式 Token

3. **定期轮换 API Token**

---

## 🧪 测试配置

运行测试脚本验证配置:

```bash
# 测试配置加载
node -e "import('dotenv').then(({config}) => { config(); console.log('Token:', process.env.ANTHROPIC_AUTH_TOKEN ? '✅' : '❌'); })"

# 测试 SDK 功能
node test-agent-sdk.mjs

# 测试完整流程
npm run dev
```

---

## ❓ 常见问题

### Q: 配置不生效怎么办?

A: 按以下步骤排查:

1. 检查 `.env` 文件是否在项目根目录
2. 检查文件格式是否正确 (KEY=VALUE)
3. 检查是否有拼写错误
4. 重启应用

### Q: 可以使用不同的 API endpoint 吗?

A: 可以!在 `.env` 中设置:

```env
ANTHROPIC_BASE_URL=https://your-custom-endpoint.com
```

### Q: dotenv 支持哪些特性?

A: dotenv 支持:
- 注释 (以 `#` 开头)
- 变量展开: `DB_HOST=${HOST}`
- 引号: `MSG="Hello World"`
- 转义: `PATH=C:\\Program Files`
- 空行忽略

详细文档: https://github.com/motdotla/dotenv

---

## 📚 相关文档

- [Agent SDK 集成文档](./AGENT_SDK_INTEGRATION.md)
- [项目结构文档](./2026-01-16-PROJECT_STRUCTURE.md)
- [架构文档](./2026-01-16-ARCHITECTURE.md)
