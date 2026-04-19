# 杭州亿辉文化创意 - 数据库设计方案

根据当前项目管理页面的功能需求，我为您设计了以下 4 张核心数据库表（集合）。您可以直接将配套的 JSON 文件导入腾讯云开发控制台。

## 1. 数据库表设计

### 1.1 管理员表 (`users`)
用于管理后台登录账号。
- `username` (string): 登录账号
- `password` (string): MD5 加密后的密码
- `role` (string): 角色标识（如 ADMIN_SUPER、ADMIN_COM）
- `roleName` (string): 角色名称（如 超级系统管理员、系统管理员）
- `employeeNo` (string): 工号
- `nickname` (string): 用户昵称
- `avatarUrl` (string): 用户头像访问地址
- `avatarFileId` (string): 用户头像云存储文件 ID
- `lastLoginTime` (timestamp/string): 最后登录时间
- `updateTime` (timestamp): 最后更新时间

### 1.2 系统通用配置表 (`system_configs`)
> `SYSTEM_SETTING` 分组用于系统运行参数。当前支持 `SESSION_TIMEOUT_MINUTES`，`value` 为用户无操作自动退出登录时间，单位：分钟，默认 30。
统一管理所有下拉选项（客户角色、项目状态、成本类目、客户来源、项目场景等）。
- `group` (string): 配置分组 (CLIENT_ROLE, PROJECT_STATUS, COST_CATEGORY, CLIENT_SOURCE, PROJECT_SCENE)
- `label` (string): 显示名称 (如：项目经理)
- `value` (string): 唯一标识/代码 (如：pm)
- `sortOrder` (number): 排序权重
- `isActive` (boolean): 是否启用
- `description` (string): 备注说明
- `createdAt` (timestamp): 创建时间


### 1.3 客户表 (`clients`)
存储客户的基础信息，支持项目关联。
- `name` (string): 客户名称
- `role` (string): 客户角色 (冗余显示)
- `roleCode` (string): 客户角色标识 (对应 `system_configs` 中的 `value`)
- `source` (string): 客户来源
- `paymentCycle` (string): 回款周期
- `description` (string): 客户描述
- `createdAt` (timestamp): 创建时间


### 1.4 项目表 (`projects`)
存储园林景观项目的核心业务数据。
- `clientId` (string): 关联的客户 ID (外键)
- `name` (string): 项目名称
- `type` (string): 项目类型 (historical: 补录, normal: 常规, long_term: 长期)
- `scene` (string): 项目场景标识 (对应 `system_configs` 中的 `PROJECT_SCENE`)
- `completionTime` (timestamp): 补录单：完结时间
- `client` (string): 客户单位 (冗余显示)
- `clientRole` (string): 客户角色 (冗余显示)
- `startDate` (string): 开始日期 (YYYY-MM-DD)
- `endDate` (string): 结束日期 (YYYY-MM-DD)
- `staffCount` (number): 投入人员数量 (长期项目为 0)
- `amount` (number): 项目订单金额 (长期项目为子项目汇总)
- `receivedAmount` (number): 已收账款
- `unreceivedAmount` (number): 未收账款 (计算字段)
- `payableAmount` (number): 应付账款 (计算字段)
- `paidAmount` (number): 已付账款 (计算字段)
- `description` (string): 项目详细描述
- `status` (string): 项目状态标识 (negotiating, constructing, completed, settling, closed, in_cooperation, terminated)
- `subProjects` (array): 子项目列表 (仅长期项目)
  - `content` (string): 项目内容 (植物养护, 植物换新, 景观优化, 环境治理)
  - `startDate` (string): 开始日期
  - `amount` (number): 订单金额
  - `isHasVoucher` (string): 是否有发票凭证 (yes/no)
  - `vouchers` (array): 凭证列表
    - `id` (string): 凭证 ID
    - `fileId` (string): 云存储文件 ID
    - `url` (string): 文件访问链接
    - `name` (string): 文件名
  - `costs` (array): 子项目成本明细
    - `category` (string): 成本类目
    - `supplier` (string): 供应商
    - `amount` (number): 支出金额
    - `isSettled` (boolean): 是否结清
- `isHasContract` (string): 是否有合同 (yes/no)
- `isHasPreview` (string): 是否有预览图 (yes/no)
- `isHasVoucher` (string): 是否有发票凭证 (yes/no，常规项目用于控制成本支出凭证上传是否必填)
- `amountEditCount` (number): 订单金额修改次数 (创建成功后最多允许修改一次)
- `createdAt` (timestamp): 创建时间

- `updatedAt` (timestamp): 更新时间
- `negotiatingTime` (timestamp): 洽谈时间
- `constructingTime` (timestamp): 施工时间
- `completedTime` (timestamp): 完工时间
- `settlingTime` (timestamp): 结账时间
- `settledTime` (timestamp): 结清时间

