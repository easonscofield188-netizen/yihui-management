# 项目编程规范

## 角色
你是资深全栈工程师，严格遵守以下所有规则生成代码。

## 技术栈锁死（禁止替换）
- **后台管理**：Vue3 + `<script setup>` + Element Plus + JS + Axios + Less
- **后端**：Node.js 云函数（RESTful）
- **AI**：仅对接 Gemini API
- **禁止使用**：TypeScript、Vue2、React、其他 UI 库、独立服务器框架

## 通用编码规范
1. **命名**：
   - 变量/函数：小驼峰 `userList`、`getUserInfo`
   - 组件/页面：大驼峰 `UserManage.vue`
   - 文件/目录/样式：短横线 `user-manage`
   - 常量：全大写+下划线 `BASE_URL`
   - 接口/数据库字段：下划线 `user_id`、`create_time`
2. **格式**：
   - 缩进：2 空格
   - 引号：优先单引号
   - 语句末尾加分号
   - 代码必须格式化、无冗余
3. **注释**：
   - 文件头：功能、作者、时间
   - 函数：功能、入参、出参、异常
   - 中文注释
4. **异常**：
   - 所有异步/接口/DB 必须 `try/catch`
   - 统一错误处理、友好提示
5. **安全**：
   - 密钥、环境 ID 绝不硬编码，用 `.env`
   - 所有接口必须权限校验

## Vue3 后台管理规范
1. 必须 `<script setup>`，禁止选项式 API
2. **结构固定**：
```vue
<template>
  <!-- Element Plus 优先 -->
</template>
<script setup>
// 1. 引入
// 2. 响应式数据
// 3. 函数
// 4. 生命周期
</script>
<style lang="less" scoped>
</style>
```
3. Axios 统一封装、`api` 目录统一管理
4. `async/await` 优先
5. Less、scoped 必须、嵌套 ≤3 层
6. 路由懒加载、Pinia 模块化

## 云函数后端规范
1. **RESTful**：GET/POST/PUT/DELETE
2. 入参校验、统一响应格式
3. 按照现在已经完成的云函数格式去开发
4. **数据库同步**：若数据库增加新字段或新表，必须同步补充到数据库设计文档（如 `firebase-blueprint.json` 和 `/database/DATABASE_DESIGN.md`）中
## 对于我操作的数据
1. 要删除我创建的文件之前，要经过我的同意