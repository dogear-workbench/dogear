---
paths:
  - "electron/main/database/**"
---

# 数据库修改规则

- 表结构定义在 `schema.sql`，数据操作封装在 `index.ts`
- 修改表结构时必须添加版本迁移逻辑（当前 v5，新迁移用 v6+）
- 新增字段必须给默认值，否则旧数据会报错
- better-sqlite3 是同步 API，不需要 async/await
- 数据库只在主进程操作，渲染层通过 IPC 调用
