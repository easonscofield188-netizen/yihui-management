---
description: 全局数据加载与提交 Loading 交互规范：每个页面加载数据或提交时屏幕中间必须有 loading 遮罩提示效果，按钮上的 loading 效果去除。
globs: ["**/*.js", "**/*.wxml", "**/*.vue"]
always_on: true
---

# 全局数据加载与提交 Loading 交互规范

## 1. 屏幕中央 Loading 遮罩与统一交互（强制）
- **数据加载场景**：每个页面在初始化数据加载、下拉刷新、搜索过滤或异步请求时，页面正中央必须具备统一、优雅的 Loading 遮罩层及提示效果（例如调用 `wx.showLoading({ title: '正在加载...', mask: true })` 或在页面中央渲染 `<view class="loading-mask"><t-loading ... /><text>加载文案</text></view>`）。
- **数据提交场景**：用户点击保存、修改、提交、重置密码、删除、停用/启用等所有表单或快捷操作时，必须在屏幕正中央弹出居中遮罩 Loading（如 `wx.showLoading({ title: '正在提交...', mask: true })`），防止用户重复点击，并提供明确的交互感知。
- **状态及时释放**：所有异步请求、接口调用必须在 `try...catch...finally` 中的 `finally` 块中及时解除 Loading（调用 `wx.hideLoading()` 或将 `loading` 状态重置为 `false`）。

## 2. 按钮组件 Loading 效果规范
- **去除按钮上的内部 Loading**：页面底部的提交/保存/操作按钮（如 `t-button`）上去除内部叠加的 `loading` 属性或旋转图标，避免按钮内部文字被遮挡、挤压或抖动；
- **防重复点击控制**：按钮的防重点击通过禁用态 `disabled="{{submitting}}"` 以及屏幕正中央的 `mask: true` 遮罩全局拦截，保证交互界面美观、简约、清爽。
