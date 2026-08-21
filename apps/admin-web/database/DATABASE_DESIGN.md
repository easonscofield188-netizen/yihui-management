# 杭州亿辉文化创意 - 数据库设计方案

根据项目管理系统（Web 管理后台 + 微信小程序）的实际业务需求，全站共有以下 14 张核心数据库集合（表）。您可以直接在腾讯云开发控制台中创建对应集合或导入 JSON 数据。

> ℹ️ **重要说明**：项目成本支出明细内嵌在 `projects` 集合的 `costs` 数组字段中统一管理，因此系统不使用独立的 `costs` 集合。

---

## 1. 数据库表设计

### 1.1 管理员与用户表 (`users`)
用于管理全站登录账号、身份角色及安全审计信息。
- `_id` (string): 用户记录 ID，由数据库生成；业务中用于关联当前登录用户、操作日志等。
- `username` (string): 登录账号
- `email` (string): 绑定邮箱，用于接收找回密码验证码；普通系统管理员新建项目通知也会查询超级管理员邮箱。
- `password` (string): 历史兼容字段。早期为 MD5 加密后的密码；当前登录页会额外传 `legacyPassword` 兼容旧密码校验。
- `passwordHash` (string): SHA256 哈希后的登录密码，忘记密码重置成功后会更新此字段。
- `status` (string): 账号状态，如 `active`、`disabled`；用于控制账号是否可登录。
- `role` (string): 角色标识（`ADMIN_SUPER`: 超级系统管理员, `ADMIN_COM`: 系统管理员, `ADMIN`: 管理员, `PROJECT_MANAGER`: 项目经理, `FINANCE_MANAGER`: 财务经理, `VISITOR`: 访客/客户）
- `roleName` (string): 角色名称中文展示
- `employeeNo` (string): 工号 (格式如 `YH-ADMIN_SUPER-000`)
- `nickname` (string): 用户昵称
- `avatarUrl` (string): 用户头像访问地址
- `avatarFileId` (string): 用户头像云存储文件 ID
- `lastLoginTime` (timestamp/string): 最后登录时间
- `last_login_ip` (string): 最后一次登录 IP
- `common_login_ips` (array): 常用登录 IP 列表
- `login_ip_stats` (array): 登录 IP 统计列表，包含 `ip`、`login_count`、`first_login_time`、`last_login_time`
- `created_at` / `createdAt` (timestamp): 用户创建时间
- `updateTime` / `updatedAt` (timestamp/number): 最后更新时间/时间戳

### 1.2 登录会话凭证表 (`auth_sessions`)
用于存储 Web 端与小程序用户登录成功后的 Token 鉴权凭证与滑动续期会话。
- `_id` (string): 会话记录 ID
- `token` (string): 登录凭证 Token
- `userId` (string): 关联的用户 `users._id`
- `createdTimestamp` (number): 会话创建毫秒时间戳
- `lastTouchedTimestamp` (number): 最近一次接口操作活跃时间戳（用于滑动续期）
- `expireTimestamp` (number): 凭证失效毫秒时间戳（默认 24 小时）
- `createdAt` (timestamp): 记录创建时间

### 1.3 系统通用配置表 (`system_configs`)
统一管理全站所有下拉选项字典（客户角色、项目状态、成本类目、客户来源、项目场景等）及系统运行参数。
- `group` (string): 配置分组 (`CLIENT_ROLE`, `PROJECT_STATUS`, `COST_CATEGORY`, `CLIENT_SOURCE`, `PROJECT_SCENE`, `SYSTEM_SETTING`)
- `label` (string): 显示名称 (如：项目经理)
- `value` (string): 唯一标识/代码 (如：pm)
- `sortOrder` (number): 排序权重
- `isActive` (boolean): 是否启用
- `description` (string): 备注说明
- `createdAt` (timestamp): 创建时间

### 1.4 客户表 (`clients`)
存储客户的基础信息，支持项目关联。
- `name` (string): 客户名称
- `role` (string): 客户角色 (冗余显示)
- `roleCode` (string): 客户角色标识 (对应 `system_configs` 中的 `value`)
- `source` (string): 客户来源
- `paymentCycle` (string): 回款周期
- `description` (string): 客户描述
- `createdAt` (timestamp): 创建时间