### 1.5 成本明细表 (`costs`)
记录每个项目的具体支出。
- `projectId` (string): 关联的项目 ID (外键)
- `categoryCode` (string): 成本类目标识 (对应 `system_configs` 中的 `value`)
- `categoryLabel` (string): 成本类目名称 (冗余显示)
- `supplier` (string): 供应商名称
- `amount` (number): 支出金额
- `createdAt` (timestamp): 记录时间


### 1.6 项目凭证表 (`project_vouchers`)
存储项目相关的单据或图片凭证。
- `projectId` (string): 关联的项目 ID (外键)
- `fileName` (string): 凭证文件名 (项目名称 + 随机数)
- `fileId` (string): 腾讯云存储中的 FileID
- `fileUrl` (string): 图片的访问 URL
- `fileSize` (number): 文件大小 (bytes)
- `mimeType` (string): 文件类型 (如 image/jpeg)
- `uploadTime` (number): 上传时间戳
- `createTime` (timestamp): 记录创建时间
- `updateTime` (timestamp): 记录更新时间

### 1.7 项目合同表 (`project_contracts`)
存储项目相关的合同文件。
- `projectId` (string): 关联的项目 ID (外键)
- `name` (string): 文件名称
- `fileId` (string): 腾讯云存储中的 FileID
- `url` (string): 文件的访问 URL
- `type` (string): 文件类型 (image/pdf)
- `createdAt` (timestamp): 上传时间


### 1.8 项目预览图表 (`project_previews`)
存储项目效果预览图。
- `projectId` (string): 关联的项目 ID (外键)
- `fileId` (string): 腾讯云存储中的 FileID
- `url` (string): 图片的访问 URL
- `createdAt` (timestamp): 上传时间

### 1.9 操作日志表 (`operation_logs`)
记录后台管理端关键操作，用于审计、筛选、统计和导出。
- `user_id` (string): 操作用户 ID
- `username` (string): 登录账号
- `nickname` (string): 用户昵称
- `user_role` (string): 用户角色标识
- `module` (string): 操作所属模块（如 项目管理、系统配置、操作日志）
- `action` (string): 操作动作（create/update/delete/view/export）
- `content` (string): 操作内容描述
- `status` (string): 操作状态（成功、警告、失败）
- `ip` (string): 客户端 IP
- `user_agent` (string): 客户端 User-Agent
- `create_time` (string): 操作时间 ISO 字符串
- `create_timestamp` (number): 操作时间戳，用于范围筛选和排序
- `createdAt` (timestamp): 记录创建时间


---

## 2. 导入说明

我已经为您生成了以下 6 个 JSON 文件，您可以直接在腾讯云开发控制台的“数据库”模块中，先创建对应的集合，然后点击“导入”按钮上传对应的文件：

1.  **`users_sample.json`** -> 导入到 `users` 集合
2.  **`system_configs_sample.json`** -> 导入到 `system_configs` 集合
3.  **`clients_sample.json`** -> 导入到 `clients` 集合
4.  **`projects_sample.json`** -> 导入到 `projects` 集合
5.  **`costs_sample.json`** -> 导入到 `costs` 集合
6.  **`project_vouchers_sample.json`** -> 导入到 `project_vouchers` 集合

> **注意：关联关系处理**
> 1. 先导入 `clients`，获取生成的客户 `_id`。
> 2. 在导入 `projects` 时，将客户 `_id` 填入 `clientId` 字段。
> 3. 导入 `projects` 后，获取项目的 `_id`。
> 4. 在导入 `costs` 和 `project_vouchers` 时，将项目 `_id` 填入 `projectId` 字段。
## 登录 IP 安全字段补充

`users` 集合新增以下字段：
- `last_login_ip` (string): 最后一次登录 IP
- `common_login_ips` (array): 常用登录 IP 列表，登录次数达到阈值后写入
- `login_ip_stats` (array): 登录 IP 统计，包含 `ip`、`login_count`、`first_login_time`、`last_login_time`

## 忘记密码字段补充

`users` 集合需包含：
- `_id` (string): 用户 ID
- `username` (string): 登录账号
- `email` (string): 绑定邮箱，用于接收找回密码验证码
- `passwordHash` (string): sha256 哈希后的密码
- `status` (string): 账号状态，如 `active`、`disabled`
- `updatedAt` (number): 最后更新时间戳

新增 `password_reset_codes` 集合：
- `_id` (string): 验证码记录 ID
- `userId` (string): 用户 ID
- `email` (string): 接收验证码的邮箱
- `codeHash` (string): 验证码哈希，不保存明文验证码
- `scene` (string): 固定为 `forgot_password`
- `expireAt` (number): 过期时间戳，默认 5 分钟
- `used` (boolean): 是否已使用
- `verified` (boolean): 是否已完成验证码校验
- `verifyToken` (string): 验证成功后生成的重置凭证
- `createdAt` (number): 创建时间戳
- `verifiedAt` (number|null): 验证通过时间戳
- `usedAt` (number|null): 使用时间戳