### 1.5 项目表 (`projects`)
存储园林景观项目的核心业务数据与内嵌成本明细。
- `clientId` (string): 关联的客户 ID (外键)
- `name` (string): 项目名称
- `projectCode` (string): 项目编号 (如 `PRJ-2026-0001`)
- `type` (string): 项目类型 (`historical`: 补录, `normal`: 常规, `long_term`: 长期)
- `scene` (string): 项目场景标识 (对应 `system_configs` 中的 `PROJECT_SCENE`)
- `completionTime` (timestamp): 补录单：完结时间
- `client` (string): 客户单位 (冗余显示)
- `clientRole` (string): 客户角色 (冗余显示)
- `startDate` (string): 开始日期 (YYYY-MM-DD)
- `endDate` (string): 结束日期 (YYYY-MM-DD)
- `staffCount` (number): 投入人员数量
- `amount` (number): 项目订单金额
- `receivedAmount` (number): 已收账款
- `unreceivedAmount` (number): 未收账款 (计算字段)
- `payableAmount` (number): 应付账款 (计算字段)
- `paidAmount` (number): 已付账款 (计算字段)
- `profitAmount` (number): 项目利润 (计算字段)
- `description` (string): 项目详细描述
- `status` (string): 项目状态标识 (`negotiating`, `constructing`, `completed`, `settling`, `closed`, `archived`, `in_cooperation`, `terminated`)
- `creationChannel` (string): 创建渠道 (`mini_program` / `admin_web`)
- `creationChannelLabel` (string): 创建渠道中文标签
- `costs` (array): 项目成本支出明细内嵌数组
  - `category` / `categoryCode` (string): 成本类目 (如 `fake_plant`, `labor`, `logistics`)
  - `categoryLabel` (string): 成本类目中文标签
  - `supplier` (string): 供应商名称
  - `amount` (number): 支出金额
  - `isSettled` (boolean): 是否结算支付
- `subProjects` (array): 子项目列表 (仅长期项目)
- `isHasContract` (string): 是否有合同 (`yes`/`no`)
- `isHasPreview` (string): 是否有预览图 (`yes`/`no`)
- `isHasVoucher` (string): 是否有发票凭证 (`yes`/`no`)
- `amountEditCount` (number): 订单金额修改次数
- `createdAt` (timestamp): 创建时间
- `updatedAt` (timestamp): 更新时间

### 1.6 项目报价单表 (`project_quotations`)
存储项目报价明细、清单细项及多版本演进轨迹。
- `projectName` (string): 项目名称
- `projectNameKey` (string): 项目名称小写索引键
- `projectCode` (string): 项目编号
- `version` (string): 版本号 (如 `V1.0`, `V2.0`)
- `versionSequence` (number): 版本序号 (1, 2, 3...)
- `versionLabel` (string): 版本中文名称 (如 `版本一`、`版本二`)
- `rootQuotationId` / `quotationGroupId` (string): 关联的首版报价单 ID (组 ID)
- `totalAmount` (number): 报价总金额
- `items` (array): 报价明细清单项
  - `name` (string): 明细项目名称
  - `unitPrice` (number): 单价
  - `quantity` (number): 数量
  - `unit` (string): 单位 (如 m², 项, 盆)
  - `totalAmount` (number): 小计金额
  - `remark` (string): 备注说明
- `drawings` (array): 设计示意图与 PDF 图纸
- `clientShareToken` (string): 客户分享授权 Token
- `clientShareEnabled` (boolean): 是否开启客户分享
- `status` (string): 报价状态 (`draft` / `active` / `deleted`)
- `createdByName` (string): 创建人姓名
- `createdTimestamp` / `createdAt` (timestamp): 创建时间

### 1.7 项目精选案例表 (`project_cases`)
存储对外展示与宣传的项目精选案例。
- `title` (string): 案例标题
- `summary` (string): 案例摘要简介
- `coverUrl` (string): 封面图访问链接
- `coverFileId` (string): 封面图云存储 FileID
- `content` (string): 案例详细说明/图文内容
- `scene` (string): 关联场景标识
- `tags` (array): 案例标签数组
- `status` (string): 发布状态 (`published` / `draft` / `deleted`)
- `createdAt` (timestamp): 创建时间

### 1.8 项目凭证表 (`project_vouchers`)
存储项目相关的单据、发票或图片凭证。
- `projectId` (string): 关联的项目 ID (外键)
- `fileName` (string): 凭证文件名
- `fileId` (string): 腾讯云存储中的 FileID
- `fileUrl` (string): 图片的访问 URL
- `fileSize` (number): 文件大小 (bytes)
- `mimeType` (string): 文件类型 (如 image/jpeg)
- `uploadTime` (number): 上传时间戳
- `createTime` / `createdAt` (timestamp): 记录创建时间

### 1.9 项目合同表 (`project_contracts`)
存储项目相关的合同与文本契约。
- `projectId` (string): 关联的项目 ID (外键)
- `name` (string): 文件名称
- `fileId` (string): 腾讯云存储中的 FileID
- `url` (string): 文件的访问 URL
- `type` (string): 文件类型 (image/pdf)
- `createdAt` (timestamp): 上传时间

### 1.10 项目预览图表 (`project_previews`)
存储项目效果图与施工预览图片。
- `projectId` (string): 关联的项目 ID (外键)
- `fileId` (string): 腾讯云存储中的 FileID
- `url` (string): 图片的访问 URL
- `createdAt` (timestamp): 上传时间

### 1.11 项目变更轨迹表 (`project_change_events`)
存储项目状态变更、金额修改等重大关键事件的历史记录。
- `projectId` (string): 关联的项目 ID (外键)
- `eventType` (string): 事件类型 (如 status_change, amount_edit, cost_add)
- `operatorId` (string): 操作人 ID
- `operatorName` (string): 操作人姓名
- `details` (object): 变更明细内容
- `createdAt` (timestamp): 记录时间

### 1.12 操作日志表 (`operation_logs`)
记录后台管理端关键操作，用于审计、筛选、统计和导出。
- `user_id` (string): 操作用户 ID
- `username` (string): 登录账号
- `nickname` (string): 用户昵称
- `user_role` (string): 用户角色标识
- `module` (string): 操作所属模块
- `action` (string): 操作动作（create/update/delete/view/export）
- `content` (string): 操作内容描述
- `status` (string): 操作状态字典值（`success`、`warning`、`failed`）
- `ip` (string): 客户端 IP
- `create_timestamp` (number): 操作时间戳

### 1.13 消息通知表 (`notifications`)
存储系统内部消息提醒、邮件发送记录与订阅通知。
- `recipientId` (string): 接收人 ID
- `title` (string): 通知标题
- `content` (string): 通知内容
- `type` (string): 通知类型
- `read` (boolean): 是否已读
- `emailSent` (boolean): 是否已发送邮件
- `createdAt` (timestamp): 创建时间

### 1.14 忘记密码验证码表 (`password_reset_codes`)
存储忘记密码时发送给邮箱的临时验证码与重置凭证。
- `userId` (string): 用户 ID
- `email` (string): 接收验证码的邮箱
- `codeHash` (string): 验证码哈希
- `scene` (string): 场景固定为 `forgot_password`
- `expireAt` (number): 过期时间戳（默认 5 分钟）
- `used` (boolean): 是否已使用
- `verified` (boolean): 是否已完成验证码校验
- `verifyToken` (string): 验证成功后生成的重置凭证
- `createdAt` (number): 创建时间戳


### 1.15 公司支出记录表 (`company_expenses`)
存储公司日常运营支出明细（含一次性支出与固定分摊生成的月度支出）：
- `category` (string): 支出类目标识（如 `rent`, `utility`, `salary`）
- `categoryLabel` (string): 支出类目中文标签
- `amount` (number): 支出金额（元，两位小数）
- `expenseType` (string): 支出类型（`one_time`: 一次性支出, `recurring`: 固定分摊支出）
- `expenseDate` (string): 归属日期（YYYY-MM-DD）
- `expenseMonth` (string): 归属月份（YYYY-MM）
- `recurringRuleId` (string): 关联的固定支出规则 ID（仅固定分摊记录存在）
- `remark` (string): 备注说明
- `createdBy` (string): 创建人用户 ID
- `createdByName` (string): 创建人姓名
- `createdAt` (timestamp): 创建时间
- `updatedAt` (timestamp): 更新时间

### 1.16 固定支出规则表 (`company_expense_rules`)
存储房租、物业费等长期固定支出的自动分摊规则配置：
- `category` (string): 支出类目标识
- `categoryLabel` (string): 支出类目中文标签
- `amountPerMonth` (number): 每月分摊金额
- `startMonth` (string): 开始月份（YYYY-MM）
- `endMonth` (string): 结束月份（YYYY-MM）
- `totalMonths` (number): 总分摊月数
- `totalAmount` (number): 预计总金额
- `status` (string): 规则状态（`active`: 进行中, `stopped`: 已停用, `completed`: 已结束）
- `remark` (string): 备注说明
- `createdBy` (string): 创建人用户 ID
- `createdByName` (string): 创建人姓名
- `createdAt` (timestamp): 创建时间
- `updatedAt` (timestamp): 更新时间

---

## 2. 数据库集合列表清单

在腾讯云开发控制台中，系统实际运行使用的集合清单如下：

| 序号 | 集合名称 | 功能说明 | 建议索引 |
| :--- | :--- | :--- | :--- |
| 1 | `users` | 管理员与用户账号表 | `username`(唯一) |
| 2 | `auth_sessions` | 登录会话与 Token 鉴权凭证表 | `token`(唯一), `userId` |
| 3 | `system_configs` | 系统通用下拉字典与运行参数表 | `group` |
| 4 | `clients` | 客户基础信息表 | `name` |
| 5 | `projects` | 项目核心业务数据表 (内含 costs) | `clientId`, `status`, `createdAt` |
| 6 | `project_quotations` | 项目报价单与多版本轨迹表 | `rootQuotationId`, `projectCode` |
| 7 | `project_cases` | 项目精选案例表 | `status`, `createdAt` |
| 8 | `project_vouchers` | 项目凭证与单据表 | `projectId` |
| 9 | `project_contracts` | 项目合同文件表 | `projectId` |
| 10 | `project_previews` | 项目效果预览图表 | `projectId` |
| 11 | `project_change_events` | 项目关键状态与版本变更轨迹表 | `projectId` |
| 12 | `operation_logs` | 全站操作审计日志表 | `user_id`, `create_timestamp` |
| 13 | `notifications` | 消息提醒与通知表 | `recipientId`, `read` |
| 14 | `password_reset_codes` | 忘记密码邮箱验证码校验表 | `email`, `verifyToken` |
| 15 | `company_expenses` | 公司运营支出记录表（含分摊与一次性） | `expenseMonth`, `category`, `expenseDate` |
| 16 | `company_expense_rules` | 固定支出自动分摊规则表 | `status`, `startMonth`, `endMonth` |
