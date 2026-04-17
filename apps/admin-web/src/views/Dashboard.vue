<template>
  <div class="flex min-h-screen bg-background text-on-surface">
    <!-- Sidebar -->
    <aside class="fixed left-0 top-0 h-full w-64 bg-neutral-900/60 backdrop-blur-xl border-r border-emerald-900/20 z-50 flex flex-col">
      <div class="px-6 py-8 flex flex-col gap-1">
        <h1 class="text-lg font-bold text-primary tracking-tighter">
          杭州亿辉
        </h1>
        <p class="font-space tracking-wide text-sm opacity-60">
          艺术科技园林
        </p>
      </div>
      
      <nav class="flex-1 mt-4">
        <div 
          v-for="item in visibleMenuItems" 
          :key="item.name"
          class="flex items-center gap-3 px-6 py-4 cursor-pointer transition-all hover:bg-neutral-800/50"
          :class="item.active ? 'text-primary bg-primary/10 font-bold border-r-2 border-primary' : 'text-neutral-400'"
          @click="handleMenuClick(item.name)"
        >
          <el-icon class="w-5 h-5">
            <component :is="item.icon" />
          </el-icon>
          <span class="font-space tracking-wide text-sm">{{ item.label }}</span>
        </div>
      </nav>

      <div class="p-6 border-t border-white/5">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-primary/20 border border-primary/20 flex items-center justify-center overflow-hidden">
            <img
              v-if="currentUser.avatarUrl"
              :src="currentUser.avatarUrl"
              alt="用户头像"
              class="w-full h-full object-cover"
            >
            <User
              v-else
              class="text-primary w-6 h-6"
            />
          </div>
          <div class="flex flex-col min-w-0">
            <span class="text-xs font-bold truncate">{{ currentUser.nickname || currentUser.username || '管理员' }}</span>
            <span class="text-[10px] text-on-surface-variant uppercase tracking-widest truncate">{{ currentUserRoleText }}</span>
          </div>
        </div>
      </div>
    </aside>

    <!-- Main Content Area -->
    <div class="flex-1 ml-64 flex flex-col min-w-0">
      <!-- Header -->
      <header class="h-16 fixed top-0 right-0 left-64 z-40 bg-neutral-950/40 backdrop-blur-md border-b border-white/5 px-8 flex items-center justify-between">
        <div class="text-xl font-black text-primary truncate mr-4">
          亿辉文化·艺术科技管理系统
        </div>
        
        <div class="flex items-center gap-6 shrink-0">
          <!-- 强制刷新配置按钮 -->
          <el-tooltip
            content="强制同步云端配置"
            placement="bottom"
          >
            <div 
              class="p-2 rounded-full hover:bg-white/5 cursor-pointer transition-colors text-on-surface-variant hover:text-primary" 
              :class="{ 'animate-spin': configSyncing }"
              @click="initGlobalConfigs(true)"
            >
              <el-icon class="w-5 h-5">
                <Refresh />
              </el-icon>
            </div>
          </el-tooltip>

          <div class="relative hidden lg:block">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant w-4 h-4" />
            <input 
              type="text" 
              placeholder="搜索项目..." 
              class="bg-surface-container-low border-none rounded-full pl-10 pr-4 py-1.5 text-xs focus:ring-1 focus:ring-secondary w-64 transition-all outline-none"
            >
          </div>
          <div class="flex items-center gap-4 text-neutral-400">
            <Bell class="w-5 h-5 cursor-pointer hover:text-primary" />
            <QuestionFilled class="w-5 h-5 cursor-pointer hover:text-primary" />
            <el-button
              type="danger"
              link
              @click="handleLogout"
            >
              退出登录
            </el-button>
          </div>
        </div>
      </header>

      <!-- Content -->
      <main class="pt-24 p-8 space-y-10 overflow-x-hidden">
        <template v-if="activeMenu === 'dashboard'">
          <section class="dashboard-overview-page max-w-[1600px] mx-auto space-y-8">
            <div class="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
              <div>
                <h2 class="text-3xl font-bold tracking-tight mb-2">数据总览</h2>
                <p class="text-on-surface-variant text-sm">欢迎回来。这是今日的园林项目经营概况。</p>
              </div>
              <div class="bg-surface-container-low p-1 rounded-lg flex items-center gap-1 border border-white/5">
                <button
                  v-for="range in dashboardRanges"
                  :key="range.value"
                  class="px-4 py-1.5 text-xs font-medium rounded-md transition-all"
                  :class="dashboardRange === range.value ? 'bg-primary text-black' : 'text-on-surface-variant hover:text-on-surface'"
                  @click="dashboardRange = range.value"
                >
                  {{ range.label }}
                </button>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div
                v-for="item in dashboardKpis"
                :key="item.label"
                class="dashboard-glass-card rounded-xl p-6 flex flex-col justify-between min-h-[150px]"
                :class="item.cardClass"
              >
                <div class="flex justify-between items-start mb-4">
                  <span class="material-symbols-outlined p-2 rounded-lg" :class="item.iconClass">{{ item.icon }}</span>
                  <span v-if="item.trend" class="text-xs font-bold" :class="item.trendClass">{{ item.trend }}</span>
                </div>
                <div>
                  <p class="text-on-surface-variant text-xs mb-1">{{ item.label }}</p>
                  <h4 class="text-3xl font-bold tracking-tighter" :class="item.valueClass || 'text-on-surface'">
                    {{ item.value }}
                    <span v-if="item.unit" class="text-sm font-normal text-on-surface-variant ml-1">{{ item.unit }}</span>
                  </h4>
                </div>
              </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div class="dashboard-glass-card rounded-xl p-6 lg:col-span-2 relative overflow-hidden">
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                  <h5 class="text-sm font-bold tracking-widest uppercase">对比分析</h5>
                </div>
                <div class="h-64 flex items-end justify-around gap-8 px-8 dashboard-chart-container relative">
                  <div class="absolute inset-0 flex flex-col justify-between pointer-events-none px-6 py-2 opacity-10">
                    <div v-for="line in 5" :key="line" class="border-t border-emerald-400 w-full h-0" />
                  </div>
                  <div
                    v-for="bar in dashboardQuarterBars"
                    :key="`${dashboardRange}-${bar.label}`"
                    class="flex-1 flex flex-col items-center group relative z-10"
                    @mouseenter="dashboardHoveredBar = bar"
                    @mouseleave="dashboardHoveredBar = null"
                  >
                    <div class="dashboard-bar-3d w-12" :style="{ height: `${bar.height}px` }">
                      <div class="dashboard-bar-face dashboard-bar-front h-full" />
                      <div class="dashboard-bar-face dashboard-bar-back h-full" />
                      <div class="dashboard-bar-face dashboard-bar-right h-full" />
                      <div class="dashboard-bar-face dashboard-bar-top" />
                      <div class="absolute -top-10 left-1/2 -translate-x-1/2 bg-primary text-black text-[10px] px-2 py-0.5 rounded font-bold whitespace-nowrap shadow-[0_8px_18px_rgba(82,238,138,0.18)]">
                        {{ bar.amountText }}
                      </div>
                    </div>
                    <div
                      v-if="dashboardHoveredBar?.label === bar.label"
                      class="dashboard-bar-tooltip"
                    >
                      <div class="text-[10px] text-on-surface-variant mb-1">{{ bar.label }}</div>
                      <div class="text-sm font-bold text-primary">{{ bar.amountText }}</div>
                      <div class="text-[10px] text-neutral-500 mt-1">订单 {{ bar.orderCount }} </div>
                    </div>
                    <span class="text-[10px] mt-8 font-medium" :class="bar.active ? 'text-primary font-bold' : 'text-on-surface-variant'">{{ bar.label }}</span>
                  </div>
                </div>
                <div class="absolute bottom-4 left-6 flex items-center gap-4 text-[8px] text-on-surface-variant uppercase tracking-tighter opacity-60">
                  <div class="flex items-center gap-1"><div class="w-1.5 h-1.5 bg-primary" /> 营收</div>
                </div>
              </div>

              <div class="dashboard-glass-card rounded-xl p-6">
                <h5 class="text-sm font-bold tracking-widest uppercase mb-8">订单金额分布</h5>
                <div class="flex items-center justify-center relative h-64 dashboard-chart-container">
                  <div class="dashboard-scene-chart relative w-64 h-64 flex items-center justify-center">
                    <div class="absolute w-52 h-52 rounded-full bg-primary/5 blur-2xl animate-pulse" />
                    <svg class="dashboard-scene-svg w-52 h-52 -rotate-90 filter drop-shadow-[0_15px_35px_rgba(0,0,0,0.5)]" viewBox="0 0 100 100">
                      <circle
                        v-for="segment in dashboardSceneSegments"
                        :key="segment.label"
                        class="dashboard-scene-segment"
                        :class="{ 'is-active': dashboardActiveScene?.label === segment.label }"
                        cx="50"
                        cy="50"
                        fill="transparent"
                        r="42"
                        :stroke="segment.color"
                        :stroke-dasharray="`${segment.length} 263.8`"
                        :stroke-dashoffset="segment.offset"
                        stroke-linecap="round"
                        :stroke-width="dashboardActiveScene?.label === segment.label ? 14 : 10"
                        :style="{ filter: `drop-shadow(0 0 ${dashboardActiveScene?.label === segment.label ? 18 : 12}px ${segment.shadow})` }"
                        @mouseenter="handleDashboardSceneEnter($event, segment)"
                        @mousemove="handleDashboardSceneMove($event)"
                        @mouseleave="handleDashboardSceneLeave"
                      />
                      <circle cx="50" cy="50" fill="transparent" r="37" stroke="rgba(255,255,255,0.1)" stroke-width="0.5" />
                    </svg>
                    <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div class="w-28 h-28 rounded-full bg-neutral-900/90 backdrop-blur-xl border border-white/10 flex flex-col items-center justify-center shadow-[0_0_40px_rgba(0,0,0,0.8),inset_0_2px_5px_rgba(255,255,255,0.1)]">
                        <p class="text-[9px] text-on-surface-variant uppercase tracking-[0.2em] font-bold">{{ dashboardActiveScene?.label || '业务占比' }}</p>
                        <p class="text-lg font-black text-white">{{ dashboardActiveScene?.amountText || dashboardMoney(dashboardMetrics.totalAmount) }}</p>
                        <p class="text-xs font-bold text-primary">{{ dashboardActiveScene ? `${dashboardActiveScene.percent}%` : '100%' }}</p>
                      </div>
                    </div>
                    <div
                      v-if="dashboardActiveScene && dashboardSceneTooltip.visible"
                      class="dashboard-scene-tooltip"
                      :style="{
                        left: `${dashboardSceneTooltip.x}px`,
                        top: `${dashboardSceneTooltip.y}px`
                      }"
                    >
                      <div class="dashboard-scene-tooltip-title">{{ dashboardActiveScene.label }}</div>
                      <div class="dashboard-scene-tooltip-amount">{{ dashboardActiveScene.amountText }}</div>
                      <div class="dashboard-scene-tooltip-meta">
                        占比 {{ dashboardActiveScene.percent }}% / 订单 {{ dashboardActiveScene.orderCount }} �?                      </div>
                    </div>
                  </div>
                </div>
                <div class="mt-4 grid grid-cols-2 gap-y-3">
                  <div
                    v-for="segment in dashboardSceneSegments"
                    :key="`legend-${segment.label}`"
                    class="dashboard-scene-legend flex justify-between items-center text-xs px-2 py-1"
                    :class="{ 'is-active': dashboardActiveScene?.label === segment.label }"
                    @mouseenter="dashboardHoveredScene = segment.label"
                    @mouseleave="dashboardHoveredScene = ''"
                  >
                    <div class="flex items-center gap-2">
                      <div class="w-2.5 h-2.5 rounded-sm" :style="{ backgroundColor: segment.color }" />
                      <span class="text-on-surface-variant">{{ segment.label }}</span>
                    </div>
                    <div class="text-right">
                      <div class="font-mono opacity-90">{{ segment.amountText }}</div>
                      <div class="font-mono opacity-60">{{ segment.percent }}%</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <div class="dashboard-glass-card rounded-xl p-6">
                <h5 class="text-sm font-bold tracking-widest uppercase mb-8">利润走势</h5>
                <div class="h-64 relative overflow-visible dashboard-profit-chart">
                  <svg class="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
                    <g class="dashboard-profit-grid">
                      <line v-for="line in 5" :key="line" x1="0" x2="100" :y1="line * 18" :y2="line * 18" />
                    </g>
                    <path :d="dashboardProfitAreaPath" fill="url(#dashboard-gradient-green)" opacity="0.16" />
                    <path
                      :key="`${dashboardRange}-profit-line-glow`"
                      :d="dashboardProfitLinePath"
                      class="dashboard-profit-line"
                      fill="none"
                      pathLength="1"
                      stroke="rgba(82,238,138,0.16)"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="1.8"
                    />
                    <path
                      :key="`${dashboardRange}-profit-line-main`"
                      :d="dashboardProfitLinePath"
                      class="dashboard-profit-line"
                      fill="none"
                      pathLength="1"
                      stroke="#52ee8a"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="0.7"
                    />
                    <g v-for="point in dashboardProfitPoints" :key="point.label">
                      <line
                        v-if="dashboardHoveredProfitPoint?.label === point.label"
                        :x1="point.x"
                        :x2="point.x"
                        y1="8"
                        y2="92"
                        class="dashboard-profit-guide"
                      />
                      <circle
                        :cx="point.x"
                        :cy="point.y"
                        class="dashboard-profit-hit"
                        r="8"
                        @mouseenter="dashboardHoveredProfitPoint = point"
                        @mouseleave="dashboardHoveredProfitPoint = null"
                      />
                      <circle
                        :cx="point.x"
                        :cy="point.y"
                        :class="{ 'is-active': dashboardHoveredProfitPoint?.label === point.label }"
                        class="dashboard-profit-point"
                        r="1.2"
                        @mouseenter="dashboardHoveredProfitPoint = point"
                        @mouseleave="dashboardHoveredProfitPoint = null"
                      />
                    </g>
                    <defs>
                      <linearGradient id="dashboard-gradient-green" x1="0%" x2="0%" y1="0%" y2="100%">
                        <stop offset="0%" style="stop-color:#52ee8a;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#52ee8a;stop-opacity:0" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div
                    v-if="dashboardHoveredProfitPoint"
                    class="dashboard-profit-tooltip"
                    :style="{
                      left: `${Math.min(84, Math.max(16, dashboardHoveredProfitPoint.x))}%`,
                      top: `${Math.min(82, Math.max(18, dashboardHoveredProfitPoint.y))}%`
                    }"
                  >
                    <div class="text-[10px] text-on-surface-variant mb-1">{{ dashboardHoveredProfitPoint.label }}</div>
                    <div class="text-sm font-bold text-primary">{{ dashboardHoveredProfitPoint.amountText }}</div>
                    <div class="text-[10px] text-neutral-500 mt-1">项目 {{ dashboardHoveredProfitPoint.orderCount }} </div>
                  </div>
                </div>
                <div class="flex justify-between mt-4">
                  <span
                    v-for="label in dashboardProfitLabels"
                    :key="label"
                    class="text-[10px] text-neutral-500"
                  >
                    {{ label }}
                  </span>
                </div>
              </div>

              <div class="dashboard-glass-card rounded-xl p-6 xl:col-span-2 overflow-hidden">
                <div class="flex justify-between items-center mb-6">
                  <h5 class="text-sm font-bold tracking-widest uppercase">金额最大的订单</h5>
                  <button class="text-xs text-primary hover:underline" @click="handleMenuClick('projects')">查看全部</button>
                </div>
                <div class="overflow-x-auto">
                  <table class="w-full text-left">
                    <thead class="text-xs text-on-surface-variant border-b border-white/5">
                      <tr>
                        <th class="pb-3 font-medium">项目名称</th>
                        <th class="pb-3 font-medium">所属客</th>
                        <th class="pb-3 font-medium">签订日期</th>
                        <th class="pb-3 font-medium text-right">订单金额</th>
                        <th class="pb-3 font-medium text-center">状</th>
                      </tr>
                    </thead>
                    <tbody class="text-sm">
                      <tr v-for="order in dashboardTopOrders" :key="order.id" class="hover:bg-white/5 transition-colors group">
                        <td class="py-4 font-medium">{{ order.name }}</td>
                        <td class="py-4 text-on-surface-variant">{{ order.client }}</td>
                        <td class="py-4 text-on-surface-variant font-mono text-xs">{{ order.date }}</td>
                        <td class="py-4 text-right font-bold text-primary">{{ order.amountText }}</td>
                        <td class="py-4 text-center">
                          <span class="px-2 py-0.5 rounded text-[10px]" :class="order.statusClass">{{ order.statusLabel }}</span>
                        </td>
                      </tr>
                      <tr v-if="dashboardTopOrders.length === 0">
                        <td colspan="5" class="py-10 text-center text-sm text-on-surface-variant">暂无项目订单数据</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        </template>

        <template v-else-if="activeMenu === 'logs'">
          <section class="operation-log-page space-y-8">
            <header class="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <h2 class="text-3xl font-bold tracking-tight mb-2">
                  操作日志
                </h2>
                <p class="text-on-surface-variant/80 max-w-3xl text-sm leading-6">
                  监控与审计系统活动，记录项目、客户、配置与权限相关操作，辅助追踪数据变更�?                </p>
              </div>
              <div class="flex items-center gap-2 text-primary font-medium bg-primary/10 px-4 py-2 rounded-full border border-primary/20 w-fit">
                <span class="material-symbols-outlined text-sm">verified_user</span>
                <span class="text-xs">实时监控已开</span>
              </div>
            </header>

            <section class="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div class="md:col-span-1 bg-surface-container-high p-5 rounded-xl border border-white/5 hover:border-primary/30 transition-colors">
                <label class="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-3">选择用户</label>
                <select
                  v-model="operationLogFilters.user"
                  class="operation-log-control"
                >
                  <option value="">所有用</option>
                  <option
                    v-for="user in operationLogUsers"
                    :key="user"
                    :value="user"
                  >
                    {{ user }}
                  </option>
                </select>
              </div>

              <div class="md:col-span-2 bg-surface-container-high p-5 rounded-xl border border-white/5 hover:border-primary/30 transition-colors">
                <label class="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-3">日期范围</label>
                <div class="flex flex-col sm:flex-row sm:items-center gap-3">
                  <input
                    v-model="operationLogFilters.startDate"
                    class="operation-log-control"
                    type="date"
                  >
                  <span class="text-on-surface-variant/40 text-xs text-center"></span>
                  <input
                    v-model="operationLogFilters.endDate"
                    class="operation-log-control"
                    type="date"
                  >
                </div>
              </div>

              <div class="md:col-span-1 bg-surface-container-high p-5 rounded-xl border border-white/5 hover:border-primary/30 transition-colors">
                <label class="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-3">所属模</label>
                <select
                  v-model="operationLogFilters.module"
                  class="operation-log-control"
                >
                  <option value="">全部模块</option>
                  <option
                    v-for="module in operationLogModules"
                    :key="module"
                    :value="module"
                  >
                    {{ module }}
                  </option>
                </select>
              </div>
            </section>

            <section class="bg-surface-container-low rounded-2xl overflow-hidden shadow-2xl border border-white/5">
              <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                  <thead>
                    <tr class="bg-surface-container-high/50 border-b border-white/5">
                      <th class="px-6 py-4 text-xs font-bold text-on-surface-variant uppercase tracking-widest">操作时间</th>
                      <th class="px-6 py-4 text-xs font-bold text-on-surface-variant uppercase tracking-widest">操作</th>
                      <th class="px-6 py-4 text-xs font-bold text-on-surface-variant uppercase tracking-widest">所属模</th>
                      <th class="px-6 py-4 text-xs font-bold text-on-surface-variant uppercase tracking-widest">操作内容</th>
                      <th class="px-6 py-4 text-xs font-bold text-on-surface-variant uppercase tracking-widest">状</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-white/5">
                    <tr
                      v-for="log in pagedOperationLogs"
                      :key="log.id"
                      class="hover:bg-surface-container-highest/30 transition-colors"
                    >
                      <td class="px-6 py-5">
                        <div class="flex flex-col">
                          <span class="text-on-surface font-medium">{{ log.date }}</span>
                          <span class="text-xs text-on-surface-variant/60">{{ log.time }}</span>
                        </div>
                      </td>
                      <td class="px-6 py-5">
                        <div class="flex items-center gap-3">
                          <div
                            class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                            :class="log.avatarClass"
                          >
                            {{ log.initials }}
                          </div>
                          <span class="text-on-surface whitespace-nowrap">{{ log.user }}</span>
                        </div>
                      </td>
                      <td class="px-6 py-5">
                        <span class="px-3 py-1 bg-surface-container-highest rounded text-xs text-on-surface border border-white/5 whitespace-nowrap">
                          {{ log.module }}
                        </span>
                      </td>
                      <td class="px-6 py-5">
                        <p class="text-sm text-on-surface-variant max-w-xl line-clamp-1">
                          {{ log.content }}
                        </p>
                      </td>
                      <td class="px-6 py-5">
                        <div
                          class="flex items-center gap-2"
                          :class="operationLogStatusClass(log.status)"
                        >
                          <span class="w-1.5 h-1.5 rounded-full" :class="operationLogDotClass(log.status)"></span>
                          <span class="text-xs font-bold">{{ log.status }}</span>
                        </div>
                      </td>
                    </tr>
                    <tr v-if="pagedOperationLogs.length === 0">
                      <td
                        colspan="5"
                        class="px-6 py-12 text-center text-sm text-on-surface-variant"
                      >
                        暂无符合条件的操作日�?                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="bg-surface-container-high/30 px-6 py-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-t border-white/5">
                <span class="text-xs text-on-surface-variant/60">
                  显示 {{ operationLogPageStart }} �?{{ operationLogPageEnd }} 项，�?{{ filteredOperationLogs.length }} �?                </span>
                <div class="flex items-center gap-2">
                  <button
                    class="operation-log-page-btn"
                    :disabled="operationLogPage === 1"
                    @click="operationLogPage = Math.max(1, operationLogPage - 1)"
                  >
                    <span class="material-symbols-outlined text-xl">chevron_left</span>
                  </button>
                  <button
                    v-for="page in operationLogTotalPages"
                    :key="page"
                    class="operation-log-number-btn"
                    :class="page === operationLogPage ? 'bg-primary/20 text-primary' : 'text-on-surface-variant hover:bg-surface-container-highest'"
                    @click="operationLogPage = page"
                  >
                    {{ page }}
                  </button>
                  <button
                    class="operation-log-page-btn"
                    :disabled="operationLogPage === operationLogTotalPages"
                    @click="operationLogPage = Math.min(operationLogTotalPages, operationLogPage + 1)"
                  >
                    <span class="material-symbols-outlined text-xl">chevron_right</span>
                  </button>
                  <button
                    class="ml-2 px-4 py-2 rounded-lg bg-primary text-black text-xs font-bold hover:brightness-110"
                    @click="exportOperationLogs"
                  >
                    导出日志
                  </button>
                </div>
              </div>
            </section>

            <section class="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div
                v-for="item in operationLogStats"
                :key="item.label"
                class="operation-log-stat p-6 rounded-2xl relative overflow-hidden border border-white/5 bg-surface-container-high"
              >
                <h3 class="text-on-surface-variant text-xs font-bold tracking-widest uppercase mb-4">
                  {{ item.label }}
                </h3>
                <div class="flex items-end gap-3">
                  <span class="text-4xl font-bold text-on-surface">{{ item.value }}</span>
                  <span
                    class="text-sm font-medium mb-1 flex items-center gap-1"
                    :class="item.colorClass"
                  >
                    <span class="material-symbols-outlined text-xs">{{ item.icon }}</span>
                    {{ item.trend }}
                  </span>
                </div>
              </div>
            </section>
          </section>
        </template>

        <template v-else-if="activeMenu === 'projects'">
        <!-- Page Header -->
        <div class="flex justify-between items-end">
          <div>
            <h2 class="text-3xl font-bold tracking-tight mb-2">
              项目管理中心
            </h2>
            <div class="flex gap-2 text-xs text-on-surface-variant uppercase tracking-widest">
              <span class="text-primary">项目</span>
              <span>/</span>
              <span>项目概览</span>
            </div>
          </div>
          <div
            v-if="!isCreating"
            class="flex gap-3"
          >
            <el-button 
              type="primary" 
              size="large" 
              class="!bg-primary !text-black !border-none !font-bold shadow-lg hover:brightness-110"
              @click="enterCreateMode"
            >
              <el-icon class="mr-2 !text-black">
                <Plus />
              </el-icon>
              新建项目
            </el-button>
          </div>
          <el-button 
            v-if="isCreating" 
            type="info" 
            size="large" 
            class="!bg-neutral-800 !text-on-surface-variant !border-white/10 !font-bold shadow-lg hover:!bg-neutral-700 hover:!text-white"
            @click="handleAbandonCreate"
          >
            <el-icon class="mr-2">
              <Close />
            </el-icon>
            放弃创建
          </el-button>
        </div>

        <!-- Project Table Section -->
        <section class="bg-surface-container-high rounded-xl overflow-hidden border border-white/5">
          <div class="p-6 border-b border-white/5 flex justify-between items-center">
            <h3 class="text-lg font-bold flex items-center gap-2">
              <span class="w-1.5 h-6 bg-primary rounded-full" />
              活跃项目列表
            </h3>
            <div class="flex gap-2 p-1 bg-surface-container-lowest rounded-lg border border-white/5">
              <button 
                class="px-3 py-1.5 text-[10px] rounded-md transition-all uppercase tracking-wider"
                :class="projectFilters.tab === 'all' ? 'bg-primary/10 text-primary font-bold border border-primary/20' : 'text-on-surface-variant hover:text-primary'"
                @click="projectFilters.tab = 'all'; currentPage = 1"
              >
                全部项目
              </button>
              <button 
                class="px-3 py-1.5 text-[10px] rounded-md transition-all uppercase tracking-wider"
                :class="projectFilters.tab === 'ongoing' ? 'bg-primary/10 text-primary font-bold border border-primary/20' : 'text-on-surface-variant hover:text-primary'"
                @click="projectFilters.tab = 'ongoing'; currentPage = 1"
              >
                进行�?
              </button>
              <button 
                class="px-3 py-1.5 text-[10px] rounded-md transition-all uppercase tracking-wider"
                :class="projectFilters.tab === 'completed' ? 'bg-primary/10 text-primary font-bold border border-primary/20' : 'text-on-surface-variant hover:text-primary'"
                @click="projectFilters.tab = 'completed'; currentPage = 1"
              >
                已交�?
              </button>
            </div>
          </div>
          
          <!-- 高级筛选栏 -->
          <div class="p-6 pt-0 border-b border-white/5">
            <div class="grid grid-cols-12 gap-3 items-center">
              <!-- 项目名称搜索 -->
              <div class="col-span-3 relative">
                <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm">search</span>
                <input 
                  v-model="projectFilters.search"
                  class="w-full h-9 bg-surface-container-lowest border border-white/5 rounded-lg pl-10 pr-4 text-xs text-on-surface focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-all placeholder:text-neutral-600" 
                  placeholder="搜索项目名称..." 
                  type="text"
                  @keyup.enter="handleSearch"
                >
              </div>
              
              <!-- 类别筛�?-->
              <div class="col-span-2 relative custom-dropdown-trigger">
                <div
                  class="relative cursor-pointer"
                  @click.stop="toggleDropdown('type')"
                >
                  <div 
                    class="w-full h-9 bg-surface-container-lowest border rounded-lg px-3 text-xs text-on-surface flex justify-between items-center transition-all"
                    :class="openDropdown === 'type' ? 'border-primary' : 'border-white/5'"
                  >
                    <span>{{ projectTypes.find(t => t.value === projectFilters.type)?.label || '项目类别' }}</span>
                    <span 
                      class="material-symbols-outlined text-sm transition-transform"
                      :class="[
                        openDropdown === 'type' ? 'rotate-180 text-primary' : 'text-on-surface-variant'
                      ]"
                    >expand_more</span>
                  </div>
                  
                  <!-- Dropdown Menu -->
                  <div 
                    v-if="openDropdown === 'type'"
                    class="absolute top-full left-0 w-full mt-2 bg-[#1c1b1c]/90 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl z-[60] overflow-hidden"
                  >
                    <div class="py-1">
                      <div class="px-3 py-2 text-xs text-on-surface-variant/60 font-bold border-b border-white/5 mb-1">
                        项目类别
                      </div>
                      <div 
                        class="px-3 py-2 text-xs text-on-surface-variant hover:bg-white/5 cursor-pointer flex justify-between items-center"
                        @click.stop="selectFilter('type', '')"
                      >
                        <span>全部类别</span>
                      </div>
                      <div 
                        v-for="item in projectTypes" 
                        :key="item.value"
                        class="px-3 py-2 text-xs cursor-pointer flex justify-between items-center transition-colors"
                        :class="projectFilters.type === item.value ? 'text-primary bg-primary/10 font-bold' : 'text-on-surface-variant hover:bg-white/5'"
                        @click.stop="selectFilter('type', item.value)"
                      >
                        <span>{{ item.label }}</span>
                        <span
                          v-if="projectFilters.type === item.value"
                          class="material-symbols-outlined text-sm"
                        >check</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 状态筛�?-->
              <div class="col-span-2 relative custom-dropdown-trigger">
                <div
                  class="relative cursor-pointer"
                  @click.stop="toggleDropdown('status')"
                >
                  <div 
                    class="w-full h-9 bg-surface-container-lowest border rounded-lg px-3 text-xs text-on-surface flex justify-between items-center transition-all"
                    :class="openDropdown === 'status' ? 'border-primary' : 'border-white/5'"
                  >
                    <span>{{ projectStatuses.find(s => s.value === projectFilters.status)?.label || '项目状态' }}</span>
                    <span 
                      class="material-symbols-outlined text-sm transition-transform"
                      :class="[
                        openDropdown === 'status' ? 'rotate-180 text-primary' : 'text-on-surface-variant'
                      ]"
                    >expand_more</span>
                  </div>
                  
                  <!-- Dropdown Menu -->
                  <div 
                    v-if="openDropdown === 'status'"
                    class="absolute top-full left-0 w-full mt-2 bg-[#1c1b1c]/90 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl z-[60] overflow-hidden"
                  >
                    <div class="py-1">
                      <div class="px-3 py-2 text-xs text-on-surface-variant/60 font-bold border-b border-white/5 mb-1">
                        项目状�?
                      </div>
                      <div 
                        class="px-3 py-2 text-xs text-on-surface-variant hover:bg-white/5 cursor-pointer flex justify-between items-center"
                        @click.stop="selectFilter('status', '')"
                      >
                        <span>全部状</span>
                      </div>
                      <div 
                        v-for="item in projectStatuses" 
                        :key="item.value"
                        class="px-3 py-2 text-xs cursor-pointer flex justify-between items-center transition-colors"
                        :class="projectFilters.status === item.value ? 'text-primary bg-primary/10 font-bold' : 'text-on-surface-variant hover:bg-white/5'"
                        @click.stop="selectFilter('status', item.value)"
                      >
                        <span>{{ item.label }}</span>
                        <span
                          v-if="projectFilters.status === item.value"
                          class="material-symbols-outlined text-sm"
                        >check</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 日期范围 -->
              <div class="col-span-3 relative">
                <el-date-picker
                  v-model="projectFilters.dateRange"
                  type="daterange"
                  range-separator="-"
                  start-placeholder="开始日期"
                  end-placeholder="结束日期"
                  class="custom-date-picker-styled h-9"
                  value-format="YYYY-MM-DD"
                />
              </div>

              <!-- 操作按钮 -->
              <div class="col-span-2 flex items-center gap-2">
                <button 
                  class="flex-1 h-9 bg-primary text-on-primary text-xs font-bold rounded-lg hover:brightness-110 transition-all flex items-center justify-center gap-1 shadow-lg shadow-primary/10"
                  @click="handleSearch"
                >
                  <span class="material-symbols-outlined text-sm">filter_alt</span>
                  查询
                </button>
                <el-tooltip
                  content="重置筛选"
                  placement="top"
                >
                  <button 
                    class="px-3 h-9 border border-white/10 text-on-surface-variant text-xs font-bold rounded-lg hover:bg-white/5 hover:text-on-surface transition-all"
                    @click="handleResetFilters"
                  >
                    <span class="material-symbols-outlined text-sm">restart_alt</span>
                  </button>
                </el-tooltip>
              </div>
            </div>
          </div>
          
          <div class="overflow-x-auto">
            <el-table 
              v-loading="loadingProjects"
              element-loading-background="rgba(19, 19, 20, 0.8)"
              :data="paginatedProjects" 
              style="width: 100%"
              :row-class-name="tableRowClassName"
              header-align="left"
              @row-click="(row) => !isCreating && handleViewProject(row)"
            >
              <el-table-column
                label="项目名称"
                min-width="200"
                align="left"
              >
                <template #default="{ row }">
                  <div class="flex items-center gap-4">
                    <div 
                      class="w-2 h-2 rounded-full shrink-0" 
                      :class="[
                        row.statusColor,
                        row.id === selectedProjectId ? 'shadow-[0_0_10px_rgba(82,238,138,0.8)]' : ''
                      ]"
                    />
                    <div class="flex flex-col min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="font-bold text-sm text-on-surface truncate">{{ row.name }}</span>
                        <el-tag 
                          v-if="row.type" 
                          size="small" 
                          effect="dark" 
                          class="!border-white/10 !text-[10px] !px-1.5 !h-5 !leading-5"
                          :class="[
                            row.type === 'normal' ? '!bg-emerald-500/10 !text-emerald-400 !border-emerald-500/20' : 
                            row.type === 'historical' ? '!bg-amber-500/10 !text-amber-400 !border-amber-500/20' : 
                            row.type === 'long_term' ? '!bg-cyan-500/10 !text-cyan-400 !border-cyan-500/20' :
                            '!bg-neutral-800 !text-on-surface-variant/60'
                          ]"
                        >
                          {{ row.typeLabel }}
                        </el-tag>
                      </div>
                    </div>
                  </div>
                </template>
              </el-table-column>
              <el-table-column
                prop="client"
                label="客户名称"
                min-width="120"
              >
                <template #default="{ row }">
                  <span 
                    class="text-sm truncate block"
                    :class="row.id === selectedProjectId ? 'text-on-surface font-medium' : 'text-on-surface-variant'"
                  >{{ row.client }}</span>
                </template>
              </el-table-column>
              <el-table-column
                prop="createDateText"
                label="创单日期"
                min-width="100"
              >
                <template #default="{ row }">
                  <span 
                    class="font-mono text-xs"
                    :class="row.id === selectedProjectId ? 'text-on-surface' : 'text-on-surface-variant/80'"
                  >{{ row.createDateText }}</span>
                </template>
              </el-table-column>
              <el-table-column
                prop="deliveryDateText"
                label="交付日期"
                min-width="100"
              >
                <template #default="{ row }">
                  <span 
                    class="font-mono text-xs"
                    :class="row.id === selectedProjectId ? 'text-on-surface' : 'text-on-surface-variant/80'"
                  >{{ row.deliveryDateText }}</span>
                </template>
              </el-table-column>
              <el-table-column
                label="项目周期"
                min-width="90"
              >
                <template #default="{ row }">
                  <span 
                    class="text-xs font-bold"
                    :class="row.projectDaysText !== '-' ? 'text-primary' : 'text-on-surface-variant/40'"
                  >{{ row.projectDaysText }}</span>
                </template>
              </el-table-column>
              <el-table-column
                label="施工周期"
                min-width="90"
              >
                <template #default="{ row }">
                  <span 
                    class="text-xs font-bold"
                    :class="row.constructionDaysText !== '-' ? 'text-secondary' : 'text-on-surface-variant/40'"
                  >{{ row.constructionDaysText }}</span>
                </template>
              </el-table-column>
              <el-table-column
                label="回款周期"
                min-width="90"
              >
                <template #default="{ row }">
                  <span 
                    class="text-xs font-bold"
                    :class="row.collectionDaysText !== '-' ? 'text-orange-400' : 'text-on-surface-variant/40'"
                  >{{ row.collectionDaysText }}</span>
                </template>
              </el-table-column>
              <el-table-column
                label="订单金额 (¥)"
                min-width="120"
              >
                <template #default="{ row }">
                  <span 
                    class="font-bold font-mono text-sm"
                    :class="row.id === selectedProjectId ? 'text-primary' : 'text-on-surface'"
                  >{{ row.amount }}</span>
                </template>
              </el-table-column>
              <el-table-column
                label="项目状态"
                min-width="110"
              >
                <template #default="{ row }">
                  <el-dropdown 
                    trigger="click" 
                    popper-class="status-dropdown-popper"
                    :disabled="isCreating || row.status === 'closed'"
                    @command="(val) => handleInlineStatusChange(row, val)"
                    @click.stop
                  >
                    <div 
                      class="status-badge-trigger"
                      :class="[
                        `is-${row.status}`,
                        isCreating ? 'opacity-50 cursor-not-allowed' : ''
                      ]"
                    >
                      <div class="status-dot" />
                      <span class="status-text">{{ row.statusText }}</span>
                      <el-icon
                        v-if="!isCreating"
                        class="status-chevron"
                      >
                        <ArrowDown />
                      </el-icon>
                    </div>
                    <template #dropdown>
                      <el-dropdown-menu class="status-dropdown-menu">
                        <el-dropdown-item
                          v-for="item in getRowProjectStatuses(row)"
                          :key="item.value"
                          :command="item.value"
                          :disabled="!canRollbackStatus(row) && item.sortOrder < getStatusOrder(row.status)"
                          :class="{ 'is-selected': row.status === item.value }"
                        >
                          <span>{{ item.label }}</span>
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </template>
              </el-table-column>
              <el-table-column
                label="操作"
                align="right"
                width="80"
                fixed="right"
              >
                <template #default="{ row }">
                  <div class="flex justify-end pr-2">
                    <el-icon 
                      v-if="!isCreating && hasPermission('DELETE_PROJECT')"
                      class="cursor-pointer !text-red-500 hover:!text-red-600 transition-colors text-lg"
                      title="删除项目"
                      @click.stop="handleDeleteProject(row)"
                    >
                      <Delete />
                    </el-icon>
                    <span
                      v-else-if="!isCreating"
                      class="text-[10px] text-on-surface-variant/40"
                    >-</span>
                    <span
                      v-else
                      class="text-[10px] text-on-surface-variant/40 italic"
                    >新建�?..</span>
                  </div>
                </template>
              </el-table-column>
              <template #empty>
                <div class="py-20 flex flex-col items-center justify-center text-on-surface-variant/40">
                  <el-icon
                    size="48"
                    class="mb-4 opacity-20"
                  >
                    <Box />
                  </el-icon>
                  <span class="text-sm tracking-widest uppercase font-bold">暂无活跃项目数据</span>
                </div>
              </template>
            </el-table>

            <!-- 分页组件 -->
            <div
              v-if="projects.length > 0"
              class="px-6 py-4 border-t border-white/5 flex items-center justify-between"
            >
              <div class="text-xs text-on-surface-variant">
                显示�?<span class="font-bold text-on-surface">{{ (currentPage - 1) * pageSize + 1 }}</span> �?<span class="font-bold text-on-surface">{{ Math.min(currentPage * pageSize, totalProjectsCount) }}</span> 条，�?<span class="font-bold text-on-surface">{{ totalProjectsCount }}</span> 条记�?
              </div>
              <nav
                aria-label="Pagination"
                class="inline-flex -space-x-px rounded-md shadow-sm"
              >
                <button 
                  :disabled="currentPage === 1"
                  class="relative inline-flex items-center rounded-l-md px-3 py-2 text-xs font-medium text-on-surface-variant ring-1 ring-inset ring-white/5 hover:bg-white/5 focus:z-20 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  @click="currentPage > 1 && currentPage--"
                >
                  <el-icon class="text-sm mr-1">
                    <ArrowLeft />
                  </el-icon>
                  上一�?
                </button>
                
                <template
                  v-for="(item, index) in paginationPages"
                  :key="index"
                >
                  <button 
                    v-if="item !== '...'"
                    :class="[
                      'relative inline-flex items-center px-4 py-2 text-xs focus:z-20 transition-colors cursor-pointer',
                      currentPage === item 
                        ? 'z-10 bg-primary/20 font-bold text-primary ring-1 ring-inset ring-primary/40' 
                        : 'font-medium text-on-surface-variant ring-1 ring-inset ring-white/5 hover:bg-white/5'
                    ]"
                    @click="currentPage = item"
                  >
                    {{ item }}
                  </button>
                  <span 
                    v-else
                    class="relative inline-flex items-center px-4 py-2 text-xs font-medium text-on-surface-variant ring-1 ring-inset ring-white/5 cursor-default"
                  >
                    ...
                  </span>
                </template>

                <button 
                  :disabled="currentPage === totalPages"
                  class="relative inline-flex items-center rounded-r-md px-3 py-2 text-xs font-medium text-on-surface-variant ring-1 ring-inset ring-white/5 hover:bg-white/5 focus:z-20 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  @click="currentPage < totalPages && currentPage++"
                >
                  下一�?
                  <el-icon class="text-sm ml-1">
                    <ArrowRight />
                  </el-icon>
                </button>
              </nav>
            </div>
          </div>
        </section>

        <!-- Form and Analysis Grid -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <!-- Left Column -->
          <div class="lg:col-span-8 space-y-8 min-w-0">
            <!-- Basic Project Information Section -->
            <section class="bg-surface-container-high p-6 md:p-8 rounded-xl relative overflow-hidden group border border-white/5">
              <!-- Decorative Arc in Top Right -->
              <div class="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-bl-full -mr-16 -mt-16 group-hover:bg-primary/10 transition-colors duration-500" />
              
              <!-- Project Category Ribbon Tag -->
              <div class="absolute top-0 right-0 w-24 h-24 overflow-hidden pointer-events-none z-20">
                <div class="absolute top-0 right-0 w-full h-full">
                  <!-- The ribbon background -->
                  <div 
                    class="absolute top-[18px] right-[-32px] w-[140%] py-1 text-black text-[9px] font-black uppercase tracking-[0.2em] text-center rotate-45 shadow-[0_4px_10px_rgba(0,0,0,0.5)] border-y border-white/10 transition-all duration-500"
                    :class="projectTypeRibbon.color"
                    style="color: #000000;"
                  >
                    {{ projectTypeRibbon.label }}
                  </div>
                  <!-- Corner fold shadow for 3D effect -->
                  <div 
                    class="absolute top-0 right-0 w-0 h-0 border-l-[35px] border-l-transparent transition-all duration-500"
                    :class="projectTypeRibbon.shadow"
                    style="border-top-width: 35px;"
                  />
                </div>
              </div>

              <div 
                class="flex items-center justify-between relative z-10 transition-all duration-300 pr-12"
                :class="isBasicInfoCollapsed ? 'mb-0' : 'mb-8'"
              >
                <h3 class="text-lg font-bold text-on-surface flex items-center gap-2">
                  <span class="w-1.5 h-6 bg-primary rounded-full" />
                  基础项目信息
                  <el-button 
                    link 
                    class="!p-1 !h-auto ml-1 hover:!text-primary transition-colors"
                    @click="isBasicInfoCollapsed = !isBasicInfoCollapsed"
                  >
                    <el-icon :size="16">
                      <component :is="isBasicInfoCollapsed ? ArrowDown : ArrowUp" />
                    </el-icon>
                  </el-button>
                </h3>
                
                <!-- Edit/Save/Cancel Buttons -->
                <div
                  v-if="selectedProjectId"
                  class="flex gap-3"
                >
                  <template v-if="isViewMode">
                    <el-button
                      type="default"
                      size="small"
                      class="!rounded-full !px-6 !bg-emerald-500/10 !text-primary !border !border-primary/30 hover:!bg-primary/20 hover:scale-105 transition-all duration-300 font-bold shadow-[0_0_15px_rgba(82,238,138,0.1)]"
                      @click="enterEditMode"
                    >
                      <el-icon class="mr-1">
                        <Edit />
                      </el-icon>
                      编辑
                    </el-button>
                  </template>
                  <template v-else-if="isEditMode">
                    <el-button
                      size="small"
                      class="!rounded-full !px-6 !bg-neutral-800 !border-white/10 !text-on-surface-variant hover:!bg-neutral-700 hover:!text-white transition-all duration-300"
                      @click="handleAbandonEdit"
                    >
                      放弃
                    </el-button>
                    <el-button
                      type="primary"
                      size="small"
                      class="!rounded-full !px-6 !text-black !border-none hover:scale-105 transition-all duration-300 font-bold shadow-lg shadow-primary/40 brightness-110"
                      :loading="savingProject"
                      @click="confirmSaveUpdate"
                    >
                      <el-icon class="mr-1">
                        <Check />
                      </el-icon>
                      保存
                    </el-button>
                  </template>
                </div>
              </div>

              <el-collapse-transition>
                <div 
                  v-show="!isBasicInfoCollapsed" 
                  class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6"
                >
                  <!-- Project Name -->
                  <div class="space-y-2">
                    <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">项目名称</label>
                    <el-input
                      v-model="form.name"
                      placeholder="请输入项目名称"
                      class="custom-input"
                      :disabled="isViewMode || isFieldReadOnly('name')"
                    />
                  </div>

                  <!-- Project Type -->
                  <div class="space-y-2">
                    <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">项目类型</label>
                    <el-select 
                      v-model="form.type" 
                      placeholder="请选择项目类型" 
                      class="w-full custom-select" 
                      popper-class="custom-dropdown"
                      :disabled="isViewMode || form.type === 'historical' || isFieldReadOnly('type')"
                    >
                      <el-option 
                        v-for="item in projectTypes" 
                        :key="item.value" 
                        :label="item.label" 
                        :value="item.value" 
                      />
                    </el-select>
                  </div>

                  <!-- Project Status -->
                  <div class="space-y-2">
                    <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">项目状</label>
                    <el-select 
                      v-model="form.status" 
                      placeholder="请选择项目状态"
                      class="w-full custom-select" 
                      popper-class="custom-dropdown"
                      :disabled="isViewMode || isFieldReadOnly('status') || (isCreating && form.type === 'long_term')"
                      @change="handleFormStatusChange"
                    >
                      <el-option 
                        v-for="item in filteredProjectStatuses" 
                        :key="item.value" 
                        :label="item.label" 
                        :value="item.value" 
                        :disabled="isEditMode && !canRollbackStatus(form) && item.sortOrder < getStatusOrder(originalProjectStatus)"
                      />
                    </el-select>
                  </div>

                  <!-- Project Scene -->
                  <div class="space-y-2">
                    <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">项目场景</label>
                    <el-select 
                      v-model="form.scene" 
                      placeholder="请选择项目场景" 
                      class="w-full custom-select" 
                      popper-class="custom-dropdown"
                      :disabled="isViewMode || isFieldReadOnly('scene')"
                    >
                      <el-option 
                        v-for="item in projectScenes" 
                        :key="item.value" 
                        :label="item.label" 
                        :value="item.value" 
                      />
                    </el-select>
                  </div>

                  <!-- Start Date (Only for New Project Mode) -->
                  <div
                    v-if="isCreating && form.type !== 'historical'"
                    class="space-y-2"
                  >
                    <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">开始日</label>
                    <el-date-picker
                      v-model="form.startDate"
                      type="date"
                      placeholder="选择开始日期"
                      class="!w-full custom-date-picker"
                      format="YYYY-MM-DD"
                      value-format="YYYY-MM-DD"
                      :disabled-date="disabledFutureDate"
                    />
                  </div>

                  <!-- Delivery Date (Only for Historical Project) -->
                  <div
                    v-if="form.type === 'historical'"
                    class="space-y-2"
                  >
                    <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">交付日期</label>
                    <el-date-picker
                      v-model="form.completionTime"
                      type="date"
                      placeholder="选择交付日期"
                      class="!w-full custom-date-picker"
                      format="YYYY-MM-DD"
                      value-format="YYYY-MM-DD"
                      :disabled="isViewMode || isFieldReadOnly('completionTime')"
                      :disabled-date="disabledFutureDate"
                    />
                  </div>

                  <!-- Project Period -->
                  <div
                    v-if="form.type !== 'historical' && !isCreating"
                    class="space-y-2"
                  >
                    <div class="flex justify-between items-center px-1">
                      <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest">项目周期</label>
                      <span
                        v-if="projectDays > 0"
                        class="text-[10px] font-bold text-primary px-2 py-0.5 bg-primary/10 rounded-full border border-primary/20"
                      >�?{{ projectDays }} </span>
                    </div>
                    <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                      <el-date-picker
                        v-model="form.period[0]"
                        type="date"
                        placeholder="开始日期"
                        class="!w-full custom-date-picker"
                        format="YYYY-MM-DD"
                        value-format="YYYY-MM-DD"
                        :disabled="form.type === 'long_term' || isHistoricalPeriodDisabled || isFieldReadOnly('period')"
                        :disabled-date="disabledHistoricalProjectDate"
                      />
                      <span class="text-on-surface-variant/40"></span>
                      <el-date-picker
                        v-model="form.period[1]"
                        type="date"
                        placeholder="结束日期"
                        class="!w-full custom-date-picker"
                        format="YYYY-MM-DD"
                        value-format="YYYY-MM-DD"
                        :disabled="form.type === 'long_term' || isHistoricalPeriodDisabled || isFieldReadOnly('period')"
                        :disabled-date="disabledHistoricalProjectDate"
                      />
                    </div>
                  </div>

                  <!-- Construction Period -->
                  <div
                    v-if="form.type !== 'long_term' && form.type !== 'historical' && !isCreating && ['constructing', 'completed', 'settling', 'closed'].includes(form.status)"
                    class="space-y-2"
                  >
                    <div class="flex justify-between items-center px-1">
                      <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest">施工周期</label>
                      <span
                        v-if="constructionDays > 0"
                        class="text-[10px] font-bold text-secondary px-2 py-0.5 bg-secondary/10 rounded-full border border-secondary/20"
                      >�?{{ constructionDays }} </span>
                    </div>
                    <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                      <el-date-picker
                        v-model="form.constructionPeriod[0]"
                        type="date"
                        placeholder="开始施工日期"
                        class="!w-full custom-date-picker"
                        format="YYYY-MM-DD"
                        value-format="YYYY-MM-DD"
                        :disabled="isHistoricalPeriodDisabled || isFieldReadOnly('constructionPeriod')"
                        :disabled-date="disabledHistoricalConstructionDate"
                      />
                      <span class="text-on-surface-variant/40"></span>
                      <el-date-picker
                        v-model="form.constructionPeriod[1]"
                        type="date"
                        placeholder="竣工日期"
                        class="!w-full custom-date-picker"
                        format="YYYY-MM-DD"
                        value-format="YYYY-MM-DD"
                        :disabled="isHistoricalPeriodDisabled || isFieldReadOnly('constructionPeriod')"
                        :disabled-date="disabledHistoricalConstructionDate"
                        @change="(val) => handleConstructionPeriodChange([form.constructionPeriod[0], val])"
                      />
                    </div>
                  </div>

                  <!-- Collection Period -->
                  <div
                    v-if="form.type !== 'long_term' && form.type !== 'historical' && !isCreating && ['settling', 'closed'].includes(form.status)"
                    class="space-y-2"
                  >
                    <div class="flex justify-between items-center px-1">
                      <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest">回款周期</label>
                      <span
                        v-if="collectionDays > 0"
                        class="text-[10px] font-bold text-orange-400 px-2 py-0.5 bg-orange-400/10 rounded-full border border-orange-400/20"
                      >�?{{ collectionDays }} </span>
                    </div>
                    <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                      <el-date-picker
                        v-model="form.collectionPeriod[0]"
                        type="date"
                        placeholder="竣工日期"
                        class="!w-full custom-date-picker"
                        format="YYYY-MM-DD"
                        value-format="YYYY-MM-DD"
                        :disabled="isHistoricalPeriodDisabled || isFieldReadOnly('collectionPeriod')"
                        :disabled-date="disabledHistoricalCollectionDate"
                      />
                      <span class="text-on-surface-variant/40"></span>
                      <el-date-picker
                        v-model="form.collectionPeriod[1]"
                        type="date"
                        placeholder="结清日期"
                        class="!w-full custom-date-picker"
                        format="YYYY-MM-DD"
                        value-format="YYYY-MM-DD"
                        :disabled="isHistoricalPeriodDisabled || isFieldReadOnly('collectionPeriod')"
                        :disabled-date="disabledHistoricalCollectionDate"
                        @change="(val) => handleCollectionPeriodChange([form.collectionPeriod[0], val])"
                      />
                    </div>
                  </div>

                  <!-- Client Name -->
                  <div class="space-y-2">
                    <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">客户名称</label>
                    <el-select
                      v-model="form.client"
                      filterable
                      allow-create
                      default-first-option
                      placeholder="请输入或选择客户姓名"
                      class="w-full custom-select"
                      popper-class="custom-dropdown"
                      :loading="clientLoading"
                      :disabled="isViewMode || isFieldReadOnly('client')"
                      @change="handleClientChange"
                      @visible-change="handleClientVisibleChange"
                    >
                      <el-option
                        v-for="item in existingClients"
                        :key="item.id || item.name"
                        :label="item.name"
                        :value="item.name"
                      />
                    </el-select>
                    <p
                      v-if="isNewClient && form.client"
                      class="text-[10px] text-on-surface-variant/60 px-1 flex items-center gap-1 mt-1"
                    >
                      <el-icon class="text-secondary/60">
                        <QuestionFilled />
                      </el-icon>
                      未查询到该客户，建议前往 <span
                        class="text-secondary hover:underline cursor-pointer font-bold"
                        @click="router.push('/clients')"
                      >客户管理</span> 完善详细档案
                    </p>
                  </div>

                  <!-- Client Role -->
                  <div class="space-y-2">
                    <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">客户角色</label>
                    <el-select 
                      v-model="form.role" 
                      placeholder="请选择客户角色" 
                      class="w-full custom-select" 
                      popper-class="custom-dropdown"
                      :disabled="isViewMode || (!isNewClient && form.type !== 'historical') || isFieldReadOnly('role')"
                      :class="{ 'is-disabled-cursor': !isNewClient && form.type !== 'historical' }"
                    >
                      <el-option 
                        v-for="item in clientRoles" 
                        :key="item.value" 
                        :label="item.label" 
                        :value="item.value" 
                      />
                    </el-select>
                  </div>

                  <!-- Client Source -->
                  <div
                    v-if="isNewClient || form.clientSource"
                    class="space-y-2"
                  >
                    <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">客户来源</label>
                    <el-select 
                      v-model="form.clientSource" 
                      placeholder="请选择客户来源" 
                      class="w-full custom-select" 
                      popper-class="custom-dropdown"
                      :disabled="isViewMode || (!isNewClient && form.type !== 'historical') || isFieldReadOnly('clientSource')"
                      :class="{ 'is-disabled-cursor': !isNewClient && form.type !== 'historical' }"
                    >
                      <el-option 
                        v-for="item in clientSources" 
                        :key="item.value" 
                        :label="item.label" 
                        :value="item.value" 
                      />
                    </el-select>
                  </div>

                  <!-- Staff Count -->
                  <div
                    v-if="form.type !== 'long_term'"
                    class="space-y-2"
                  >
                    <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">人员数量</label>
                    <el-input-number
                      v-model="form.staffCount"
                      :min="1"
                      :controls="false"
                      placeholder="请输入预计施工及管理人员数量"
                      class="!w-full custom-number-input"
                      :disabled="isViewMode || isFieldReadOnly('staffCount')"
                    />
                  </div>

                  <!-- Order Amount -->
                  <div
                    v-if="form.type !== 'long_term'"
                    class="space-y-2"
                  >
                    <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">订单金额 (¥)</label>
                    <el-input
                      v-model="form.amount"
                      placeholder="请输入总签约金额"
                      class="custom-input amount-input"
                      :disabled="isViewMode || isFieldReadOnly('amount')"
                    />
                  </div>

                  <!-- Received Amount (Added here) -->
                  <div class="space-y-2">
                    <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">{{ form.type === 'long_term' ? '已收总账款' : '已收账款' }} (¥)</label>
                    <el-input
                      v-model="form.receivedAmount"
                      :placeholder="form.type === 'long_term' ? '请输入已收总金额' : '请输入已收金额'"
                      class="custom-input"
                      :disabled="isViewMode || isFieldReadOnly('receivedAmount')"
                    />
                  </div>

                  <!-- Has Contract -->
                  <div class="space-y-2">
                    <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">是否有合</label>
                    <el-select 
                      v-model="form.isHasContract" 
                      placeholder="请选择" 
                      class="w-full custom-select" 
                      popper-class="custom-dropdown"
                      :disabled="isViewMode || isFieldReadOnly('isHasContract')"
                    >
                      <el-option
                        label="是"
                        :value="YES_NO_VALUE.YES"
                      />
                      <el-option
                        label="否"
                        :value="YES_NO_VALUE.NO"
                      />
                    </el-select>
                  </div>

                  <!-- Has Preview -->
                  <div class="space-y-2">
                    <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">是否有预览图</label>
                    <el-select 
                      v-model="form.isHasPreview" 
                      placeholder="请选择" 
                      class="w-full custom-select" 
                      popper-class="custom-dropdown"
                      :disabled="isViewMode || isFieldReadOnly('isHasPreview')"
                    >
                      <el-option
                        label="是"
                        :value="YES_NO_VALUE.YES"
                      />
                      <el-option
                        label="否"
                        :value="YES_NO_VALUE.NO"
                      />
                    </el-select>
                  </div>

                  <!-- Has Voucher -->
                  <div
                    v-if="form.type !== 'long_term'"
                    class="space-y-2"
                  >
                    <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">是否有发票凭</label>
                    <el-select 
                      v-model="form.isHasVoucher" 
                      placeholder="请选择" 
                      class="w-full custom-select" 
                      popper-class="custom-dropdown"
                      :disabled="isViewMode || isFieldReadOnly('isHasVoucher')"
                    >
                      <el-option
                        label="是"
                        :value="YES_NO_VALUE.YES"
                      />
                      <el-option
                        label="否"
                        :value="YES_NO_VALUE.NO"
                      />
                    </el-select>
                  </div>

                  <!-- Project Description -->
                  <div class="md:col-span-2 space-y-2">
                    <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">项目描述</label>
                    <el-input 
                      v-model="form.desc" 
                      type="textarea" 
                      :rows="4" 
                      placeholder="在此详细说明园林项目的设计要求与技术难�?.."
                      class="custom-textarea"
                      :disabled="isViewMode || isFieldReadOnly('desc')"
                    />
                  </div>
                </div>
              </el-collapse-transition>
            </section>

            <!-- Fund Management Section -->
            <section class="bg-surface-container-high rounded-xl overflow-hidden border border-white/5">
              <div class="p-6 md:p-8 pb-4">
                <h3 class="text-lg font-bold flex items-center gap-2">
                  <span class="w-1.5 h-6 bg-tertiary rounded-full" />
                  项目资金管理
                </h3>
              </div>
              <div class="px-6 md:px-8 pb-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <!-- Order Amount (Display Only) -->
                <div class="space-y-2">
                  <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">{{ form.type === 'long_term' ? '订单总金额' : '订单金额' }} (¥)</label>
                  <div class="!bg-[#0e0e0f] px-4 h-[48px] flex items-center rounded-lg !shadow-[inset_0_0_0_1px_rgba(60,74,62,0.3)] text-sm font-mono text-on-surface cursor-not-allowed">
                    {{ Number(totalOrderAmount).toLocaleString('zh-CN', { minimumFractionDigits: 2 }) }}
                  </div>
                </div>

                <!-- Received Amount (Read-only) -->
                <div class="space-y-2">
                  <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">{{ form.type === 'long_term' ? '已收总账款' : '已收账款' }} (¥)</label>
                  <div class="!bg-[#0e0e0f] px-4 h-[48px] flex items-center rounded-lg !shadow-[inset_0_0_0_1px_rgba(60,74,62,0.3)] text-sm font-mono text-on-surface cursor-not-allowed">
                    {{ Number(form.receivedAmount || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 }) }}
                  </div>
                </div>

                <!-- Unreceived Amount -->
                <div class="space-y-2">
                  <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">{{ form.type === 'long_term' ? '未收总账款' : '未收账款' }} (¥)</label>
                  <div class="!bg-[#0e0e0f] px-4 h-[48px] flex items-center rounded-lg !shadow-[inset_0_0_0_1px_rgba(60,74,62,0.3)] text-sm font-mono text-red-400/80 cursor-not-allowed">
                    {{ Number(unreceivedAmount).toLocaleString('zh-CN', { minimumFractionDigits: 2 }) }}
                  </div>
                </div>

                <!-- Payable Amount -->
                <div class="space-y-2">
                  <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">应付总账�?(¥)</label>
                  <div class="!bg-[#0e0e0f] px-4 h-[48px] flex items-center rounded-lg !shadow-[inset_0_0_0_1px_rgba(60,74,62,0.3)] text-sm font-mono text-on-surface cursor-not-allowed">
                    {{ Number(payableAmount).toLocaleString('zh-CN', { minimumFractionDigits: 2 }) }}
                  </div>
                </div>

                <!-- Paid Amount -->
                <div class="space-y-2">
                  <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">已付总账�?(¥)</label>
                  <div class="!bg-[#0e0e0f] px-4 h-[48px] flex items-center rounded-lg !shadow-[inset_0_0_0_1px_rgba(60,74,62,0.3)] text-sm font-mono text-success/80 cursor-not-allowed">
                    {{ Number(paidAmount).toLocaleString('zh-CN', { minimumFractionDigits: 2 }) }}
                  </div>
                </div>

                <!-- Unpaid Amount -->
                <div class="space-y-2">
                  <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">未付总账�?(¥)</label>
                  <div class="!bg-[#0e0e0f] px-4 h-[48px] flex items-center rounded-lg !shadow-[inset_0_0_0_1px_rgba(60,74,62,0.3)] text-sm font-mono text-red-400/80 cursor-not-allowed">
                    {{ Number(unpaidAmount).toLocaleString('zh-CN', { minimumFractionDigits: 2 }) }}
                  </div>
                </div>
              </div>
            </section>

            <!-- Cost Management Section -->
            <section
              v-if="form.type !== 'long_term'"
              class="bg-surface-container-high rounded-xl overflow-hidden border border-white/5 shadow-2xl transition-all duration-300"
            >
              <div 
                class="p-6 md:p-8 flex justify-between items-center cursor-pointer"
                :class="isCostInfoCollapsed ? 'pb-6' : 'pb-4'"
                @click="isCostInfoCollapsed = !isCostInfoCollapsed"
              >
                <h3 class="text-lg font-bold flex items-center gap-2">
                  <span class="w-1.5 h-6 bg-secondary rounded-full" />
                  成本支出管理
                  <el-icon 
                    class="text-on-surface-variant transition-transform duration-300 ml-1"
                    :class="{ 'rotate-180': !isCostInfoCollapsed }"
                  >
                    <ArrowDown />
                  </el-icon>
                </h3>
                <div 
                  class="flex items-center gap-3"
                  @click.stop
                >
                  <button 
                    class="group flex items-center gap-1.5 px-3 py-1.5 border border-primary/20 text-primary/80 hover:text-primary hover:bg-primary/5 hover:border-primary/40 rounded-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    :disabled="isViewMode || costs.length >= costCategories.length || isFieldReadOnly('costs')"
                    @click="addCost"
                  >
                    <el-icon class="text-sm">
                      <Plus />
                    </el-icon>
                    <span class="text-xs font-medium tracking-tight">{{ costs.length >= costCategories.length ? '已达类目上限' : '添加成本项' }}</span>
                  </button>
                </div>
              </div>

              <el-collapse-transition>
                <div 
                  v-show="!isCostInfoCollapsed" 
                  class="px-6 md:px-8 pb-8"
                >
                  <div class="overflow-x-auto mb-6">
                    <table class="w-full text-left border-separate border-spacing-y-3 min-w-[600px]">
                      <thead>
                        <tr class="text-[10px] text-on-surface-variant uppercase tracking-[0.2em]">
                          <th class="px-4 py-2 font-medium w-[25%]">
                            类目
                          </th>
                          <th class="px-4 py-2 font-medium w-[25%]">
                            供应�?
                          </th>
                          <th class="px-4 py-2 font-medium w-[20%] text-center">
                            成本金额 (¥)
                          </th>
                          <th class="px-4 py-2 font-medium w-[20%] text-center">
                            是否结清
                          </th>
                          <th class="px-4 py-2 font-medium text-right w-[10%]">
                            操作
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr 
                          v-for="(item, index) in costs" 
                          :key="item.id"
                          class="bg-surface-container-lowest group hover:bg-neutral-800/40 transition-colors"
                        >
                          <td class="px-4 py-4 rounded-l-lg">
                            <el-select 
                              v-model="item.category" 
                              placeholder="请选择类目" 
                              class="w-full custom-select-small"
                              popper-class="custom-dropdown"
                              :disabled="isViewMode || isFieldReadOnly('costs')"
                            >
                              <el-option 
                                v-for="cat in costCategories" 
                                :key="cat.value" 
                                :label="cat.label" 
                                :value="cat.value" 
                                :disabled="isCategorySelected(cat.value, index)"
                              />
                            </el-select>
                          </td>
                          <td class="px-4 py-4">
                            <el-select 
                              v-model="item.supplier" 
                              placeholder="请选择供应商"
                              class="w-full custom-select-small supplier-select"
                              popper-class="custom-dropdown"
                              :disabled="isViewMode || isFieldReadOnly('costs')"
                            >
                              <el-option 
                                v-for="sup in suppliers" 
                                :key="sup.value" 
                                :label="sup.label" 
                                :value="sup.value" 
                              />
                            </el-select>
                          </td>
                          <td class="px-4 py-4">
                            <div class="flex items-center gap-2 bg-neutral-900/40 px-3 py-1.5 rounded-lg border border-white/5 focus-within:border-primary/40 transition-all">
                              <span class="text-xs text-on-surface-variant font-mono">¥</span>
                              <input 
                                v-model="item.amount"
                                type="number"
                                class="bg-transparent border-none p-0 focus:ring-0 text-sm font-mono w-full outline-none cost-amount-input"
                                placeholder="0.00"
                                :disabled="isViewMode || isFieldReadOnly('costs')"
                              >
                            </div>
                          </td>
                          <td class="px-4 py-4 text-center">
                            <el-switch
                              v-model="item.isSettled"
                              active-text="是"
                              inactive-text="否"
                              inline-prompt
                              style="--el-switch-on-color: #13ce66; --el-switch-off-color: #ff4949"
                              :disabled="isViewMode || isFieldReadOnly('costs')"
                            />
                          </td>
                          <td class="px-4 py-4 text-right rounded-r-lg">
                            <button 
                              class="text-red-400/40 hover:text-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                              :disabled="isViewMode || isFieldReadOnly('costs')"
                              @click="costs.splice(index, 1)"
                            >
                              <el-icon class="text-lg">
                                <Delete />
                              </el-icon>
                            </button>
                          </td>
                        </tr>
                        <tr v-if="costs.length === 0">
                          <td
                            colspan="4"
                            class="px-4 py-8 text-center bg-surface-container-lowest rounded-lg border border-white/5"
                          >
                            <span class="text-xs text-on-surface-variant opacity-50 tracking-widest uppercase font-bold">暂无成本支出记录</span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <!-- Vouchers Section -->
                  <div
                    v-if="form.isHasVoucher === YES_NO_VALUE.YES"
                    class="mt-8 border-t border-white/5 pt-6"
                  >
                    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
                      <h4 class="text-xs font-bold text-on-surface-variant uppercase tracking-widest flex items-center gap-2">
                        单据凭证列表 (支持 JPG, PNG, WEBP 格式，支持多�?
                      </h4>
                      <label 
                        v-if="!isViewMode && !isFieldReadOnly('vouchers')"
                        for="voucher-file-input"
                        class="flex items-center gap-2 text-xs font-bold text-primary hover:underline cursor-pointer"
                        :class="{ 'opacity-50 pointer-events-none': uploadingVoucher }"
                      >
                        <el-icon v-if="!uploadingVoucher">
                          <Upload />
                        </el-icon>
                        <el-icon
                          v-else
                          class="animate-spin"
                        >
                          <Refresh />
                        </el-icon>
                        <span>{{ uploadingVoucher ? '正在上传...' : '上传凭证' }}</span>
                      </label>
                    </div>
                  
                    <!-- 隐藏的文件输入框 -->
                    <input 
                      id="voucher-file-input"
                      ref="fileInputRef"
                      type="file" 
                      multiple 
                      accept="image/*" 
                      class="hidden" 
                      @change="handleVoucherUpload"
                    >

                    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                      <!-- 已上传图片展�?-->
                      <div 
                        v-for="(v, idx) in vouchers" 
                        :key="v.fileId || v.id || idx"
                        class="aspect-square rounded-lg bg-surface-container-lowest border border-white/10 overflow-hidden relative group cursor-pointer"
                      >
                        <img 
                          :src="v.url" 
                          :alt="v.name" 
                          class="w-full h-full object-cover transition-transform group-hover:scale-105"
                          referrerPolicy="no-referrer"
                        >
                        <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition-opacity gap-2">
                          <div
                            v-if="v.deleting"
                            class="flex flex-col items-center gap-2 text-primary"
                          >
                            <el-icon
                              class="animate-spin"
                              size="24"
                            >
                              <Refresh />
                            </el-icon>
                            <span class="text-[10px]">正在删除...</span>
                          </div>
                          <div
                            v-else
                            class="flex gap-3"
                          >
                            <el-icon
                              class="text-white hover:text-primary transition-colors"
                              size="20"
                              @click.stop="handlePreview(idx)"
                            >
                              <View />
                            </el-icon>
                            <el-icon
                              v-if="!isViewMode && !isFieldReadOnly('vouchers')"
                              class="text-red-400 hover:text-red-500 transition-colors"
                              size="20"
                              @click.stop="removeVoucher(idx)"
                            >
                              <Delete />
                            </el-icon>
                          </div>
                        </div>
                      </div>

                      <!-- Upload Placeholder -->
                      <label 
                        v-if="vouchers.length < 20 && !isViewMode && !isFieldReadOnly('vouchers')"
                        for="voucher-file-input"
                        class="aspect-square rounded-lg border-2 border-dashed border-white/10 flex flex-col items-center justify-center gap-2 text-on-surface-variant hover:border-primary/50 hover:text-primary transition-all bg-surface-container-lowest/50 group cursor-pointer"
                        :class="{ 'opacity-30 pointer-events-none': uploadingVoucher }"
                      >
                        <el-icon
                          v-if="!uploadingVoucher"
                          size="24"
                          class="group-hover:scale-110 transition-transform"
                        >
                          <Plus />
                        </el-icon>
                        <el-icon
                          v-else
                          size="24"
                          class="animate-spin"
                        >
                          <Refresh />
                        </el-icon>
                        <div class="flex flex-col items-center">
                          <span class="text-[10px] font-bold">{{ uploadingVoucher ? '上传中' : '继续添加' }}</span>
                          <span class="text-[8px] opacity-40">{{ vouchers.length }}/20</span>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>
              </el-collapse-transition>
            </section>

            <!-- Project Contract Management Section -->
            <section
              v-if="form.isHasContract === YES_NO_VALUE.YES"
              class="bg-surface-container-high rounded-xl overflow-hidden border border-white/5 shadow-2xl transition-all duration-300"
            >
              <div 
                class="p-6 md:p-8 flex justify-between items-center cursor-pointer"
                @click="isContractInfoCollapsed = !isContractInfoCollapsed"
              >
                <h3 class="text-lg font-bold flex items-center gap-2">
                  <span class="w-1.5 h-6 bg-amber-500 rounded-full" />
                  <span>项目合同管理</span>
                  <el-icon 
                    class="text-on-surface-variant transition-transform duration-300 ml-1"
                    :class="{ 'rotate-180': !isContractInfoCollapsed }"
                  >
                    <ArrowDown />
                  </el-icon>
                </h3>
              </div>

              <el-collapse-transition>
                <div 
                  v-show="!isContractInfoCollapsed" 
                  class="px-6 md:px-8 pb-8"
                >
                  <!-- Upload Area -->
                  <label 
                    v-if="!isViewMode && !isFieldReadOnly('isHasContract')"
                    for="contract-file-input"
                    class="w-full p-10 upload-dashed-border rounded-xl bg-surface-container-lowest flex flex-col items-center justify-center gap-5 hover:bg-primary/5 transition-all cursor-pointer group mb-6"
                  >
                    <div class="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                      <el-icon
                        v-if="!uploadingContract"
                        size="32"
                      >
                        <Upload />
                      </el-icon>
                      <el-icon
                        v-else
                        size="32"
                        class="animate-spin"
                      >
                        <Refresh />
                      </el-icon>
                    </div>
                    <div class="text-center">
                      <p class="text-sm font-bold text-on-surface tracking-wide">
                        {{ uploadingContract ? '正在上传...' : '点击上传项目合同' }}
                      </p>
                      <p class="text-xs text-on-surface-variant mt-2 opacity-60">
                        支持 JPG, PNG, PDF 格式，请上传清晰的扫描件或照�?
                      </p>
                    </div>
                  </label>

                  <input 
                    id="contract-file-input"
                    ref="contractInputRef"
                    type="file" 
                    multiple 
                    accept="image/*,application/pdf" 
                    class="hidden" 
                    @change="handleContractUpload"
                  >

                  <!-- File Echo Area -->
                  <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    <div 
                      v-for="(c, idx) in contracts" 
                      :key="c.id || idx"
                      class="aspect-square rounded-lg bg-surface-container-lowest border border-white/10 overflow-hidden relative group cursor-pointer"
                    >
                      <div
                        v-if="c.type === 'application/pdf'"
                        class="w-full h-full flex flex-col items-center justify-center bg-surface-container-high/30 gap-2 p-2"
                      >
                        <el-icon
                          size="32"
                          class="text-red-400"
                        >
                          <Document />
                        </el-icon>
                        <span class="text-[10px] text-on-surface-variant text-center line-clamp-2 px-1">{{ c.name }}</span>
                      </div>
                      <img 
                        v-else
                        :src="c.url" 
                        :alt="c.name" 
                        class="w-full h-full object-cover transition-transform group-hover:scale-105"
                        referrerPolicy="no-referrer"
                      >
                      <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition-opacity gap-2">
                        <div
                          v-if="c.deleting"
                          class="flex flex-col items-center gap-2 text-primary"
                        >
                          <el-icon
                            class="animate-spin"
                            size="24"
                          >
                            <Refresh />
                          </el-icon>
                          <span class="text-[10px]">正在删除...</span>
                        </div>
                        <div
                          v-else
                          class="flex gap-3"
                        >
                          <el-icon
                            class="text-white hover:text-primary transition-colors"
                            size="20"
                            @click.stop="handleContractPreview(idx)"
                          >
                            <View />
                          </el-icon>
                          <el-icon
                            v-if="!isViewMode && !isFieldReadOnly('isHasContract')"
                            class="text-red-400 hover:text-red-500 transition-colors"
                            size="20"
                            @click.stop="removeContract(idx)"
                          >
                            <Delete />
                          </el-icon>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </el-collapse-transition>
            </section>

            <!-- Project Preview Management Section -->
            <section
              v-if="form.isHasPreview === YES_NO_VALUE.YES"
              class="bg-surface-container-high rounded-xl overflow-hidden border border-white/5 shadow-2xl transition-all duration-300"
            >
              <div 
                class="p-6 md:p-8 flex justify-between items-center cursor-pointer"
                @click="isPreviewInfoCollapsed = !isPreviewInfoCollapsed"
              >
                <h3 class="text-lg font-bold flex items-center gap-2">
                  <span class="w-1.5 h-6 bg-rose-500 rounded-full" />
                  <span>项目预览图管</span>
                  <el-icon 
                    class="text-on-surface-variant transition-transform duration-300 ml-1"
                    :class="{ 'rotate-180': !isPreviewInfoCollapsed }"
                  >
                    <ArrowDown />
                  </el-icon>
                </h3>
              </div>

              <el-collapse-transition>
                <div 
                  v-show="!isPreviewInfoCollapsed" 
                  class="px-6 md:px-8 pb-8"
                >
                  <!-- Upload Area -->
                  <label 
                    v-if="!isViewMode && !isFieldReadOnly('isHasPreview')"
                    for="preview-file-input"
                    class="w-full p-10 upload-dashed-border rounded-xl bg-surface-container-lowest flex flex-col items-center justify-center gap-5 hover:bg-primary/5 transition-all cursor-pointer group mb-6"
                  >
                    <div class="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                      <el-icon
                        v-if="!uploadingPreview"
                        size="32"
                      >
                        <Picture />
                      </el-icon>
                      <el-icon
                        v-else
                        size="32"
                        class="animate-spin"
                      >
                        <Refresh />
                      </el-icon>
                    </div>
                    <div class="text-center">
                      <p class="text-sm font-bold text-on-surface tracking-wide">
                        {{ uploadingPreview ? '正在上传...' : '点击上传方案预览图' }}
                      </p>
                      <p class="text-xs text-on-surface-variant mt-2 opacity-60">
                        支持 JPG, PNG 格式，最多上�?4 张图�?
                      </p>
                    </div>
                  </label>

                  <input 
                    id="preview-file-input"
                    ref="previewInputRef"
                    type="file" 
                    multiple 
                    accept="image/*" 
                    class="hidden" 
                    @change="handlePreviewUpload"
                  >

                  <!-- Image Grid Preview / Echo -->
                  <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    <div 
                      v-for="(p, idx) in previews" 
                      :key="p.id || idx"
                      class="aspect-square rounded-lg bg-surface-container-lowest border border-white/10 overflow-hidden relative group cursor-pointer"
                    >
                      <img 
                        :src="p.url" 
                        class="w-full h-full object-cover transition-transform group-hover:scale-105"
                        referrerPolicy="no-referrer"
                      >
                      <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition-opacity gap-2">
                        <div
                          v-if="p.deleting"
                          class="flex flex-col items-center gap-2 text-primary"
                        >
                          <el-icon
                            class="animate-spin"
                            size="24"
                          >
                            <Refresh />
                          </el-icon>
                          <span class="text-[10px]">正在删除...</span>
                        </div>
                        <div
                          v-else
                          class="flex gap-3"
                        >
                          <el-icon
                            class="text-white hover:text-primary transition-colors"
                            size="20"
                            @click.stop="handlePreviewImagePreview(idx)"
                          >
                            <View />
                          </el-icon>
                          <el-icon
                            v-if="!isViewMode && !isFieldReadOnly('isHasPreview')"
                            class="text-red-400 hover:text-red-500 transition-colors"
                            size="20"
                            @click.stop="removePreview(idx)"
                          >
                            <Delete />
                          </el-icon>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </el-collapse-transition>
            </section>

            <!-- 子项目管�?(长期项目专用) -->
            <section 
              v-if="form.type === 'long_term'" 
              class="bg-surface-container-low rounded-2xl p-6 md:p-8 border-t-2 border-emerald-500/20 shadow-2xl"
            >
              <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                <div>
                  <h2 class="text-2xl font-bold text-on-surface flex items-center gap-3">
                    <span class="material-symbols-outlined text-emerald-500 text-3xl">account_tree</span>
                    子项目管�?
                  </h2>
                  <p class="text-on-surface-variant text-sm mt-1">处理项目的周期性养护与植物更新子任</p>
                </div>
              </div>

              <!-- 子项目折叠面板容�?-->
              <div class="space-y-4 mb-8">
                <div 
                  v-for="(sp, index) in form.subProjects" 
                  :key="sp.id"
                  class="bg-surface-container-high rounded-xl overflow-hidden border border-white/5 shadow-lg transition-all duration-300"
                >
                  <!-- 面板头部 -->
                  <div 
                    class="flex items-center justify-between px-6 py-5 cursor-pointer hover:bg-white/5 transition-all bg-surface-container-highest/30"
                    @click="sp.isCollapsed = !sp.isCollapsed"
                  >
                    <div class="grid grid-cols-1 md:grid-cols-3 flex-1 gap-6 items-center">
                      <div class="flex items-center gap-3">
                        <div 
                          class="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                          :class="index % 2 === 0 ? 'bg-emerald-500/20 text-emerald-500' : 'bg-cyan-500/20 text-cyan-500'"
                        >
                          <span class="text-xs font-bold">{{ String(index + 1).padStart(2, '0') }}</span>
                        </div>
                        <div class="min-w-0">
                          <div class="text-[10px] text-on-surface-variant uppercase tracking-tighter truncate">项目内容</div>
                          <div 
                            class="text-sm font-bold truncate"
                            :class="index % 2 === 0 ? 'text-emerald-400' : 'text-cyan-400'"
                          >
                            {{ sp.content || '未设置' }}
                          </div>
                        </div>
                      </div>
                      <div>
                        <div class="text-[10px] text-on-surface-variant uppercase tracking-tighter">开始日</div>
                        <div class="text-sm font-medium text-on-surface">{{ sp.startDate || '-' }}</div>
                      </div>
                      <div>
                        <div class="text-[10px] text-on-surface-variant uppercase tracking-tighter">订单金额</div>
                        <div class="text-sm font-bold text-on-surface">¥ {{ Number(sp.amount || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 }) }}</div>
                      </div>
                    </div>
                    <div class="flex items-center gap-4 ml-4">
                      <el-icon 
                        class="text-on-surface-variant transition-transform duration-300"
                        :class="{ 'rotate-180': !sp.isCollapsed }"
                      >
                        <ArrowDown />
                      </el-icon>
                      <el-icon 
                        v-if="!isViewMode && !isLongTermTerminated"
                        class="text-red-400/40 hover:text-red-400 transition-colors"
                        @click.stop="removeSubProject(index)"
                      >
                        <Delete />
                      </el-icon>
                    </div>
                  </div>

                  <!-- 面板内容 -->
                  <el-collapse-transition>
                    <div v-show="!sp.isCollapsed" class="px-6 py-8 border-t border-white/5 bg-surface-container-high">
                      <div class="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
                        <div class="space-y-2">
                          <label class="block text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">项目内容选择</label>
                          <el-select 
                            v-model="sp.content" 
                            placeholder="请选择内容" 
                            class="w-full custom-select"
                            popper-class="custom-dropdown"
                            :disabled="isViewMode || isLongTermTerminated"
                          >
                            <el-option 
                              v-for="item in subProjectContents" 
                              :key="item.value" 
                              :label="item.label" 
                              :value="item.value" 
                            />
                          </el-select>
                        </div>
                        <div class="space-y-2">
                          <label class="block text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">开始日</label>
                          <el-date-picker
                            v-model="sp.startDate"
                            type="date"
                            placeholder="选择日期"
                            class="!w-full custom-date-picker"
                            format="YYYY-MM-DD"
                            value-format="YYYY-MM-DD"
                            :disabled="isViewMode || isLongTermTerminated"
                            :disabled-date="disabledFutureDate"
                          />
                        </div>
                        <div class="space-y-2">
                          <label class="block text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">订单金额 (¥)</label>
                          <el-input 
                            v-model="sp.amount" 
                            placeholder="0.00" 
                            class="custom-input"
                            :disabled="isViewMode || isLongTermTerminated"
                          />
                        </div>
                        <div class="space-y-2">
                          <label class="block text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">是否有发票凭</label>
                          <el-select 
                            v-model="sp.isHasVoucher" 
                            placeholder="请选择" 
                            class="w-full custom-select"
                            popper-class="custom-dropdown"
                            :disabled="isViewMode || isLongTermTerminated"
                          >
                            <el-option label="是" :value="YES_NO_VALUE.YES" />
                            <el-option label="否" :value="YES_NO_VALUE.NO" />
                          </el-select>
                        </div>
                      </div>

                      <!-- 嵌套成本支出表格 -->
                      <div class="bg-surface-container-low rounded-xl overflow-hidden border border-white/5 mb-10">
                        <div class="px-5 py-4 border-b border-white/5 flex justify-between items-center bg-white/5">
                          <span 
                            class="text-xs font-bold uppercase tracking-widest flex items-center gap-2"
                            :class="index % 2 === 0 ? 'text-emerald-400' : 'text-cyan-400'"
                          >
                            <span class="material-symbols-outlined text-sm">receipt_long</span>
                            成本支出明细 (子项�?#{{ String(index + 1).padStart(2, '0') }})
                          </span>
                          <button 
                            v-if="!isViewMode && !isLongTermTerminated"
                            class="text-[10px] border px-3 py-1 rounded transition-all font-bold"
                            :class="index % 2 === 0 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20' : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20 hover:bg-cyan-500/20'"
                            @click="addSubProjectCost(sp)"
                          >
                            添加成本记录
                          </button>
                        </div>
                        <div class="overflow-x-auto">
                          <table class="w-full text-xs text-left border-separate border-spacing-y-2 px-4">
                            <thead class="text-on-surface-variant uppercase tracking-widest">
                              <tr>
                                <th class="px-4 py-2 font-medium w-[25%]">类目</th>
                                <th class="px-4 py-2 font-medium w-[25%]">供应</th>
                                <th class="px-4 py-2 font-medium w-[20%] text-center">支出金额 (¥)</th>
                                <th class="px-4 py-2 font-medium w-[20%] text-center">是否结清</th>
                                <th v-if="!isViewMode" class="px-4 py-2 font-medium text-right w-[10%]">操作</th>
                              </tr>
                            </thead>
                            <tbody class="divide-y divide-white/5">
                              <tr v-for="(cost, cIdx) in sp.costs" :key="cost.id" class="bg-surface-container-lowest/50 group hover:bg-white/5 transition-colors">
                                <td class="px-4 py-3 rounded-l-lg">
                                  <el-select 
                                    v-model="cost.category" 
                                    placeholder="类目" 
                                    class="w-full custom-select-small"
                                    popper-class="custom-dropdown"
                                    :disabled="isViewMode || isLongTermTerminated"
                                  >
                                    <el-option 
                                      v-for="cat in costCategories" 
                                      :key="cat.value" 
                                      :label="cat.label" 
                                      :value="cat.value" 
                                    />
                                  </el-select>
                                </td>
                                <td class="px-4 py-3">
                                  <el-select 
                                    v-model="cost.supplier" 
                                    placeholder="供应商"
                                    class="w-full custom-select-small"
                                    popper-class="custom-dropdown"
                                    :disabled="isViewMode || isLongTermTerminated"
                                  >
                                    <el-option 
                                      v-for="sup in suppliers" 
                                      :key="sup.value" 
                                      :label="sup.label" 
                                      :value="sup.value" 
                                    />
                                  </el-select>
                                </td>
                                <td class="px-4 py-3">
                                  <div class="flex items-center gap-2 bg-neutral-900/40 px-3 py-1 rounded border border-white/5 focus-within:border-primary/40 transition-all">
                                    <span class="text-[10px] text-on-surface-variant font-mono">¥</span>
                                    <input 
                                      v-model="cost.amount"
                                      type="number"
                                      class="bg-transparent border-none p-0 focus:ring-0 text-xs font-mono w-full outline-none"
                                      placeholder="0.00"
                                      :disabled="isViewMode || isLongTermTerminated"
                                    >
                                  </div>
                                </td>
                                <td class="px-4 py-3 text-center">
                                  <el-switch
                                    v-model="cost.isSettled"
                                    active-text="是"
                                    inactive-text="否"
                                    inline-prompt
                                    size="small"
                                    style="--el-switch-on-color: #13ce66; --el-switch-off-color: #ff4949"
                                    :disabled="isViewMode || isLongTermTerminated"
                                  />
                                </td>
                                <td v-if="!isViewMode && !isLongTermTerminated" class="px-4 py-3 text-right rounded-r-lg">
                                  <el-icon 
                                    class="text-red-400/40 hover:text-red-400 cursor-pointer text-base"
                                    @click="removeSubProjectCost(sp, cIdx)"
                                  >
                                    <Delete />
                                  </el-icon>
                                </td>
                              </tr>
                              <tr v-if="!sp.costs || sp.costs.length === 0">
                                <td colspan="5" class="px-4 py-10 text-center">
                                  <span class="text-[10px] text-on-surface-variant opacity-40 uppercase tracking-widest font-bold">暂无成本支出记录</span>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <!-- 子项目凭证上传区�?-->
                      <div 
                        v-if="sp.isHasVoucher === YES_NO_VALUE.YES"
                        class="mb-10 space-y-4"
                      >
                        <label class="block text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">发票凭证上传</label>
                        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                          <!-- 已上传凭证预�?-->
                          <div 
                            v-for="(v, vIdx) in sp.vouchers" 
                            :key="v.id || vIdx"
                            class="relative aspect-square rounded-lg overflow-hidden border border-white/10 group shadow-lg"
                          >
                            <img 
                              :src="v.url" 
                              class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                              referrerpolicy="no-referrer"
                            >
                            <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                              <el-icon 
                                class="text-white cursor-pointer hover:text-primary transition-colors" 
                                size="20"
                                @click="handleSubProjectVoucherPreview(sp, vIdx)"
                              >
                                <View />
                              </el-icon>
                              <el-icon 
                                v-if="!isViewMode && !isLongTermTerminated"
                                class="text-red-400 hover:text-red-500 transition-colors cursor-pointer" 
                                :class="{ 'opacity-50 pointer-events-none': v.deleting }"
                                size="20"
                                @click="removeSubProjectVoucher(sp, vIdx)"
                              >
                                <Delete v-if="!v.deleting" />
                                <Refresh v-else class="animate-spin" />
                              </el-icon>
                            </div>
                          </div>

                          <!-- 上传按钮 -->
                          <div 
                            v-if="!isViewMode && !isLongTermTerminated && (!sp.vouchers || sp.vouchers.length < 10)"
                            class="relative aspect-square rounded-lg border-2 border-dashed border-white/10 flex flex-col items-center justify-center gap-2 hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer group"
                            :class="{ 'opacity-50 pointer-events-none': sp.uploading }"
                            @click="$refs[`subVoucherInput_${index}`][0].click()"
                          >
                            <el-icon v-if="!sp.uploading" class="text-2xl text-on-surface-variant group-hover:text-primary transition-colors"><Plus /></el-icon>
                            <el-icon v-else class="text-2xl text-primary animate-spin"><Refresh /></el-icon>
                            <span class="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest group-hover:text-primary transition-colors">
                              {{ sp.uploading ? '上传�?..' : '上传凭证' }}
                            </span>
                            <input 
                              :ref="`subVoucherInput_${index}`"
                              type="file" 
                              class="hidden" 
                              accept="image/*"
                              multiple
                              @change="(e) => handleSubProjectVoucherUpload(e, sp)"
                            >
                          </div>
                        </div>
                        <p class="text-[10px] text-on-surface-variant/60 italic px-1">支持 JPG、PNG、GIF 格式，单张不超过 5MB，最多上�?10 </p>
                      </div>
                    </div>
                  </el-collapse-transition>
                </div>
              </div>

              <!-- 添加子项目虚线按�?-->
              <button 
                v-if="!isViewMode && !isLongTermTerminated"
                class="w-full py-5 border-2 border-dashed border-white/10 rounded-xl flex items-center justify-center gap-2 text-on-surface-variant hover:border-emerald-500/40 hover:text-emerald-400 hover:bg-emerald-500/5 transition-all duration-300 group"
                @click="addSubProject"
              >
                <el-icon class="text-lg group-hover:scale-110 transition-transform"><Plus /></el-icon>
                <span class="text-sm font-bold tracking-widest uppercase">添加子项</span>
              </button>
            </section>
          </div>

          <!-- Right: Analysis -->
          <div class="lg:col-span-4 space-y-8">
            <!-- Project Financial Quick Report -->
            <div class="bg-surface-container-high rounded-xl p-8 relative overflow-hidden border border-white/5">
              <div class="absolute -right-4 -top-4 w-24 h-24 bg-primary/10 rounded-full blur-2xl" />
              <h3 class="text-lg font-bold text-on-surface mb-6 font-headline tracking-tight">
                项目财务快报
              </h3>
              <div class="space-y-4">
                <!-- Card 1: Estimated Profit -->
                <div class="p-4 bg-surface-container-lowest rounded-lg border-l-4 border-primary shadow-lg hover:shadow-primary/5 transition-all">
                  <div class="flex justify-between items-start mb-2">
                    <div>
                      <p class="text-[10px] text-on-surface-variant uppercase tracking-widest mb-1">
                        预计利润
                      </p>
                      <p class="text-2xl font-mono font-black text-primary">
                        ¥ {{ formatNumber(estimatedProfit) }}
                      </p>
                    </div>
                    <span class="material-symbols-outlined text-primary/40 text-2xl">trending_up</span>
                  </div>
                  <div class="flex items-center gap-2 mt-2">
                    <div class="flex-1 h-1 bg-neutral-800 rounded-full overflow-hidden">
                      <div
                        class="h-full bg-primary"
                        :style="{ width: Math.max(0, Math.min(100, parseFloat(profitMargin))) + '%' }"
                      />
                    </div>
                    <span class="text-[10px] font-bold text-primary">{{ profitMargin }}%</span>
                  </div>
                </div>

                <!-- Card 2: Uncollected Accounts -->
                <div class="p-4 bg-surface-container-lowest rounded-lg border-l-4 border-amber-500 shadow-lg hover:shadow-amber-500/5 transition-all">
                  <div class="flex justify-between items-start mb-2">
                    <div>
                      <p class="text-[10px] text-on-surface-variant uppercase tracking-widest mb-1">
                        未收账款 (订单总额 - 已收)
                      </p>
                      <p class="text-2xl font-mono font-black text-amber-500">
                        ¥ {{ formatNumber(unreceivedAmount) }}
                      </p>
                    </div>
                    <span class="material-symbols-outlined text-amber-500/40 text-2xl">account_balance_wallet</span>
                  </div>
                  <div class="flex items-center gap-2 mt-2">
                    <div class="flex-1 h-1 bg-neutral-800 rounded-full overflow-hidden">
                      <div
                        class="h-full bg-amber-500"
                        :style="{ width: unreceivedPercent + '%' }"
                      />
                    </div>
                    <span class="text-[10px] font-bold text-amber-500">{{ unreceivedPercent }}%</span>
                  </div>
                </div>

                <!-- Card 3: Accounts Payable -->
                <div class="p-4 bg-surface-container-lowest rounded-lg border-l-4 border-rose-500 shadow-lg hover:shadow-rose-500/5 transition-all">
                  <div class="flex justify-between items-start mb-2">
                    <div>
                      <p class="text-[10px] text-on-surface-variant uppercase tracking-widest mb-1">
                        未付账款 (总成�?- 已付)
                      </p>
                      <p class="text-2xl font-mono font-black text-rose-500">
                        ¥ {{ formatNumber(unpaidAmount) }}
                      </p>
                    </div>
                    <span class="material-symbols-outlined text-rose-500/40 text-2xl">payments</span>
                  </div>
                  <div class="flex items-center gap-2 mt-2">
                    <div class="flex-1 h-1 bg-neutral-800 rounded-full overflow-hidden">
                      <div
                        class="h-full bg-rose-500"
                        :style="{ width: unpaidPercent + '%' }"
                      />
                    </div>
                    <span class="text-[10px] font-bold text-rose-500">{{ unpaidPercent }}%</span>
                  </div>
                </div>

                <div class="pt-6 border-t border-white/5 space-y-2 text-xs">
                  <div class="flex justify-between">
                    <span class="text-on-surface-variant">总预算收</span>
                    <span class="text-on-surface font-mono">¥ {{ formatNumber(totalIncome) }}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-on-surface-variant">已核算成</span>
                    <span class="text-red-400/80 font-mono">- ¥ {{ formatNumber(totalCost) }}</span>
                  </div>
                  <div class="flex justify-between font-bold">
                    <span class="text-on-surface-variant">预估净</span>
                    <span class="text-primary font-mono">¥ {{ formatNumber(estimatedProfit) }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Project Preview Carousel or Placeholder -->
            <div 
              v-if="previews.length > 0" 
              class="bg-surface-container-high rounded-xl overflow-hidden border border-white/5 relative group shadow-2xl aspect-square preview-carousel"
            >
              <el-carousel 
                height="100%" 
                arrow="hover" 
                :autoplay="true" 
                class="h-full"
                @change="handleCarouselChange"
              >
                <el-carousel-item 
                  v-for="(p, idx) in previews" 
                  :key="p.id || idx"
                >
                  <img 
                    :src="p.url" 
                    class="w-full h-full object-cover opacity-80" 
                    referrerPolicy="no-referrer"
                  >
                </el-carousel-item>
              </el-carousel>
              
              <!-- Gradient Overlay -->
              <div class="absolute inset-0 bg-gradient-to-t from-surface-container-high via-transparent to-transparent pointer-events-none z-10" />
              
              <!-- Bottom Info -->
              <div class="absolute bottom-6 left-6 z-20">
                <p class="text-[10px] text-primary uppercase tracking-[0.3em] font-bold mb-1">
                  方案预览
                </p>
                <h4 class="text-sm font-bold text-on-surface">
                  {{ form.name || '项目预览图' }} ({{ currentCarouselIndex + 1 }}/{{ previews.length }})
                </h4>
              </div>
              
              <!-- Fullscreen Button -->
              <button 
                class="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-on-surface hover:bg-primary hover:text-on-primary transition-all z-20"
                title="全屏查看"
                @click="handlePreviewImagePreview(currentCarouselIndex)"
              >
                <el-icon size="20">
                  <FullScreen />
                </el-icon>
              </button>
            </div>

            <div 
              v-else 
              class="rounded-xl overflow-hidden aspect-square relative group border border-white/5 flex flex-col items-center justify-center bg-surface-container-high"
            >
              <div class="absolute inset-0 bg-neutral-900/40 flex flex-col items-center justify-center gap-4">
                <div class="w-24 h-24 rounded-full border-2 border-dashed border-primary/20 flex items-center justify-center relative">
                  <el-icon
                    size="40"
                    class="text-primary/30 animate-pulse"
                  >
                    <Picture />
                  </el-icon>
                  <div
                    class="absolute inset-0 rounded-full border-t-2 border-primary/10 animate-spin"
                    style="animation-duration: 8s"
                  />
                </div>
                <p class="text-sm font-bold text-on-surface-variant/40 tracking-widest">
                  暂无方案预览
                </p>
              </div>
              <div class="absolute bottom-6 left-6">
                <p class="text-[10px] text-primary uppercase tracking-[0.3em] font-bold mb-1">
                  方案预览
                </p>
                <h4 class="text-sm font-bold text-on-surface-variant/60">
                  等待上传设计�?
                </h4>
              </div>
            </div>

            <el-card class="!p-6">
              <h3 class="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-4">
                成本构成分析
              </h3>
              <div
                v-if="costAnalysisData.length > 0"
                class="flex items-end gap-3 h-32 pt-4 mb-8"
              >
                <div
                  v-for="item in costAnalysisData"
                  :key="item.label" 
                  class="flex-1 rounded-t-sm transition-all cursor-pointer relative group"
                  :class="[item.color, item.hover]"
                  :style="{ height: item.percentage + '%' }"
                >
                  <div class="absolute -top-8 left-1/2 -translate-x-1/2 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap text-on-surface-variant bg-surface-container-highest px-2 py-1 rounded shadow-lg z-10 border border-white/10">
                    {{ item.label }}: {{ item.percentage }}%
                  </div>
                  <div class="absolute -bottom-7 left-1/2 -translate-x-1/2 text-[10px] font-medium text-on-surface-variant/80 whitespace-nowrap">
                    {{ item.label }}
                  </div>
                </div>
              </div>
              <div
                v-else
                class="h-32 flex flex-col items-center justify-center gap-2 opacity-20 mb-4"
              >
                <div class="flex items-end gap-3 h-16 w-full px-4">
                  <div class="flex-1 bg-neutral-700 rounded-t-sm h-[10%]" />
                  <div class="flex-1 bg-neutral-700 rounded-t-sm h-[10%]" />
                  <div class="flex-1 bg-neutral-700 rounded-t-sm h-[10%]" />
                  <div class="flex-1 bg-neutral-700 rounded-t-sm h-[10%]" />
                  <div class="flex-1 bg-neutral-700 rounded-t-sm h-[10%]" />
                </div>
                <p class="text-[10px] text-center text-on-surface-variant italic">
                  完成成本项录入后生成
                </p>
              </div>
            </el-card>
          </div>
        </div>

        <!-- Footer Actions -->
        <div
          v-if="isCreating"
          class="flex justify-end gap-4 pt-4 pb-12"
        >
          <el-button 
            type="primary" 
            size="large" 
            class="!px-10 !font-bold !text-black shadow-xl hover:brightness-110"
            :loading="savingProject"
            @click="handleSaveProject"
          >
            {{ form.type === 'historical' ? '保存补录档案' : '创建新项目' }}
          </el-button>
          <el-button 
            type="info" 
            size="large" 
            class="!px-10 !bg-neutral-800 !text-on-surface-variant !border-white/10 !font-bold shadow-xl hover:!bg-neutral-700 hover:!text-white"
            @click="handleAbandonCreate"
          >
            放弃创建
          </el-button>
        </div>

        <div
          v-if="isEditMode"
          class="flex justify-end gap-4 pt-4 pb-12"
        >
          <el-button
            type="primary"
            size="large"
            class="!px-10 !font-bold !text-black shadow-xl hover:brightness-110"
            :loading="savingProject"
            @click="confirmSaveUpdate"
          >
            确认保存
          </el-button>
          <el-button
            type="info"
            size="large"
            class="!px-10 !bg-neutral-800 !text-on-surface-variant !border-white/10 !font-bold shadow-xl hover:!bg-neutral-700 hover:!text-white"
            @click="handleAbandonEdit"
          >
            放弃修改
          </el-button>
        </div>
        </template>

        <template v-else-if="activeMenu === 'settings'">
          <section class="settings-page relative space-y-12 pb-20">
            <div class="flex justify-between items-end">
              <div>
                <h2 class="text-3xl font-bold tracking-tight mb-2">
                  系统设置中心
                </h2>
                <div class="flex gap-2 text-xs text-on-surface-variant uppercase tracking-widest">
                  <span class="text-primary">设置</span>
                  <span>/</span>
                  <span>系统配置</span>
                </div>
              </div>
            </div>

            <section class="space-y-6">
              <div class="flex items-center gap-2">
                <span class="material-symbols-outlined text-primary text-xl">person</span>
                <h2 class="text-xl font-medium text-zinc-100">
                  账户信息
                </h2>
              </div>

              <div class="bg-surface-container-high rounded-xl p-8 border border-white/5 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-6">
                <div class="flex items-center gap-8">
                  <div class="relative">
                    <img
                      alt="管理员头像"
                      class="w-24 h-24 rounded-xl object-cover border-2 border-primary/30"
                      :src="currentUser.avatarUrl || DEFAULT_ADMIN_AVATAR"
                    >
                    <div class="absolute -bottom-2 -right-2 bg-primary rounded-lg p-1">
                      <span class="material-symbols-outlined text-black text-sm setting-icon-filled">verified</span>
                    </div>
                  </div>
                  <div class="space-y-1">
                    <h3 class="text-2xl font-bold text-zinc-100">
                      {{ currentUser.nickname || currentUser.username || '系统管理员' }}
                    </h3>
                    <div class="flex flex-wrap items-center gap-3">
                      <span class="px-2 py-0.5 bg-primary/10 text-primary text-[10px] rounded uppercase font-bold tracking-widest">
                        {{ currentUserRoleText }}
                      </span>
                      <span class="text-zinc-500 text-sm">
                        工号: {{ currentUser.employeeNo || '-' }}
                      </span>
                    </div>
                    <div class="flex items-center gap-1 pt-3 text-xs text-zinc-500">
                      <span class="material-symbols-outlined text-sm">schedule</span>
                      <span>上次登录: {{ formatLastLogin(currentUser.lastLoginTime) }}</span>
                    </div>
                  </div>
                </div>
                <button
                  class="flex items-center justify-center gap-2 px-6 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-white/10 rounded-lg transition-all duration-300"
                  @click="openUserDialog"
                >
                  <span class="material-symbols-outlined text-lg">edit_square</span>
                  <span class="text-sm font-medium">编辑个人资料</span>
                </button>
              </div>
            </section>

            <section
              v-if="isSuperAdmin"
              class="p-6 rounded-xl bg-surface-container-high overflow-hidden"
            >
                <div class="flex justify-between items-center mb-6">
                  <h3 class="text-sm font-semibold text-zinc-300 flex items-center gap-2">
                    <span class="material-symbols-outlined text-emerald-400 text-lg">shield_person</span>
                    角色权限矩阵
                  </h3>
                  <div class="text-[10px] text-zinc-500 italic">
                    自动保存已开�?                  </div>
                </div>
                <div class="overflow-x-auto">
                  <table class="w-full text-left border-separate border-spacing-y-2">
                    <thead>
                      <tr class="text-[10px] uppercase tracking-widest text-zinc-500 border-b border-zinc-800">
                        <th class="pb-4 font-medium pl-4">
                          权限�?\ 角色
                        </th>
                        <th
                          v-for="role in settingRoles"
                          :key="role.value"
                          class="pb-4 font-medium text-center whitespace-nowrap"
                        >
                          {{ role.label }}
                        </th>
                      </tr>
                    </thead>
                    <tbody class="text-xs">
                      <tr
                        v-for="permission in settingPermissions"
                        :key="permission.name"
                        class="group hover:bg-zinc-800/30 transition-colors"
                      >
                        <td class="py-3 pl-4 text-zinc-300 font-medium whitespace-nowrap">
                          {{ permission.name }}
                        </td>
                        <td
                          v-for="role in settingRoles"
                          :key="`${permission.key}-${role.value}`"
                          class="text-center"
                        >
                          <button
                            type="button"
                            class="permission-toggle-btn"
                            :title="permission.enabledRoles.includes(role.value) ? '点击移除权限' : '点击配置权限'"
                            @click="togglePermissionRole(permission, role.value)"
                          >
                            <span
                              class="material-symbols-outlined text-base"
                              :class="permission.enabledRoles.includes(role.value) ? 'text-primary setting-icon-filled' : 'text-zinc-700'"
                            >
                              {{ permission.enabledRoles.includes(role.value) ? 'check_circle' : 'radio_button_unchecked' }}
                            </span>
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
            </section>

            <section class="space-y-8">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span class="material-symbols-outlined text-secondary text-xl">database</span>
                  <h2 class="text-xl font-medium text-zinc-100">
                  数据配置
                  </h2>
                </div>
                <span class="text-xs text-zinc-500 uppercase tracking-widest">Master Data Control Center</span>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-8">
                <div
                  v-for="card in settingConfigCards"
                  :key="card.title"
                  class="p-8 rounded-xl bg-surface-container-high border-b-2 border-transparent transition-all duration-300 group"
                  :class="card.hoverBorder"
                >
                  <div class="flex justify-between items-start mb-6">
                    <div
                      class="w-12 h-12 rounded-lg bg-zinc-800 flex items-center justify-center transition-colors"
                      :class="card.iconHover"
                    >
                      <span
                        class="material-symbols-outlined"
                        :class="card.iconColor"
                      >{{ card.icon }}</span>
                    </div>
                    <button
                      class="text-zinc-600 hover:text-zinc-300"
                      @click="openConfigDialog(card)"
                    >
                      <span class="material-symbols-outlined">settings</span>
                    </button>
                  </div>
                  <h3 class="text-lg font-bold text-zinc-100 mb-2">
                    {{ card.title }}
                  </h3>
                  <p class="text-xs text-zinc-500 mb-6 font-light">
                    {{ card.description }}
                  </p>
                  <div class="flex flex-wrap gap-2">
                    <span
                      v-for="tag in getSettingConfigItems(card)"
                      :key="tag.id || tag._id || tag.value"
                      class="inline-flex h-8 items-center gap-2 pl-3 pr-1 text-[10px] leading-none rounded transition-colors border"
                      :class="tag.isActive === false ? 'bg-zinc-950/60 text-zinc-600 border-zinc-800' : 'bg-zinc-950 text-zinc-300 hover:bg-zinc-900 border-emerald-900/30'"
                    >
                      <span>{{ tag.label }}</span>
                      <button
                        class="inline-flex h-5 items-center rounded px-1.5 text-[10px] disabled:opacity-40 disabled:cursor-not-allowed"
                        :class="tag.isActive === false ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-zinc-500 hover:text-amber-300 hover:bg-amber-500/10'"
                        :disabled="updatingConfigKey === (tag.id || tag._id)"
                        :aria-label="tag.isActive === false ? `启用${tag.label}` : `停用${tag.label}`"
                        :title="tag.isActive === false ? '启用配置' : '停用配置'"
                        @click.stop="handleToggleConfigStatus(card, tag)"
                      >
                        {{ tag.isActive === false ? '启用' : '停用' }}
                      </button>
                    </span>
                    <span
                      class="inline-flex h-8 items-center px-3 bg-primary/10 text-primary text-[10px] leading-none rounded border border-primary/20 gap-1 cursor-pointer"
                      @click="openConfigDialog(card)"
                    >
                      <span class="material-symbols-outlined text-[10px]">add</span>
                      新增
                    </span>
                  </div>
                </div>

              </div>
            </section>
          </section>
        </template>
      </main>
    </div>

    <!-- 图片预览组件 -->
    <el-image-viewer
      v-if="activeMenu === 'projects' && previewVisible"
      :url-list="previewList"
      :initial-index="initialIndex"
      teleported
      @close="previewVisible = false"
    />

    <!-- 悬浮回到顶部按钮 -->
    <div 
      v-if="activeMenu === 'projects'"
      class="fixed z-[9999] cursor-move select-none group"
      :style="{ left: floatBtnPos.x + 'px', top: floatBtnPos.y + 'px' }"
      @mousedown="startDrag"
    >
      <button 
        class="w-12 h-12 rounded-full bg-surface-container-high/80 backdrop-blur-xl border border-white/20 text-primary shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.1)] flex items-center justify-center transition-all active:scale-95 active:shadow-inner group-hover:bg-primary group-hover:text-black group-hover:border-primary/50"
        title="回到顶部"
        @click="scrollToTop"
      >
        <el-icon class="text-xl group-hover:-translate-y-0.5 transition-transform">
          <ArrowUp />
        </el-icon>
      </button>
    </div>

    <el-dialog
      v-model="configDialog.visible"
      :title="`新增${configDialog.title}`"
      width="460px"
      class="custom-message-box"
      append-to-body
    >
      <div class="space-y-5">
        <div class="space-y-2">
          <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">中文</label>
          <el-input
            v-model="configDialog.form.label"
            class="custom-input"
            maxlength="20"
            show-word-limit
            placeholder="请输入配置中文名"
          />
        </div>
        <div class="space-y-2">
          <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">英文标识</label>
          <el-input
            :model-value="configValuePreview"
            class="custom-input"
            disabled
            placeholder="系统自动生成"
          />
        </div>
        <div class="space-y-2">
          <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">备注说明</label>
          <el-input
            v-model="configDialog.form.description"
            type="textarea"
            class="custom-textarea"
            maxlength="60"
            show-word-limit
            :rows="3"
            placeholder="请输入备注说明"
          />
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-3">
          <el-button
            class="!bg-neutral-800 !border-white/10 !text-on-surface-variant"
            @click="configDialog.visible = false"
          >
            取消
          </el-button>
          <el-button
            type="primary"
            class="!bg-primary !border-primary !text-black !font-bold"
            :loading="configDialog.submitting"
            @click="handleCreateConfig"
          >
            创建
          </el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="userDialog.visible"
      title="编辑用户信息"
      width="520px"
      class="custom-message-box"
      append-to-body
    >
      <div class="space-y-6">
        <div class="flex items-center gap-5">
          <div class="w-20 h-20 rounded-xl overflow-hidden border border-primary/20 bg-zinc-900">
            <img
              :src="userDialog.form.avatarUrl || DEFAULT_ADMIN_AVATAR"
              alt="用户头像"
              class="w-full h-full object-cover"
            >
          </div>
          <div class="space-y-2">
            <input
              ref="avatarInputRef"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              class="hidden"
              @change="handleAvatarChange"
            >
            <el-button
              class="!bg-primary/10 !border-primary/20 !text-primary"
              :loading="userDialog.uploading"
              @click="avatarInputRef?.click()"
            >
              上传头像
            </el-button>
            <p class="text-[10px] text-zinc-500">
              支持 JPG、PNG、WebP，最�?2MB
            </p>
          </div>
        </div>
        <div class="space-y-2">
          <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">登录账号</label>
          <el-input
            v-model="userDialog.form.username"
            class="custom-input"
            disabled
          />
        </div>
        <div class="space-y-2">
          <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">用户昵称</label>
          <el-input
            v-model="userDialog.form.nickname"
            class="custom-input"
            maxlength="20"
            show-word-limit
          />
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-3">
          <el-button
            class="!bg-neutral-800 !border-white/10 !text-on-surface-variant"
            @click="userDialog.visible = false"
          >
            取消
          </el-button>
          <el-button
            type="primary"
            class="!bg-primary !border-primary !text-black !font-bold"
            :loading="userDialog.submitting"
            @click="handleUpdateUser"
          >
            保存
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, markRaw, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { queryClients, createClient, queryConfig, getGlobalConfig, createConfig, updateConfigStatus, addVoucher, getVouchers, deleteVoucher, deleteProject, deleteVouchersByProject, renameProjectVouchers, renameProjectFiles, createProject, updateProject, updateVouchersProject, listProjects, getContracts, getPreviews, deleteContract, deletePreview, updateContractsProject, updatePreviewsProject } from '../api/common'
import axios from 'axios'
import Compressor from 'compressorjs'
import { getInfo, updateInfo, uploadAvatar } from '../api/user'
import { 
  DataBoard, 
  User, 
  Search, 
  Bell, 
  QuestionFilled, 
  Plus, 
  ArrowDown,
  ArrowUp,
  Delete,
  Close,
  Upload,
  View,
  Picture,
  Management,
  Briefcase,
  Box,
  Setting,
  Refresh,
  Edit,
  Check,
  ArrowLeft,
  ArrowRight,
  FullScreen,
} from '@element-plus/icons-vue'

// 获取API域名
const DEFAULT_ADMIN_AVATAR = 'https://lh3.googleusercontent.com/aida-public/AB6AXuDjlwOlzc23T2bj6EUmlx2AkEAQqItGaRRXbTZNKA9uZtUWNLACpgTrMyCTqQbBxVgnAbjSGch7y7up5-T7Xm7dfwOQFwV9fokxxCTSC_Q1_KfdPFnpUg2cXuyCANDhpGLDIhvEC6y5hAuosFC5R4U4NPiqRiH6iVeYdWASI_lTeVcufcmzVBuuuf-Gm3UkZyDW8gzrB2R_dxs0WYHYSDkbZlv5k6cAer0sHeV3n5A2dSKy4zNYUmz1hitr0fhydNn8pYcg2yAEZPA'
const apiDomain = import.meta.env.VITE_TCB_BASE_URL || ''
const YES_NO_VALUE = {
  YES: 'yes',
  NO: 'no'
}
const LEGACY_YES_NO_VALUE = {
  YES: '\u662f',
  NO: '\u5426'
}

const normalizeYesNo = (value, defaultValue = YES_NO_VALUE.NO) => {
  if (value === YES_NO_VALUE.YES || value === LEGACY_YES_NO_VALUE.YES || value === true) return YES_NO_VALUE.YES
  if (value === YES_NO_VALUE.NO || value === LEGACY_YES_NO_VALUE.NO || value === false) return YES_NO_VALUE.NO
  return defaultValue
}

const isCostSettled = (value) => {
  return value === true || value === YES_NO_VALUE.YES || value === LEGACY_YES_NO_VALUE.YES
}

// 是否正在加载项目数据（用于屏蔽某些监听器的自动触发）
const isLoadingProject = ref(false)

// 基础项目信息折叠状�?
const avatarInputRef = ref(null)
const currentUser = reactive({
  id: '',
  username: '',
  nickname: '',
  role: '',
  roleName: '',
  employeeNo: '',
  avatarUrl: '',
  avatarFileId: '',
  lastLoginTime: null
})
const userDialog = reactive({
  visible: false,
  submitting: false,
  uploading: false,
  form: {
    username: '',
    nickname: '',
    avatarUrl: '',
    avatarFileId: ''
  }
})

const currentUserRoleText = computed(() => {
  return currentUser.roleName || currentUser.role || '系统管理员'
})

const isSuperAdmin = computed(() => currentUser.role === 'ADMIN_SUPER')

const formatLastLogin = (value) => {
  if (!value) return '-'
  const date = value.$date ? new Date(value.$date) : new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', { hour12: false })
}

const applyUserInfo = (user) => {
  if (!user) return
  Object.assign(currentUser, {
    id: user.id || '',
    username: user.username || '',
    nickname: user.nickname || user.username || '',
    role: user.role || 'user',
    roleName: user.roleName || user.role || '系统管理员',
    employeeNo: user.employeeNo || '',
    avatarUrl: user.avatarUrl || '',
    avatarFileId: user.avatarFileId || '',
    lastLoginTime: user.lastLoginTime || null
  })
  localStorage.setItem('userInfo', JSON.stringify({ ...currentUser }))
}

const loadCurrentUser = async () => {
  const cachedUser = localStorage.getItem('userInfo')
  if (cachedUser) {
    try {
      applyUserInfo(JSON.parse(cachedUser))
    } catch (error) {
      console.warn('解析本地用户信息失败:', error)
    }
  }

  try {
    const res = await getInfo()
    if (res.code === 0 && res.data) {
      applyUserInfo(res.data)
    }
  } catch (error) {
    console.warn('获取用户信息失败:', error.message || error)
  }
}

const openUserDialog = () => {
  Object.assign(userDialog.form, {
    username: currentUser.username,
    nickname: currentUser.nickname,
    avatarUrl: currentUser.avatarUrl,
    avatarFileId: currentUser.avatarFileId
  })
  userDialog.visible = true
}

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = reject
  reader.readAsDataURL(file)
})

const compressAvatarFile = (file) => new Promise((resolve, reject) => {
  new Compressor(file, {
    quality: 0.72,
    maxWidth: 512,
    maxHeight: 512,
    mimeType: 'image/jpeg',
    convertSize: 0,
    success: resolve,
    error: reject
  })
})

const handleAvatarChange = async (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.warning('头像仅支�?JPG、PNG、WebP')
    })
    event.target.value = ''
    return
  }
  if (file.size > 8 * 1024 * 1024) {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.warning('头像原图大小不能超过 8MB')
    })
    event.target.value = ''
    return
  }

  userDialog.uploading = true
  try {
    const compressedFile = await compressAvatarFile(file)
    if (compressedFile.size > 600 * 1024) {
      throw new Error('头像压缩后仍过大，请选择更小的图片')
    }
    const fileData = await readFileAsDataUrl(compressedFile)
    const res = await uploadAvatar({
      file: fileData,
      fileName: 'avatar.jpg',
      fileType: compressedFile.type || 'image/jpeg'
    })
    if (res.code !== 0) {
      throw new Error(res.message || '头像上传失败')
    }
    userDialog.form.avatarUrl = res.data.avatarUrl
    userDialog.form.avatarFileId = res.data.avatarFileId
  } catch (error) {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.error(error.message || '头像上传失败')
    })
  } finally {
    userDialog.uploading = false
    event.target.value = ''
  }
}

const handleUpdateUser = async () => {
  if (!userDialog.form.nickname.trim()) {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.warning('请填写用户昵称')
    })
    return
  }

  userDialog.submitting = true
  try {
    const res = await updateInfo({
      nickname: userDialog.form.nickname.trim(),
      avatarUrl: userDialog.form.avatarUrl,
      avatarFileId: userDialog.form.avatarFileId
    })
    if (res.code !== 0) {
      throw new Error(res.message || '保存失败')
    }
    applyUserInfo(res.data)
    userDialog.visible = false
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.success('用户信息已更新')
    })
  } catch (error) {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.error(error.message || '保存失败')
    })
  } finally {
    userDialog.submitting = false
  }
}

const isBasicInfoCollapsed = ref(false)

// 成本支出管理折叠状�?
const isCostInfoCollapsed = ref(false)

// 合同管理折叠状�?
const isContractInfoCollapsed = ref(false)

// 预览图管理折叠状�?
const isPreviewInfoCollapsed = ref(false)

// 悬浮回到顶部按钮逻辑
const floatBtnPos = ref({ x: window.innerWidth - 80, y: window.innerHeight - 80 })
const isDragging = ref(false)
const dragOffset = ref({ x: 0, y: 0 })
const hasMoved = ref(false)

const startDrag = (e) => {
  isDragging.value = true
  hasMoved.value = false
  dragOffset.value = {
    x: e.clientX - floatBtnPos.value.x,
    y: e.clientY - floatBtnPos.value.y
  }
  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', stopDrag)
}

const onDrag = (e) => {
  if (!isDragging.value) return
  hasMoved.value = true
  floatBtnPos.value = {
    x: e.clientX - dragOffset.value.x,
    y: e.clientY - dragOffset.value.y
  }
}

const stopDrag = () => {
  isDragging.value = false
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
  
  // 边界检�?
  const margin = 20
  const btnSize = 48
  floatBtnPos.value.x = Math.max(margin, Math.min(window.innerWidth - btnSize - margin, floatBtnPos.value.x))
  floatBtnPos.value.y = Math.max(margin, Math.min(window.innerHeight - btnSize - margin, floatBtnPos.value.y))
}

const scrollToTop = () => {
  if (hasMoved.value) return // 如果是拖拽则不触发点�?
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

// 监听窗口大小变化，防止按钮跑出屏�?
const handleResize = () => {
  const margin = 20
  const btnSize = 48
  floatBtnPos.value.x = Math.min(floatBtnPos.value.x, window.innerWidth - btnSize - margin)
  floatBtnPos.value.y = Math.min(floatBtnPos.value.y, window.innerHeight - btnSize - margin)
}

onMounted(() => {
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})

const router = useRouter()
const DEFAULT_SESSION_TIMEOUT_MINUTES = 30
const MIN_SESSION_TIMEOUT_MINUTES = 1
const sessionTimeoutMinutes = ref(DEFAULT_SESSION_TIMEOUT_MINUTES)
let sessionLogoutTimer = null
const sessionActivityEvents = ['click', 'keydown', 'mousemove', 'scroll', 'touchstart']

// 侧边栏菜单配�?
const activeMenu = ref('dashboard')
const menuItems = ref([
  { name: 'dashboard', label: '数据总览', icon: markRaw(DataBoard), active: true },
  { name: 'projects', label: '项目管理', icon: markRaw(Management), active: false },
  { name: 'clients', label: '客户管理', icon: markRaw(User), active: false },
    { name: 'suppliers', label: '供应商管理', icon: markRaw(Briefcase), active: false },
  { name: 'materials', label: '材料管理', icon: markRaw(Box), active: false },
  { name: 'settings', label: '系统设置', icon: markRaw(Setting), active: false },
])

/**
 * 切换侧边栏菜�? * @param {string} menuName 菜单名称
 * @returns {void}
 * @throws {Error} �? */
menuItems.value.splice(2, 0, { name: 'logs', label: '操作日志', icon: markRaw(View), active: false })

const handleMenuClick = (menuName) => {
  if (menuName === 'dashboard' && !hasPermission('VIEW_DASHBOARD')) {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.warning('暂无查看数据总览权限')
    })
    return
  }
  if (menuName === 'logs' && !hasPermission('VIEW_OPERATION_LOGS')) {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.warning('暂无查看操作记录日志权限')
    })
    return
  }
  if (!['dashboard', 'projects', 'logs', 'settings'].includes(menuName)) {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.info('功能待开发，敬请期待')
    })
    return
  }
  activeMenu.value = menuName;
  menuItems.value = menuItems.value.map(item => ({
    ...item,
    active: item.name === menuName
  }));
}

const getSessionTimeoutFromConfigs = (configs) => {
  const systemSettings = Array.isArray(configs?.SYSTEM_SETTING) ? configs.SYSTEM_SETTING : []
  const timeoutConfig = systemSettings.find(item => item.label === 'SESSION_TIMEOUT_MINUTES')
  const timeoutValue = Number(timeoutConfig?.value)
  return Number.isFinite(timeoutValue) && timeoutValue >= MIN_SESSION_TIMEOUT_MINUTES
    ? timeoutValue
    : DEFAULT_SESSION_TIMEOUT_MINUTES
}

const applySessionTimeoutConfig = (configs) => {
  sessionTimeoutMinutes.value = getSessionTimeoutFromConfigs(configs)
  resetSessionLogoutTimer()
}

const stopSessionActivityWatcher = () => {
  if (sessionLogoutTimer) {
    window.clearTimeout(sessionLogoutTimer)
    sessionLogoutTimer = null
  }
  sessionActivityEvents.forEach(eventName => {
    window.removeEventListener(eventName, resetSessionLogoutTimer)
  })
}

const resetSessionLogoutTimer = () => {
  if (sessionLogoutTimer) {
    window.clearTimeout(sessionLogoutTimer)
  }
  sessionLogoutTimer = window.setTimeout(() => {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.warning('登录已超时，请重新登录')
    })
    handleLogout()
  }, sessionTimeoutMinutes.value * 60 * 1000)
}

const startSessionActivityWatcher = () => {
  stopSessionActivityWatcher()
  sessionActivityEvents.forEach(eventName => {
    window.addEventListener(eventName, resetSessionLogoutTimer, { passive: true })
  })
  resetSessionLogoutTimer()
}

// 系统设置页面角色列表
const settingRoles = [
  { label: '超级系统管理员', value: 'ADMIN_SUPER' },
  { label: '系统管理员', value: 'ADMIN' },
  { label: '项目经理', value: 'PROJECT_MANAGER' },
  { label: '财务主管', value: 'FINANCE_MANAGER' },
  { label: '普通访客', value: 'VISITOR' }
]

// 系统设置页面权限矩阵
const PERMISSION_STORAGE_KEY = 'admin-role-permissions'

const settingPermissions = reactive([
  { key: 'DELETE_PROJECT', name: '删除项目', enabledRoles: ['ADMIN_SUPER'] },
  { key: 'VIEW_DASHBOARD', name: '查看数据总览', enabledRoles: ['ADMIN_SUPER', 'ADMIN', 'PROJECT_MANAGER', 'FINANCE_MANAGER', 'VISITOR'] },
  { key: 'VIEW_OPERATION_LOGS', name: '查看操作记录日志', enabledRoles: ['ADMIN_SUPER'] }
])

/**
 * 功能：切换角色权�? * @param {Object} permission 权限�? * @param {string} roleValue 角色标识
 * @returns {void}
 * @throws {Error} �? */
const togglePermissionRole = (permission, roleValue) => {
  const roleIndex = permission.enabledRoles.indexOf(roleValue)
  if (roleIndex > -1) {
    permission.enabledRoles.splice(roleIndex, 1)
  } else {
    permission.enabledRoles.push(roleValue)
  }
  saveSettingPermissions()
}

/**
 * 功能：读取本地保存的权限矩阵
 * @returns {void}
 * @throws {Error} 读取失败时保留默认权限矩�? */
const loadSettingPermissions = () => {
  try {
    const savedPermissions = localStorage.getItem(PERMISSION_STORAGE_KEY)
    if (!savedPermissions) return
    const permissionMap = JSON.parse(savedPermissions)
    settingPermissions.forEach(permission => {
      if (Array.isArray(permissionMap[permission.key])) {
        permission.enabledRoles = permissionMap[permission.key]
      }
    })
  } catch (error) {
    console.error('读取权限矩阵失败', error)
  }
}

/**
 * 功能：保存权限矩阵到本地
 * @returns {void}
 * @throws {Error} 保存失败时输出错误日�? */
const saveSettingPermissions = () => {
  try {
    const permissionMap = settingPermissions.reduce((map, permission) => {
      map[permission.key] = permission.enabledRoles
      return map
    }, {})
    localStorage.setItem(PERMISSION_STORAGE_KEY, JSON.stringify(permissionMap))
  } catch (error) {
    console.error('保存权限矩阵失败', error)
  }
}

loadSettingPermissions()

const hasPermission = (permissionKey) => {
  const permission = settingPermissions.find(item => item.key === permissionKey)
  if (!permission) return false
  return permission.enabledRoles.includes(currentUser.role)
}

const visibleMenuItems = computed(() => {
  return menuItems.value.filter(item => {
    if (item.name === 'dashboard') return hasPermission('VIEW_DASHBOARD')
    if (item.name === 'logs') return hasPermission('VIEW_OPERATION_LOGS')
    return true
  })
})

// 系统设置页面数据配置卡片
const settingConfigCards = [
  {
    title: '客户来源',
    description: '管理商机流量渠道入口标签',
    icon: 'hub',
    iconColor: 'text-emerald-400',
    iconHover: 'group-hover:bg-primary/20',
    hoverBorder: 'hover:border-primary',
    tags: ['老客户推荐', '官网咨询', '行业展会']
  },
  {
    title: '成本项目',
    description: '定义项目物料与劳务成本科目',
    icon: 'payments',
    iconColor: 'text-secondary',
    iconHover: 'group-hover:bg-secondary/20',
    hoverBorder: 'hover:border-secondary',
    tags: ['真植物', '仿真植物', '石材/铺装']
  },
  {
    title: '客户角色',
    description: '配置甲方组织架构对应身份',
    icon: 'groups',
    iconColor: 'text-emerald-400',
    iconHover: 'group-hover:bg-emerald-400/20',
    hoverBorder: 'hover:border-emerald-400',
    tags: ['甲方老板', '项目负责人', '采购代理', '设计代表']
  },
  {
    title: '项目场景',
    description: '维护项目基础信息中的场景选项',
    icon: 'scene',
    iconColor: 'text-cyan-400',
    iconHover: 'group-hover:bg-cyan-400/20',
    hoverBorder: 'hover:border-cyan-400',
    tags: ['公司布景', '门店造景', '私人住宅', '机关单位']
  }
]

// 项目状态列表（由接口获取）
const configDialog = reactive({
  visible: false,
  title: '',
  group: '',
  submitting: false,
  form: {
    label: '',
    description: ''
  }
})
const updatingConfigKey = ref('')
const settingConfigItems = reactive({
  CLIENT_SOURCE: [],
  COST_CATEGORY: [],
  CLIENT_ROLE: [],
  PROJECT_SCENE: []
})

const configGroupMap = {
  '客户来源': 'CLIENT_SOURCE',
  '成本项目': 'COST_CATEGORY',
  '客户角色': 'CLIENT_ROLE',
  '项目场景': 'PROJECT_SCENE'
}

/**
 * 获取系统设置卡片配置�? * @param {Object} card 配置卡片
 * @returns {Array} 配置项列�? * @throws {Error} �? */
const getSettingConfigItems = (card) => {
  const group = configGroupMap[card.title]
  return settingConfigItems[group] || []
}

/**
 * 获取系统设置配置状态列�? * @returns {Promise<void>} �? * @throws {Error} 查询异常时向上抛�? */
const loadSettingConfigItems = async () => {
  const groups = ['CLIENT_SOURCE', 'COST_CATEGORY', 'CLIENT_ROLE', 'PROJECT_SCENE']
  const responses = await Promise.all(groups.map(group => queryConfig({
    group,
    isActive: 'all'
  })))

  responses.forEach((res, index) => {
    const group = groups[index]
    if (res.code !== 0) {
      throw new Error(res.message || '配置查询失败')
    }
    settingConfigItems[group] = Array.isArray(res.data)
      ? res.data.filter(item => item.group === group)
        .map(item => ({
          ...item,
          id: item.id || item._id
        }))
      : []
  })
}

const configValuePreview = computed(() => {
  return configDialog.form.label.trim() ? '创建时自动翻译生成' : ''
})

/**
 * 打开新增配置弹窗
 * @param {Object} card 配置卡片
 * @returns {void}
 * @throws {Error} �? */
const openConfigDialog = (card) => {
  const group = configGroupMap[card.title]
  if (!group) return
  configDialog.title = card.title
  configDialog.group = group
  configDialog.form.label = ''
  configDialog.form.description = ''
  configDialog.visible = true
}

/**
 * 创建系统配置
 * @returns {Promise<void>} �? * @throws {Error} 接口异常时提示错�? */
const handleCreateConfig = async () => {
  const label = configDialog.form.label.trim()
  if (!label) {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.warning('请填写配置中文名')
    })
    return
  }

  configDialog.submitting = true
  try {
    const res = await createConfig({
      group: configDialog.group,
      label,
      description: configDialog.form.description.trim()
    })
    if (res.code !== 0) {
      throw new Error(res.message || '创建失败')
    }

    localStorage.removeItem('APP_GLOBAL_CONFIGS')
    localStorage.removeItem('APP_CONFIG_TIMESTAMP')
    await initGlobalConfigs(true)
    configDialog.visible = false
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.success('配置创建成功')
    })
  } catch (error) {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.error(error.message || '创建失败，请稍后再试')
    })
  } finally {
    configDialog.submitting = false
  }
}

/**
 * 切换系统配置启用状�? * @param {Object} card 配置卡片
 * @param {Object} tag 配置�? * @returns {Promise<void>} �? * @throws {Error} 接口异常时提示错�? */
const handleToggleConfigStatus = async (card, tag) => {
  const group = configGroupMap[card.title]
  const configId = tag?.id || tag?._id
  if (!group || !configId || updatingConfigKey.value) return

  const nextActive = tag.isActive === false
  const actionText = nextActive ? '启用' : '停用'

  try {
    const { ElMessageBox, ElMessage } = await import('element-plus')
    await ElMessageBox.confirm(
      nextActive
        ? `确定要启用�?{tag.label}”吗？启用后会重新出现在新增项目的下拉配置中。`
        : `确定要停用�?{tag.label}”吗？停用后不会再出现在新增项目的下拉配置中，历史数据不受影响。`,
      `${actionText}配置`,
      {
        confirmButtonText: `确定${actionText}`,
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: nextActive ? '!bg-primary !border-primary !text-black' : '!bg-amber-500 !border-amber-500 !text-black',
        cancelButtonClass: '!bg-neutral-800 !border-white/10 !text-white/60 hover:!text-white',
        customClass: 'custom-message-box',
        center: true
      }
    )

    updatingConfigKey.value = configId
    const res = await updateConfigStatus({
      id: configId,
      group,
      isActive: nextActive
    })
    if (res.code !== 0) {
      throw new Error(res.message || '状态更新失败')
    }

    localStorage.removeItem('APP_GLOBAL_CONFIGS')
    localStorage.removeItem('APP_CONFIG_TIMESTAMP')
    await initGlobalConfigs(true)
    ElMessage.success(`配置�?{actionText}`)
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      const { ElMessage } = await import('element-plus')
      ElMessage.error(error.message || '状态更新失败，请稍后再试')
    }
  } finally {
    updatingConfigKey.value = ''
  }
}

const projectStatuses = ref([])

// 获取状态的排序�?
const getStatusOrder = (statusValue) => {
  const status = projectStatuses.value.find(s => s.value === statusValue)
  return status ? status.sortOrder : 0
}

// 仅长期项目允许状态回溯，其他项目类型不允许
const canRollbackStatus = (project) => project?.type === 'long_term'

// 获取原始项目状态（用于编辑模式下的状态回溯保护）
const originalProjectStatus = computed(() => {
  if (selectedProjectId.value) {
    const project = projects.value.find(p => p.id === selectedProjectId.value)
    return project ? project.status : null
  }
  return null
})
const isViewMode = ref(false)
// 是否为编辑模式（针对已存在的项目�?
const isEditMode = ref(false)
// 当前选中的项目ID
const selectedProjectId = ref(null)
// 临时项目ID，用于新建项目时关联文件
const currentTempId = ref(`TEMP_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`)
// 是否正在新建项目
const isCreating = computed(() => !selectedProjectId.value && !isViewMode.value && !isEditMode.value)
// 禁用未来日期：补录单据的结束时间不能晚于当前日期
const disabledFutureDate = (time) => {
  return time.getTime() > Date.now()
}

// 补录单据：项目周期禁用规�?
const disabledHistoricalProjectDate = (time) => {
  return time.getTime() > Date.now()
}

// 补录单据：施工周期禁用规�?
const disabledHistoricalConstructionDate = (time) => {
  if (time.getTime() > Date.now()) return true
  if (form.period && form.period.length === 2) {
    const pStart = new Date(form.period[0]).setHours(0,0,0,0)
    const pEnd = new Date(form.period[1]).setHours(23,59,59,999)
    if (time.getTime() < pStart || time.getTime() > pEnd) {
      return true
    }
  }
  return false
}

// 补录单据：回款周期禁用规�?
const disabledHistoricalCollectionDate = (time) => {
  if (time.getTime() > Date.now()) return true
  if (form.constructionPeriod && form.constructionPeriod.length === 2) {
    const cEnd = new Date(form.constructionPeriod[1]).setHours(0,0,0,0)
    if (time.getTime() < cEnd) {
      return true
    }
  }
  return false
}

// 补录单据周期是否禁用
const isHistoricalPeriodDisabled = computed(() => {
  if (isViewMode.value) return true
  if (!form.isHistorical) return true
  if (isEditMode.value && form.isHistorical && originalProjectStatus.value === 'settling' && form.status === 'closed') {
    return true
  }
  return false
})

// 记录编辑前的项目名称，用于同步修改云存储路径
const originalProjectName = ref('')

// 项目列表数据
const projects = ref([])
const loadingProjects = ref(false)
const dashboardHoveredScene = ref('')
const dashboardSceneTooltip = ref({
  visible: false,
  x: 0,
  y: 0
})
const dashboardHoveredProfitPoint = ref(null)
const dashboardHoveredBar = ref(null)

const dashboardRange = ref('year')
const dashboardRanges = [
  { label: '年度', value: 'year', months: 12 },
  { label: '半年', value: 'half', months: 6 },
  { label: '季度', value: 'quarter', months: 3 },
  { label: '月度', value: 'month', months: 1 }
]

const dashboardMoney = (amount) => {
  const value = Number(amount) || 0
  return `${(value / 10000).toFixed(1)}万元`
}

const toDate = (value) => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const getProjectDashboardDate = (project) => {
  if (project.type === 'historical') {
    return toDate(project.completedTime)
      || toDate(project.completionTime)
      || toDate(project.constructionPeriod?.[1])
      || toDate(project.period?.[1])
  }
  return toDate(project.period?.[0])
    || toDate(project.startDate)
    || toDate(project.negotiatingTime)
    || toDate(project.createTime)
}

const getDashboardRangeStart = () => {
  const range = dashboardRanges.find(item => item.value === dashboardRange.value) || dashboardRanges[0]
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setMonth(start.getMonth() - range.months)
  return start
}

const getDashboardRangeEnd = () => {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  return end
}

const filteredDashboardProjects = computed(() => {
  const start = getDashboardRangeStart().getTime()
  const end = getDashboardRangeEnd().getTime()
  return projects.value.filter(item => {
    const projectDate = getProjectDashboardDate(item)
    if (!projectDate) return false
    const time = projectDate.getTime()
    return time >= start && time <= end
  })
})

const getDashboardProjectAmount = (project) => Number(project.amount) || Number(project.totalAmount) || 0

const getDashboardProjectCost = (project) => {
  if (Number(project.payableAmount)) return Number(project.payableAmount)
  const projectCost = Array.isArray(project.costs)
    ? project.costs.reduce((sum, cost) => sum + (Number(cost.amount) || 0), 0)
    : 0
  const subProjectCost = Array.isArray(project.subProjects)
    ? project.subProjects.reduce((sum, subProject) => {
      const costs = Array.isArray(subProject.costs) ? subProject.costs : []
      return sum + costs.reduce((costSum, cost) => costSum + (Number(cost.amount) || 0), 0)
    }, 0)
    : 0
  return projectCost + subProjectCost
}

const createDashboardBuckets = () => {
  const range = dashboardRanges.find(item => item.value === dashboardRange.value) || dashboardRanges[0]
  const start = getDashboardRangeStart()
  const end = getDashboardRangeEnd()
  const bucketCount = range.value === 'month' ? 4 : (range.value === 'year' ? 4 : range.months)
  const bucketSize = (end.getTime() - start.getTime()) / bucketCount

  return Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = new Date(start.getTime() + bucketSize * index)
    const bucketEnd = new Date(index === bucketCount - 1 ? end.getTime() : start.getTime() + bucketSize * (index + 1) - 1)
    const label = range.value === 'month'
      ? `�?{index + 1}周`
      : `${bucketStart.getMonth() + 1}月`
    return {
      label,
      start: bucketStart.getTime(),
      end: bucketEnd.getTime()
    }
  })
}

const dashboardMetrics = computed(() => {
  const currentProjects = filteredDashboardProjects.value
  const totalAmount = currentProjects.reduce((sum, item) => sum + getDashboardProjectAmount(item), 0)
  const receivedAmount = currentProjects.reduce((sum, item) => sum + (Number(item.receivedAmount) || 0), 0)
  const unpaidAmount = Math.max(0, totalAmount - receivedAmount)
  const totalCost = currentProjects.reduce((sum, item) => sum + getDashboardProjectCost(item), 0)
  const profit = totalAmount - totalCost
  const profitRate = totalAmount ? (profit / totalAmount) * 100 : 0
  const costRate = totalAmount ? (totalCost / totalAmount) * 100 : 0

  return {
    orderCount: currentProjects.length,
    totalAmount,
    receivedAmount,
    unpaidAmount,
    totalCost,
    profit,
    profitRate,
    costRate
  }
})

const dashboardKpis = computed(() => {
  const metrics = dashboardMetrics.value
  return [
    { label: '订单数量', value: metrics.orderCount.toLocaleString(), unit: '单', icon: 'shopping_cart', iconClass: 'text-primary bg-primary/10', trend: '+12% 同比', trendClass: 'text-primary' },
    { label: '订单总金额', value: dashboardMoney(metrics.totalAmount), icon: 'payments', iconClass: 'text-secondary bg-secondary/10', trend: '+8.4% 同比', trendClass: 'text-secondary' },
    { label: '应收账款', value: dashboardMoney(metrics.receivedAmount), icon: 'account_balance_wallet', iconClass: 'text-emerald-300 bg-emerald-300/10', trend: '稳定', trendClass: 'text-neutral-500' },
    { label: '未收账款', value: dashboardMoney(metrics.unpaidAmount), icon: 'warning', iconClass: 'text-red-300 bg-red-300/10', valueClass: 'text-red-300', trend: '+2.1% 同比', trendClass: 'text-red-300', cardClass: 'border-red-300/20' },
    { label: '总成本', value: dashboardMoney(metrics.totalCost), icon: 'inventory', iconClass: 'text-on-surface-variant bg-on-surface-variant/10' },
    { label: '总利润', value: dashboardMoney(metrics.profit), icon: 'trending_up', iconClass: 'text-primary bg-primary/20', valueClass: 'text-primary', trend: '+15.2% 同比', trendClass: 'text-primary', cardClass: 'bg-primary/5' },
    { label: '总利润率', value: `${metrics.profitRate.toFixed(1)}%`, icon: 'percent', iconClass: 'text-secondary bg-secondary/10' },
    { label: '总成本率', value: `${metrics.costRate.toFixed(1)}%`, icon: 'calculate', iconClass: 'text-on-surface-variant bg-on-surface-variant/10' }
  ]
})

const dashboardQuarterBars = computed(() => {
  const buckets = createDashboardBuckets().map(bucket => {
    let orderCount = 0
    const amount = filteredDashboardProjects.value.reduce((sum, project) => {
      const projectDate = getProjectDashboardDate(project)
      if (!projectDate) return sum
      const time = projectDate.getTime()
      if (time < bucket.start || time > bucket.end) return sum
      orderCount += 1
      return sum + getDashboardProjectAmount(project)
    }, 0)
    return { ...bucket, amount, orderCount }
  })
  const maxAmount = Math.max(...buckets.map(item => item.amount), 1)

  return buckets.map((bucket, index) => {
    const height = bucket.amount ? Math.max(70, 220 * bucket.amount / maxAmount) : 24
    return {
      label: index === buckets.length - 1 ? `${bucket.label}（当前）` : bucket.label,
      height,
      amountText: dashboardMoney(bucket.amount),
      orderCount: bucket.orderCount,
      active: index === buckets.length - 1
    }
  })
})

const dashboardSceneSegments = computed(() => {
  const colors = ['#52ee8a', '#00daf3', '#ffb400', '#a56eff']
  const shadows = ['rgba(82,238,138,0.8)', 'rgba(0,218,243,0.8)', 'rgba(255,180,0,0.8)', 'rgba(165,110,255,0.8)']
  const sceneMap = new Map()
  filteredDashboardProjects.value.forEach(item => {
    const label = item.sceneLabel || projectScenes.value.find(scene => scene.value === item.scene)?.label || '未分类'
    const sceneData = sceneMap.get(label) || { amount: 0, orderCount: 0 }
    sceneMap.set(label, {
      amount: sceneData.amount + getDashboardProjectAmount(item),
      orderCount: sceneData.orderCount + 1
    })
  })

  const entries = sceneMap.size
    ? Array.from(sceneMap.entries())
    : defaultProjectScenes.map(item => [item.label, { amount: 0, orderCount: 0 }])
  const total = entries.reduce((sum, item) => sum + item[1].amount, 0) || entries.length || 1
  let offset = 0

  return entries.slice(0, 4).map(([label, sceneData], index) => {
    const amount = sceneData.amount
    const percent = total ? Math.round((amount || (total / entries.length)) / total * 100) : 0
    const length = 263.8 * percent / 100
    const segment = {
      label,
      percent,
      amount,
      amountText: dashboardMoney(amount),
      orderCount: sceneData.orderCount,
      length: Math.max(4, length).toFixed(1),
      offset: -offset,
      color: colors[index % colors.length],
      shadow: shadows[index % shadows.length]
    }
    offset += length
    return segment
  })
})

const dashboardActiveScene = computed(() => {
  return dashboardSceneSegments.value.find(item => item.label === dashboardHoveredScene.value)
    || null
})

// 更新订单金额分布饼图悬浮提示位置
const updateDashboardSceneTooltip = (event) => {
  const chartElement = event.currentTarget.closest('.dashboard-scene-chart')
  if (!chartElement) return
  const rect = chartElement.getBoundingClientRect()
  dashboardSceneTooltip.value = {
    visible: true,
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  }
}

// 鼠标进入订单金额分布饼图分段
const handleDashboardSceneEnter = (event, segment) => {
  dashboardHoveredScene.value = segment.label
  updateDashboardSceneTooltip(event)
}

// 鼠标在订单金额分布饼图分段内移动
const handleDashboardSceneMove = (event) => {
  updateDashboardSceneTooltip(event)
}

// 鼠标离开订单金额分布饼图分段
const handleDashboardSceneLeave = () => {
  dashboardHoveredScene.value = ''
  dashboardSceneTooltip.value.visible = false
}

const dashboardProfitPoints = computed(() => {
  const buckets = createDashboardBuckets().map(bucket => {
    let orderCount = 0
    const profit = filteredDashboardProjects.value.reduce((sum, project) => {
      const projectDate = getProjectDashboardDate(project)
      if (!projectDate) return sum
      const time = projectDate.getTime()
      if (time < bucket.start || time > bucket.end) return sum
      orderCount += 1
      return sum + getDashboardProjectAmount(project) - getDashboardProjectCost(project)
    }, 0)
    return { ...bucket, profit, orderCount }
  })
  const values = buckets.map(item => item.profit)
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 1)
  const range = max - min || 1
  const xPadding = 3
  const xStep = buckets.length > 1 ? (100 - xPadding * 2) / (buckets.length - 1) : 100

  return buckets.map((bucket, index) => {
    const x = buckets.length === 1 ? 50 : xPadding + index * xStep
    const y = 86 - ((bucket.profit - min) / range) * 72
    return {
      ...bucket,
      x,
      y,
      amountText: dashboardMoney(bucket.profit)
    }
  })
})

const dashboardProfitLinePath = computed(() => {
  if (!dashboardProfitPoints.value.length) return ''
  return dashboardProfitPoints.value
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ')
})

const dashboardProfitAreaPath = computed(() => {
  if (!dashboardProfitPoints.value.length) return ''
  const first = dashboardProfitPoints.value[0]
  const last = dashboardProfitPoints.value[dashboardProfitPoints.value.length - 1]
  return `${dashboardProfitLinePath.value} L ${last.x} 100 L ${first.x} 100 Z`
})

const dashboardProfitLabels = computed(() => {
  return dashboardProfitPoints.value.map(point => point.label)
})

const dashboardTopOrders = computed(() => {
  return [...filteredDashboardProjects.value]
    .sort((a, b) => getDashboardProjectAmount(b) - getDashboardProjectAmount(a))
    .slice(0, 4)
    .map(item => ({
      id: item.id || item._id || item.name,
      name: item.name || '-',
      client: item.client || '-',
      date: getProjectDashboardDate(item)?.toISOString().split('T')[0] || '-',
      amountText: dashboardMoney(getDashboardProjectAmount(item)),
      statusLabel: item.statusLabel || projectStatuses.value.find(status => status.value === item.status)?.label || item.status || '-',
      statusClass: ['completed', 'closed'].includes(item.status) ? 'bg-secondary/10 text-secondary' : 'bg-primary/10 text-primary'
    }))
})

const operationLogPageSize = 5
const operationLogPage = ref(1)
const operationLogFilters = reactive({
  user: '',
  module: '',
  startDate: '',
  endDate: ''
})
const operationLogs = ref([
  {
    id: 'LOG-001',
    date: '2026-04-16',
    time: '14:22:05',
    user: '系统管理员',
    initials: '系',
    avatarClass: 'bg-primary/20 text-primary',
    module: '项目管理',
    content: '删除项目“西湖隐秀园林景观设计”',
    status: '成功'
  },
  {
    id: 'LOG-002',
    date: '2026-04-16',
    time: '11:05:48',
    user: '项目经理',
    initials: '项',
    avatarClass: 'bg-secondary/20 text-secondary',
    module: '数据总览',
    content: '查看经营数据总览',
    status: '成功'
  },
  {
    id: 'LOG-003',
    date: '2026-04-15',
    time: '16:45:12',
    user: '普通访客',
    initials: '访',
    avatarClass: 'bg-red-500/20 text-red-300',
    module: '系统权限设置',
    content: '尝试访问未授权的操作日志页面',
    status: '失败'
  },
  {
    id: 'LOG-004',
    date: '2026-04-15',
    time: '09:12:33',
    user: '财务主管',
    initials: '财',
    avatarClass: 'bg-amber-500/20 text-amber-300',
    module: '成本项目',
    content: '调整仿真植物材料成本配置',
    status: '警告'
  },
  {
    id: 'LOG-005',
    date: '2026-04-14',
    time: '18:01:55',
    user: '系统管理员',
    initials: '系',
    avatarClass: 'bg-primary/20 text-primary',
    module: '系统配置',
    content: '停用客户来源配置“老客户推荐”',
    status: '成功'
  },
  {
    id: 'LOG-006',
    date: '2026-04-14',
    time: '10:36:21',
    user: '超级系统管理员',
    initials: '超',
    avatarClass: 'bg-emerald-500/20 text-emerald-300',
    module: '系统权限设置',
    content: '为系统管理员配置“查看操作记录日志”权限',
    status: '成功'
  }
])

const operationLogUsers = computed(() => {
  return [...new Set(operationLogs.value.map(item => item.user))]
})

const operationLogModules = computed(() => {
  return [...new Set(operationLogs.value.map(item => item.module))]
})

const filteredOperationLogs = computed(() => {
  return operationLogs.value.filter(item => {
    const matchUser = !operationLogFilters.user || item.user === operationLogFilters.user
    const matchModule = !operationLogFilters.module || item.module === operationLogFilters.module
    const matchStartDate = !operationLogFilters.startDate || item.date >= operationLogFilters.startDate
    const matchEndDate = !operationLogFilters.endDate || item.date <= operationLogFilters.endDate
    return matchUser && matchModule && matchStartDate && matchEndDate
  })
})

const operationLogTotalPages = computed(() => {
  return Math.max(1, Math.ceil(filteredOperationLogs.value.length / operationLogPageSize))
})

const pagedOperationLogs = computed(() => {
  const startIndex = (operationLogPage.value - 1) * operationLogPageSize
  return filteredOperationLogs.value.slice(startIndex, startIndex + operationLogPageSize)
})

const operationLogPageStart = computed(() => {
  if (!filteredOperationLogs.value.length) return 0
  return (operationLogPage.value - 1) * operationLogPageSize + 1
})

const operationLogPageEnd = computed(() => {
  return Math.min(operationLogPage.value * operationLogPageSize, filteredOperationLogs.value.length)
})

const operationLogStats = computed(() => {
  const failedCount = operationLogs.value.filter(item => item.status === '失败').length
  const warningCount = operationLogs.value.filter(item => item.status === '警告').length
  return [
    { label: '今日操作总数', value: operationLogs.value.filter(item => item.date === '2026-04-16').length, trend: '12%', icon: 'trending_up', colorClass: 'text-primary' },
    { label: '异常状态警告', value: failedCount + warningCount, trend: '关键', icon: 'priority_high', colorClass: 'text-red-300' },
    { label: '最活跃模块', value: '项目管理', trend: '高频', icon: 'analytics', colorClass: 'text-secondary' }
  ]
})

/**
 * 功能：返回日志状态文字样�? * @param {string} status 状�? * @returns {string} 样式类名
 * @throws {Error} �? */
const operationLogStatusClass = (status) => {
  if (status === '失败') return 'text-red-300'
  if (status === '警告') return 'text-secondary'
  return 'text-primary'
}

/**
 * 功能：返回日志状态圆点样�? * @param {string} status 状�? * @returns {string} 样式类名
 * @throws {Error} �? */
const operationLogDotClass = (status) => {
  if (status === '失败') return 'bg-red-300 shadow-[0_0_8px_#ffb4ab]'
  if (status === '警告') return 'bg-secondary shadow-[0_0_8px_#eabcb8]'
  return 'bg-primary shadow-[0_0_8px_#52ee8a]'
}

/**
 * 功能：导出当前筛选后的操作日�? * @returns {void}
 * @throws {Error} 导出失败时提示用�? */
const exportOperationLogs = () => {
  try {
    const rows = filteredOperationLogs.value.map(item => [
      `${item.date} ${item.time}`,
      item.user,
      item.module,
      item.content,
      item.status
    ])
    const csvContent = [['操作时间', '操作人', '所属模块', '操作内容', '状态'], ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'operation-logs.csv'
    link.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error('导出操作日志失败', error)
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.error('导出操作日志失败')
    })
  }
}

watch(
  () => ({ ...operationLogFilters }),
  () => {
    operationLogPage.value = 1
  }
)

// 项目列表筛选状态
const projectFilters = reactive({
  search: '',
  type: '',
  status: '',
  dateRange: [],
  tab: 'all' // 'all', 'ongoing', 'completed'
})

// 自定义下拉框状�?
const openDropdown = ref(null)
const toggleDropdown = (type) => {
  openDropdown.value = openDropdown.value === type ? null : type
}
const selectFilter = (type, value) => {
  projectFilters[type] = value
  openDropdown.value = null
}

const ONGOING_PROJECT_STATUSES = ['negotiating', 'constructing', 'completed', 'settling', 'in_cooperation']
const DELIVERED_PROJECT_STATUSES = ['completed', 'closed', 'terminated']

// 点击外部关闭下拉�?
const closeDropdowns = (e) => {
  if (!e.target.closest('.custom-dropdown-trigger')) {
    openDropdown.value = null
  }
}

// 过滤后的项目列表
const filteredProjects = computed(() => {
  return projects.value.filter(p => {
    // 0. 补录单完结时间限制：完结时间 <= 当前系统时间时才展示
    if (p.type === 'historical' && p.completionTime) {
      const completion = new Date(p.completionTime).getTime();
      const now = new Date().getTime();
      if (completion > now) return false;
    }

    // 1. Tab 状态归类过滤
    if (projectFilters.tab === 'ongoing') {
      // 进行中：洽谈中、交付中、已交付、结账中、合作中
      if (!ONGOING_PROJECT_STATUSES.includes(p.status)) {
        return false;
      }
    } else if (projectFilters.tab === 'completed') {
      // 已交付：已交付、已结清、已终止
      if (!DELIVERED_PROJECT_STATUSES.includes(p.status)) {
        return false;
      }
    }
    
    // 2. 搜索词过�?(项目名称或客户名�?
    if (projectFilters.search) {
      const search = projectFilters.search.toLowerCase()
      const nameMatch = p.name?.toLowerCase().includes(search)
      const clientMatch = p.client?.toLowerCase().includes(search)
      if (!nameMatch && !clientMatch) return false
    }
    
    // 3. 项目类型过滤
    if (projectFilters.type && p.type !== projectFilters.type) {
      return false
    }
    
    // 4. 项目状态过�?
    if (projectFilters.status && p.status !== projectFilters.status) {
      return false
    }
    
    // 5. 日期范围过滤
    if (projectFilters.dateRange && projectFilters.dateRange.length === 2) {
      const start = new Date(projectFilters.dateRange[0]).setHours(0,0,0,0)
      const end = new Date(projectFilters.dateRange[1]).setHours(23,59,59,999)
      const pDate = new Date(p.period?.[0] || p.negotiatingTime || p.createTime).getTime()
      if (pDate < start || pDate > end) return false
    }
    
    return true
  })
})

// 分页相关
const currentPage = ref(1)
const pageSize = ref(6)
const paginatedProjects = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return filteredProjects.value.slice(start, end)
})

const totalProjectsCount = computed(() => filteredProjects.value.length)

const totalPages = computed(() => Math.ceil(totalProjectsCount.value / pageSize.value) || 1)

// 执行查询
const handleSearch = () => {
  currentPage.value = 1
}

// 重置查询
const handleResetFilters = () => {
  projectFilters.search = ''
  projectFilters.type = ''
  projectFilters.status = ''
  projectFilters.dateRange = []
  currentPage.value = 1
}

const paginationPages = computed(() => {
  const total = totalPages.value
  const current = currentPage.value
  const pages = []
  
  if (total <= 5) {
    for (let i = 1; i <= total; i++) pages.push(i)
  } else {
    if (current <= 3) {
      pages.push(1, 2, 3, 4, '...', total)
    } else if (current >= total - 2) {
      pages.push(1, '...', total - 3, total - 2, total - 1, total)
    } else {
      pages.push(1, '...', current - 1, current, current + 1, '...', total)
    }
  }
  return pages
})

watch(filteredProjects, (newVal) => {
  const maxPage = Math.ceil(newVal.length / pageSize.value) || 1
  if (currentPage.value > maxPage) {
    currentPage.value = maxPage
  }
})

// 项目录入表单响应式对�?
const form = reactive({
  name: '',           // 项目名称
  type: 'normal',     // 项目类型
  scene: '',          // 项目场景
  period: [null, null],       // 项目周期（日期范围数组）
  startDate: new Date().toISOString().split('T')[0], // 开始日期（新建项目模式�?
  constructionPeriod: [null, null], // 施工周期（历史模式）
  collectionPeriod: [null, null],   // 回款周期（历史模式）
  completionTime: null, // 完结时间（补录单专用�?
  client: '',         // 客户名称
  role: '',           // 客户角色
  clientSource: '',   // 客户来源（仅新客户可见）
  status: '',         // 项目状�?
  staffCount: null,   // 人员数量
  amount: '',         // 订单金额
  receivedAmount: null,  // 已收账款
  desc: '',           // 项目描述
  isHistorical: false, // 标识是否为历史补录项�?
  isHasContract: YES_NO_VALUE.NO, // 是否有合�?  isHasPreview: YES_NO_VALUE.NO,   // 是否有预览图
  isHasVoucher: YES_NO_VALUE.YES,   // 是否有发票凭�?  amountEditCount: 0,   // 订单金额修改次数
  subProjects: []      // 子项目列�?
})

// 项目合同列表
const contracts = ref([])
// 项目预览图列�?
const previews = ref([])

// 是否为新客户标识：用于控制“客户来源”显示及“客户角色”是否可编辑
const isNewClient = ref(true)

// 加载状态控�?
const clientLoading = ref(false)
const configSyncing = ref(false)
const savingProject = ref(false)

// 当前日期响应式对象，用于实时更新周期天数
const today = ref(new Date())
let todayTimer = null

const getLongTermPeriodEnd = (project, fallbackNow = today.value.toISOString()) => {
  if (!project) return fallbackNow
  if (project.status === 'terminated') {
    return (project.period && project.period[1]) || project.terminatedTime || project.updateTime || fallbackNow
  }
  return fallbackNow
}

onMounted(() => {
  todayTimer = window.setInterval(() => {
    today.value = new Date()
  }, 60000) // 每分钟更新一�?
})

onUnmounted(() => {
  if (todayTimer) window.clearInterval(todayTimer)
  window.removeEventListener('click', closeDropdowns)
  stopSessionActivityWatcher()
})

// 监听时间变化，实时更新活跃项目的周期显示
watch(today, () => {
  projects.value.forEach(p => {
    if (!p.isHistorical) {
      const now = today.value.toISOString();
      const pStart = p.negotiatingTime || (p.period && p.period[0]) || p.createTime;
      const pEnd = p.type === 'long_term' ? getLongTermPeriodEnd(p, now) : (p.settledTime || now);
      const pDays = calculateDiffDays(pStart, pEnd);
      
      const formatDate = (d) => d ? new Date(d).toLocaleDateString() : '-';
      p.projectDaysText = pDays ? `${pDays}天` : '-';
      p.projectRangeText = `${formatDate(pStart)} - ${formatDate(pEnd)}`;

      if (p.constructingTime) {
        const conEnd = p.completedTime || now;
        const conDays = calculateDiffDays(p.constructingTime, conEnd);
        p.constructionDaysText = conDays ? `${conDays}天` : '-';
        p.constructionRangeText = `${formatDate(p.constructingTime)} - ${formatDate(conEnd)}`;
      }

      if (p.settlingTime) {
        const colEnd = p.settledTime || now;
        const colDays = calculateDiffDays(p.settlingTime, colEnd);
        p.collectionDaysText = colDays ? `${colDays}天` : '-';
        p.collectionRangeText = `${formatDate(p.settlingTime)} - ${formatDate(colEnd)}`;
      }
    }
  });

  // 如果当前正在查看活跃项目，同步更新表单中的周期显�?
  if (isViewMode.value && selectedProjectId.value) {
    const p = projects.value.find(item => item.id === selectedProjectId.value)
    if (p && !p.isHistorical) {
      const now = today.value.toISOString()
      const pStart = p.negotiatingTime || (p.period && p.period[0]) || p.createTime;
      const pEnd = p.type === 'long_term' ? getLongTermPeriodEnd(p, now) : (p.settledTime || now)
      form.period = [pStart, pEnd]
      if (p.constructingTime) {
        form.constructionPeriod = [p.constructingTime, p.completedTime || now]
      }
      if (p.settlingTime) {
        form.collectionPeriod = [p.settlingTime, p.settledTime || now]
      }
    }
  }
});

// 现有客户列表（由接口获取�?
const existingClients = ref([])

// 客户角色列表（由接口获取�?
const clientRoles = ref([])

// 客户来源列表（由接口获取�?
const clientSources = ref([])

// 子项目内容选项
const subProjectContents = [
  { label: '植物养护', value: '植物养护' },
  { label: '植物换新', value: '植物换新' },
  { label: '景观优化', value: '景观优化' },
  { label: '环境治理', value: '环境治理' }
]

// 添加子项�?
const addSubProject = () => {
  form.subProjects.push({
    id: Date.now(),
    content: '植物养护',
    startDate: new Date().toISOString().split('T')[0],
    amount: 0,
    isHasVoucher: YES_NO_VALUE.NO,
    vouchers: [],
    costs: [],
    isCollapsed: false
  })
}

// 移除子项�?
const removeSubProject = (index) => {
  form.subProjects.splice(index, 1)
}

// 添加子项目成本项
const addSubProjectCost = (subProject) => {
  if (!subProject.costs) subProject.costs = []
  subProject.costs.push({
    id: Date.now() + Math.random(),
    category: '',
    supplier: '',
    amount: 0,
    isSettled: true
  })
}

// 移除子项目成本项
const removeSubProjectCost = (subProject, costIndex) => {
  subProject.costs.splice(costIndex, 1)
}

// 项目类型列表（由接口获取�?
const projectTypes = ref([])
const projectScenes = ref([])

const defaultProjectScenes = [
  { label: '公司布景', value: 'company_scene' },
  { label: '门店造景', value: 'store_landscape' },
  { label: '私人住宅', value: 'private_residence' },
  { label: '机关单位', value: 'government_unit' }
]

// 成本类目列表（由接口获取）
const costCategories = ref([])

// 供应商列表（目前默认只有一个“无”）
const suppliers = ref([
  { id: 'none', label: '无', value: 'none' }
])

/**
 * 初始化全局配置（带 12 小时本地缓存逻辑�?
 * @param {Boolean} forceRefresh - 是否强制从云端同�?
 */
const initGlobalConfigs = async (forceRefresh = false) => {
  const CACHE_KEY = 'APP_GLOBAL_CONFIGS'
  const TIME_KEY = 'APP_CONFIG_TIMESTAMP'
  const EXPIRE_TIME = 12 * 60 * 60 * 1000 // 12小时

  if (forceRefresh) configSyncing.value = true

  try {
    // 加载项目列表
    loadProjects()

    const cachedData = localStorage.getItem(CACHE_KEY)
    const lastFetchTime = localStorage.getItem(TIME_KEY)
    const now = Date.now()

    // 1. 检查本地缓存是否有�?(如果不强制刷�?
    if (!forceRefresh && cachedData && lastFetchTime && (now - parseInt(lastFetchTime) < EXPIRE_TIME)) {
      const configs = JSON.parse(cachedData)
      console.log('📦 [Local Cache Hit] 从本地存储加载配置数据')
      
      // 统一去重处理，防止数据库脏数据导致前端显示重�?
      const deduplicate = (arr) => {
        if (!Array.isArray(arr)) return []
        const seen = new Set()
        return arr.filter(item => {
          const val = item.value
          if (seen.has(val)) return false
          seen.add(val)
          return true
        })
      }

      clientRoles.value = deduplicate(configs['CLIENT_ROLE'])
      clientSources.value = deduplicate(configs['CLIENT_SOURCE'])
      costCategories.value = deduplicate(configs['COST_CATEGORY'])
      projectTypes.value = deduplicate(configs['PROJECT_TYPE'])
      projectScenes.value = deduplicate(configs['PROJECT_SCENE']).length ? deduplicate(configs['PROJECT_SCENE']) : defaultProjectScenes
      projectStatuses.value = deduplicate(configs['PROJECT_STATUS']).map(s => {
        let label = s.label;
        if (label === '谈判中') label = '洽谈中';
        if (label === '已完成' || label === '已完工') label = '已结清';
        if (label === '施工中') label = '交付中';
        if (label === '已竣工') label = '已交付';
        return { ...s, label };
      })
      applySessionTimeoutConfig(configs)
      await loadSettingConfigItems()
      return
    }

    // 2. 缓存失效或强制同步，调用聚合接口
    console.log(forceRefresh ? '🔄 [Force Sync] 正在强制同步云端配置...' : '📡 [Local Cache Miss] 正在从云端同步配置数据...')
    const res = await getGlobalConfig(forceRefresh)
    if (res && res.code === 0 && res.data) {
      const configs = res.data
      
      const deduplicate = (arr) => {
        if (!Array.isArray(arr)) return []
        const seen = new Set()
        return arr.filter(item => {
          const val = item.value
          if (seen.has(val)) return false
          seen.add(val)
          return true
        })
      }

      clientRoles.value = deduplicate(configs['CLIENT_ROLE'])
      clientSources.value = deduplicate(configs['CLIENT_SOURCE'])
      costCategories.value = deduplicate(configs['COST_CATEGORY'])
      projectTypes.value = deduplicate(configs['PROJECT_TYPE'])
      projectScenes.value = deduplicate(configs['PROJECT_SCENE']).length ? deduplicate(configs['PROJECT_SCENE']) : defaultProjectScenes
      projectStatuses.value = deduplicate(configs['PROJECT_STATUS']).map(s => {
        let label = s.label;
        if (label === '谈判中') label = '洽谈中';
        if (label === '已完成' || label === '已完工') label = '已结清';
        if (label === '施工中') label = '交付中';
        if (label === '已竣工') label = '已交付';
        return { ...s, label };
      })
      
      // 3. 更新本地缓存
      applySessionTimeoutConfig(configs)
      localStorage.setItem(CACHE_KEY, JSON.stringify(configs))
      localStorage.setItem(TIME_KEY, now.toString())
      console.log('✅ [Sync Success] 配置数据已同步并存入本地缓存')
      
      if (forceRefresh) {
        import('element-plus').then(({ ElMessage }) => {
          ElMessage.success('配置同步成功')
        })
      }
      await loadSettingConfigItems()
    } else {
      throw new Error(res?.message || '获取配置失败')
    }
  } catch (error) {
    console.error('初始化配置失败', error.message || error)
    if (forceRefresh) {
      import('element-plus').then(({ ElMessage }) => {
        ElMessage.error('同步失败，请检查网络')
      })
    }
  } finally {
    if (forceRefresh) configSyncing.value = false
  }
}

onMounted(() => {
  loadCurrentUser()
  startSessionActivityWatcher()
  initGlobalConfigs()
  window.addEventListener('click', closeDropdowns)
})

// 计算属性：根据选择的日期范围自动计算项目总天�?
const projectDays = computed(() => {
  // 如果有表单数据（编辑/历史模式�?
  if (form.period && Array.isArray(form.period) && form.period[0] && form.period[1]) {
    return calculateDiffDays(form.period[0], form.period[1]) || 0
  }
  
  // 查看模式下的非历史数据，从时间节点计�?
  if (isViewMode.value && selectedProjectId.value) {
    const p = projects.value.find(item => item.id === selectedProjectId.value)
    if (p && !p.isHistorical) {
      const start = p.negotiatingTime || p.createTime
      const end = p.completedTime || today.value.toISOString()
      const days = calculateDiffDays(start, end)
      if (days) return days
    }
  }
  return 0
})

// 计算属性：施工周期天数
const constructionDays = computed(() => {
  if (form.constructionPeriod && Array.isArray(form.constructionPeriod) && form.constructionPeriod[0] && form.constructionPeriod[1]) {
    return calculateDiffDays(form.constructionPeriod[0], form.constructionPeriod[1]) || 0
  }

  if (isViewMode.value && selectedProjectId.value) {
    const p = projects.value.find(item => item.id === selectedProjectId.value)
    if (p && !p.isHistorical && p.constructingTime) {
      const end = p.completedTime || today.value.toISOString()
      const days = calculateDiffDays(p.constructingTime, end)
      if (days) return days
    }
  }
  return 0
})

// 计算属性：回款周期天数
const collectionDays = computed(() => {
  if (form.collectionPeriod && Array.isArray(form.collectionPeriod) && form.collectionPeriod[0] && form.collectionPeriod[1]) {
    return calculateDiffDays(form.collectionPeriod[0], form.collectionPeriod[1]) || 0
  }

  if (isViewMode.value && selectedProjectId.value) {
    const p = projects.value.find(item => item.id === selectedProjectId.value)
    if (p && !p.isHistorical && p.settlingTime) {
      const end = p.settledTime || today.value.toISOString()
      const days = calculateDiffDays(p.settlingTime, end)
      if (days) return days
    }
  }
  return 0
})

// 监听是否有合同切�?
watch(() => form.isHasContract, async (newVal, oldVal) => {
  if (isLoadingProject.value) return // 加载中不触发清理逻辑
  if (newVal === YES_NO_VALUE.NO && oldVal === YES_NO_VALUE.YES) {
    if (contracts.value.length > 0) {
      try {
        await import('element-plus').then(async ({ ElMessageBox, ElMessage }) => {
          try {
            await ElMessageBox.confirm('切换为“否”将自动删除已上传的所有合同文件，是否继续？', '提示', {
              confirmButtonText: '确定',
              cancelButtonText: '取消',
              type: 'warning',
              customClass: 'custom-message-box'
            })
            
            // 调用清理接口
            const projectId = selectedProjectId.value || currentTempId.value
            await axios.post(`${apiDomain}/contractPreviewService`, {
              action: 'deleteAllByProject',
              data: { projectId, type: 'contract' }
            })
            contracts.value = []
            ElMessage.success('合同文件已清理')
          } catch {
            // 用户取消，恢复为“是�?
            form.isHasContract = YES_NO_VALUE.YES
          }
        })
      } catch (err) {
        console.error('清理合同失败:', err)
      }
    }
  }
})

// 监听是否有预览图切换
watch(() => form.isHasPreview, async (newVal, oldVal) => {
  if (isLoadingProject.value) return // 加载中不触发清理逻辑
  if (newVal === YES_NO_VALUE.NO && oldVal === YES_NO_VALUE.YES) {
    if (previews.value.length > 0) {
      try {
        await import('element-plus').then(async ({ ElMessageBox, ElMessage }) => {
          try {
            await ElMessageBox.confirm('切换为“否”将自动删除已上传的所有预览图，是否继续？', '提示', {
              confirmButtonText: '确定',
              cancelButtonText: '取消',
              type: 'warning',
              customClass: 'custom-message-box'
            })
            
            // 调用清理接口
            const projectId = selectedProjectId.value || currentTempId.value
            await axios.post(`${apiDomain}/contractPreviewService`, {
              action: 'deleteAllByProject',
              data: { projectId, type: 'preview' }
            })
            previews.value = []
            ElMessage.success('预览图已清理')
          } catch {
            // 用户取消，恢复为“是�?
            form.isHasPreview = YES_NO_VALUE.YES
          }
        })
      } catch (err) {
        console.error('清理预览图失�?', err)
      }
    }
  }
})

// 过滤后的项目状态列�?
const filteredProjectStatuses = computed(() => {
  const isHistorical = form.type === 'historical' || (selectedProjectId.value && projects.value.find(p => p.id === selectedProjectId.value)?.isHistorical);
  if (isHistorical) {
    return projectStatuses.value.filter(s => s.value === 'settling' || s.value === 'closed')
  }
  
  if (form.type === 'long_term') {
    if (isCreating.value) {
      return projectStatuses.value.filter(s => s.value === 'in_cooperation')
    }
    return projectStatuses.value.filter(s => s.value === 'in_cooperation' || s.value === 'terminated')
  }
  
  // 常规项目新建时，禁止选择「已结清」状态，且排除长期项目的专属状�?
  if (isCreating.value && form.type !== 'historical') {
    return projectStatuses.value.filter(s => s.value !== 'closed' && s.value !== 'in_cooperation' && s.value !== 'terminated')
  }
  
  return projectStatuses.value.filter(s => s.value !== 'in_cooperation' && s.value !== 'terminated')
})

/**
 * 获取特定行的可选状态列�?
 */
const getRowProjectStatuses = (row) => {
  if (row.isHistorical) {
    return projectStatuses.value.filter(s => s.value === 'settling' || s.value === 'closed')
  }
  if (row.type === 'long_term') {
    return projectStatuses.value.filter(s => s.value === 'in_cooperation' || s.value === 'terminated')
  }
  return projectStatuses.value.filter(s => s.value !== 'in_cooperation' && s.value !== 'terminated')
}

// 施工周期变更处理：联动回款周期开始日�?
const handleConstructionPeriodChange = (val) => {
  if (val && val[1] && (!form.collectionPeriod || !form.collectionPeriod[0])) {
    // 回款周期的开始日期默认是施工周期的结束日�?
    form.collectionPeriod = [val[1], val[1]]
  }
}

// 回款周期变更处理
const handleCollectionPeriodChange = () => {
  // 可以在这里做一些校�?
}

// 监听项目类型变更
watch(() => form.type, (newVal) => {
  if (newVal === 'historical') {
    form.status = 'closed'; // 补录单默认已结清
    form.isHistorical = true;
  } else if (newVal === 'long_term') {
    if (!isEditMode.value && !isViewMode.value) {
      form.status = 'in_cooperation';
      form.isHistorical = false;
      // 长期项目默认添加一个子项目
      if (form.subProjects.length === 0) {
        addSubProject();
      }
    }
  } else {
    if (!isEditMode.value && !isViewMode.value) {
      form.status = 'negotiating';
      form.isHistorical = false;
    }
  }
});

/**
 * 接口：查询客户名称列�?
 */
const handleClientVisibleChange = async (visible) => {
  // 仅在下拉框展开且列表为空时触发查询
  if (visible && existingClients.value.length === 0) {
    clientLoading.value = true
    try {
      // 调用云函�?queryClients
      const res = await queryClients({ keyword: '' })
      // 更新现有客户列表数据
      if (res.data && Array.isArray(res.data)) {
        existingClients.value = res.data.map(item => ({
          id: item._id || item.id,
          name: item.name,
          role: item.roleCode || item.role,
          source: item.source
        }))
      }
      console.log('客户列表查询成功')
    } catch (error) {
      console.error('查询客户失败:', error.message || error)
    } finally {
      clientLoading.value = false
    }
  }
}

/**
 * 处理客户名称变更逻辑
 * @param {string} val - 输入或选择的客户名�?
 */
const handleClientChange = (val) => {
  if (!val) {
    isNewClient.value = true
    return
  }
  // 在现有客户库中查找（忽略首尾空格�?
  const client = existingClients.value.find(c => c.name.trim() === val.trim())
  if (client) {
    // 匹配到已有客户：自动带出角色和来源，标记为非新客�?
    form.role = client.role
    form.clientSource = client.source
    isNewClient.value = false
  } else {
    // 未匹配到：清空角色和来源，标记为新客户，允许手动填写
    form.role = ''
    form.clientSource = ''
    isNewClient.value = true
  }
}

/**
 * 获取客户角色显示名称
 * @param {string} roleCode - 客户角色标识
 * @returns {string} 客户角色显示名称
 */
const getClientRoleLabel = (roleCode) => {
  return clientRoles.value.find(item => item.value === roleCode)?.label || roleCode || ''
}

/**
 * 新建项目后同步保存新客户
 * @returns {Promise<void>} 无返�? * @throws {Error} 客户保存失败时抛出异�? */
const syncNewClientAfterProjectCreate = async () => {
  try {
    const clientName = form.client.trim()
    const existedClient = existingClients.value.find(item => item.name.trim() === clientName)
    if (existedClient) return

    const res = await createClient({
      name: clientName,
      role: getClientRoleLabel(form.role),
      roleCode: form.role,
      source: form.clientSource
    })

    const clientId = res.data?.id || res.data?._id
    existingClients.value.unshift({
      id: clientId,
      name: clientName,
      role: form.role,
      source: form.clientSource
    })
    isNewClient.value = false
  } catch (error) {
    console.error('同步新客户失�?', error.message || error)
    throw error
  }
}

// 成本支出项列表
const costs = ref([])

// 计算属性：未收账款
const unreceivedAmount = computed(() => {
  const total = totalOrderAmount.value;
  const received = parseFloat(form.receivedAmount) || 0;
  return Math.max(0, total - received).toFixed(2);
});

// 计算属性：应付账款 (所有成本项总和)
const payableAmount = computed(() => {
  if (form.type === 'long_term') {
    let total = 0;
    form.subProjects.forEach(sp => {
      if (sp.costs) {
        total += sp.costs.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
      }
    });
    return total.toFixed(2);
  }
  return costs.value.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0).toFixed(2);
});

// 计算属性：已付账款 (已结清成本项总和)
const paidAmount = computed(() => {
  if (form.type === 'long_term') {
    let total = 0;
    form.subProjects.forEach(sp => {
      if (sp.costs) {
        total += sp.costs
          .filter(item => isCostSettled(item.isSettled))
          .reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
      }
    });
    return total.toFixed(2);
  }
  return costs.value
    .filter(item => isCostSettled(item.isSettled))
    .reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0)
    .toFixed(2);
});

// 计算属性：未付账款 (应付账款 - 已付账款)
const unpaidAmount = computed(() => {
  const payable = parseFloat(payableAmount.value) || 0;
  const paid = parseFloat(paidAmount.value) || 0;
  return Math.max(0, payable - paid).toFixed(2);
});

// 计算属性：未收账款百分�?
const unreceivedPercent = computed(() => {
  const total = parseFloat(form.amount) || 0;
  if (total === 0) return 0;
  const unreceived = parseFloat(unreceivedAmount.value) || 0;
  return Math.max(0, Math.min(100, (unreceived / total) * 100)).toFixed(1);
});

// 计算属性：未付账款百分�?
const unpaidPercent = computed(() => {
  const total = parseFloat(totalCost.value) || 0;
  if (total === 0) return 0;
  const unpaid = parseFloat(unpaidAmount.value) || 0;
  return Math.max(0, Math.min(100, (unpaid / total) * 100)).toFixed(1);
});

// 计算属性：项目类型右上角丝带标签配�?
const projectTypeRibbon = computed(() => {
  const type = form.type || 'normal';
  const config = {
    'normal': { label: '常规', color: 'bg-emerald-500', shadow: 'border-t-emerald-600/30' },
    'historical': { label: '补录', color: 'bg-amber-500', shadow: 'border-t-amber-600/30' },
    'long_term': { label: '长期', color: 'bg-cyan-400', shadow: 'border-t-cyan-600/30' }
  };
  return config[type] || config['normal'];
});

// 计算属性：判断当前项目是否为已结清状�?
const isProjectClosed = computed(() => {
  if (isEditMode.value && selectedProjectId.value) {
    const p = projects.value.find(item => item.id === selectedProjectId.value);
    return p && p.status === 'closed';
  }
  return false;
});

// 计算属性：根据项目状态判断字段是否只读
const isLongTermTerminated = computed(() => {
  return form.type === 'long_term' && form.status === 'terminated';
});

const isFieldReadOnly = (fieldName) => {
  if (form.type === 'long_term') {
    // 长期项目创建成功后，项目类型、项目周期和订单金额禁止编辑
    const lockedFields = ['type', 'period', 'amount'];
    if (lockedFields.includes(fieldName) && !isCreating.value) {
      return true;
    }
    // 新建时，周期和金额也是只读的（由系统计算或隐藏）
    if (isCreating.value && (fieldName === 'period' || fieldName === 'amount')) {
      return true;
    }
    return false;
  }

  // 补录单特殊逻辑：项目类型和项目状态始终只�?
  if (form.type === 'historical') {
    if (fieldName === 'type' || fieldName === 'status') {
      return true;
    }
    // 其余字段均可正常修改
    return false;
  }

  // 常规项目逻辑
  if (!isCreating.value) {
    // 创建成功后，项目类型和三大周期禁止编�?
    const lockedFields = ['type', 'period', 'constructionPeriod', 'collectionPeriod'];
    if (lockedFields.includes(fieldName)) {
      return true;
    }

    // 订单金额修改限制：创建成功后最多允许修改一�?
    if (fieldName === 'amount' && form.amountEditCount >= 1) {
      return true;
    }
  }

  // 编辑模式下，项目类型不可修改
  if (isEditMode.value && fieldName === 'type') {
    return true;
  }

  if (!isProjectClosed.value) return false;
  
  // 已结清项目仅开放：项目名称、项目描述、成本支出、凭证上传、已收账�?
  const allowedFields = ['name', 'desc', 'costs', 'vouchers', 'isHasVoucher', 'receivedAmount'];
  return !allowedFields.includes(fieldName);
};

/**
 * 添加成本�?
 */
const addCost = () => {
  if (costs.value.length >= costCategories.value.length) {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.warning('所有成本类目已添加完毕')
    })
    return
  }
  costs.value.push({
    id: Date.now() + Math.random(), 
    category: '',
    supplier: '',
    amount: 0,
    isSettled: true // 默认设为已结�?
  })
}

/**
 * 检查类目是否已被选择
 */
const isCategorySelected = (categoryValue, currentIndex) => {
  return costs.value.some((item, index) => index !== currentIndex && item.category === categoryValue);
}

// 单据凭证列表
const vouchers = ref([])
const uploadingVoucher = ref(false)
const uploadingContract = ref(false)
const uploadingPreview = ref(false)
const fileInputRef = ref(null)
const contractInputRef = ref(null)
const previewInputRef = ref(null)

// 图片预览状�?
const previewVisible = ref(false)
const initialIndex = ref(0)
const previewList = ref([])
const currentCarouselIndex = ref(0)

/**
 * 处理图片预览
 */
const handlePreview = (index) => {
  previewList.value = vouchers.value.map(v => v.url)
  initialIndex.value = index
  previewVisible.value = true
}

/**
 * 轮播图切换回�?
 */
const handleCarouselChange = (index) => {
  currentCarouselIndex.value = index
}

/**
 * 使用 compressorjs 三方库实现图片压�?
 */
const compressImage = (file) => {
  return new Promise((resolve) => {
    // 基本校验
    if (!file || file.size === 0) {
      resolve(file);
      return;
    }

    // 仅处理图片类�?
    if (!file.type || !file.type.startsWith('image/')) {
      resolve(file);
      return;
    }

    new Compressor(file, {
      maxWidth: 1920, // 提高最大宽度到 Full HD
      maxHeight: 1920, // 提高最大高�?
      quality: 0.8, // 提高压缩质量�?0.8
      mimeType: file.type || 'image/jpeg', // 确保有有效的 mimeType
      checkOrientation: true, // 自动修正图片方向
      success: (compressedBlob) => {
        // 压缩成功，返回压缩后�?Blob
        resolve(compressedBlob)
      },
      error: (err) => {
        // 压缩失败（如 HEIC 格式或损坏的图片），返回原文�?
        // 避免输出过于频繁的错误日志，改为警告
        console.warn('图片压缩跳过 (可能格式不支持或文件损坏):', err.message || err)
        resolve(file)
      }
    })
  })
}

/**
 * 列表内直接修改状�?
 */
const handleInlineStatusChange = async (row, newVal) => {
  // 状态回溯保护逻辑
  const oldOrder = getStatusOrder(row.status)
  const newOrder = getStatusOrder(newVal)
  
  if (!canRollbackStatus(row) && newOrder < oldOrder) {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.warning('项目状态无法回退')
    })
    return
  }

  if (newOrder === oldOrder) return

  const performUpdate = async () => {
    try {
      // 准备更新数据
      const updateData = {
        id: row.id,
        status: newVal
      }

      // 活跃项目特殊逻辑：当状态改变时，记录对应的时间节点
      if (!row.isHistorical) {
        const now = new Date().toISOString()
        if (newVal === 'constructing') {
          if (!row.constructingTime) updateData.constructingTime = now
        } else if (newVal === 'completed') {
          updateData.completedTime = now
          if (!row.constructingTime) updateData.constructingTime = now
        } else if (newVal === 'settling') {
          updateData.settlingTime = now
          if (!row.completedTime) updateData.completedTime = now
        } else if (newVal === 'closed') {
          updateData.settledTime = now
          if (!row.settlingTime) updateData.settlingTime = now
          if (!row.completedTime) updateData.completedTime = now
        }
      }

      // 补录单据特殊逻辑：当状态从“结账中”改为“已结清”时，自动计算回款周�?
      if (row.isHistorical && row.status === 'settling' && newVal === 'closed') {
        const conEnd = row.constructionPeriod?.[1] ? new Date(row.constructionPeriod[1]) : null;
        if (conEnd && !isNaN(conEnd.getTime())) {
          const now = new Date();
          const formatDateLocal = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
          };
          // 规则：当前时�?- 施工周期的竣工时间，不满一天算一�?
          // 自动计算的回款周期：[竣工时间, 当前时间]
          updateData.collectionPeriod = [formatDateLocal(conEnd) + 'T00:00:00.000Z', formatDateLocal(now) + 'T00:00:00.000Z'];
        }
      } else if (row.isHistorical && newVal === 'settling') {
        // 如果改回结账中，清空回款周期
        updateData.collectionPeriod = null;
      }
      
      // 调用接口更新
      const res = await updateProject(updateData)
      
      if (res.code === 0) {
        import('element-plus').then(({ ElMessage }) => {
          ElMessage.success(`项目�?{row.name}”状态已更新`)
        })
        
        // 更新本地行数据中�?statusText �?statusColor 以同步显�?
        const statusConfig = projectStatuses.value.find(s => s.value === newVal)
        row.statusText = statusConfig ? statusConfig.label : '未知状态'
        row.statusColor = newVal === 'constructing' ? 'bg-primary' : 'bg-secondary'
        
        // 更新状态以供回溯校�?        row.status = newVal

        if (row.type === 'long_term' && row.period && row.period[0]) {
          const periodEnd = newVal === 'terminated'
            ? (res.data?.period?.[1] || new Date().toISOString())
            : new Date().toISOString()
          row.period = [row.period[0], periodEnd]
          const days = calculateDiffDays(row.period[0], row.period[1])
          row.projectDaysText = days ? `${days}天` : '-'
          const formatDate = (d) => d ? new Date(d).toLocaleDateString() : '-'
          row.projectRangeText = `${formatDate(row.period[0])} - ${formatDate(row.period[1])}`
          row.deliveryDateText = newVal === 'terminated' ? formatDate(row.period[1]) : '-'
        }

        // 活跃项目特殊逻辑：当状态改为“已交付”或“已结清”时，更新时间节点并重新计算周期
        if (!row.isHistorical) {
          const now = new Date().toISOString()
          if (newVal === 'constructing') {
            if (!row.constructingTime) row.constructingTime = now
          } else if (newVal === 'completed') {
            row.completedTime = now
            if (!row.constructingTime) row.constructingTime = now
          } else if (newVal === 'settling') {
            row.settlingTime = now
            if (!row.completedTime) row.completedTime = now
          } else if (newVal === 'closed') {
            row.settledTime = now
            if (!row.settlingTime) row.settlingTime = now
            if (!row.completedTime) row.completedTime = now
          }
          
          // 重新计算活跃项目的周期天�?
          const pStart = row.negotiatingTime || (row.period && row.period[0]) || row.createTime
          const pEnd = row.type === 'long_term' ? getLongTermPeriodEnd(row, now) : (row.settledTime || now)
          const pDays = calculateDiffDays(pStart, pEnd)
          
          let conDays = null
          if (row.constructingTime) {
            const conEnd = row.completedTime || now
            conDays = calculateDiffDays(row.constructingTime, conEnd)
          }

          let colDays = null
          if (row.settlingTime) {
            const colEnd = row.settledTime || now
            colDays = calculateDiffDays(row.settlingTime, colEnd)
          }
          
          row.projectDaysText = pDays ? `${pDays}天` : '-'
          row.constructionDaysText = conDays ? `${conDays}天` : '-'
          row.collectionDaysText = colDays ? `${colDays}天` : '-'

          const formatDate = (d) => d ? new Date(d).toLocaleDateString() : '-';
          row.projectRangeText = `${formatDate(pStart)} - ${formatDate(pEnd)}`;
          row.constructionRangeText = row.constructingTime ? `${formatDate(row.constructingTime)} - ${formatDate(row.completedTime || now)}` : '-';
          row.collectionRangeText = row.settlingTime ? `${formatDate(row.settlingTime)} - ${formatDate(row.settledTime || now)}` : '-';
        }

        // 同步更新回款周期数据（如果是补录单据自动计算的情况）
        if (updateData.collectionPeriod) {
          row.collectionPeriod = updateData.collectionPeriod
          const days = calculateDiffDays(updateData.collectionPeriod[0], updateData.collectionPeriod[1])
          row.collectionDaysText = days ? `${days}天` : '-'
        } else if (row.isHistorical && newVal === 'settling') {
          row.collectionPeriod = null
          row.collectionDaysText = '-'
        }

        // 如果当前正在查看该项目，同步更新表单状�?
        if (selectedProjectId.value === row.id) {
          form.status = newVal
          if (row.isHistorical) {
            form.collectionPeriod = row.collectionPeriod
          } else if (row.type === 'long_term' && row.period) {
            form.period = [...row.period]
          } else {
            // 活跃项目同步更新表单中的周期显示
            const now = today.value.toISOString()
            form.period = [row.negotiatingTime || row.createTime, row.settledTime || now]
            if (row.constructingTime) {
              form.constructionPeriod = [row.constructingTime, row.completedTime || now]
            }
            if (row.settlingTime) {
              form.collectionPeriod = [row.settlingTime, row.settledTime || now]
            }
          }
        }
      } else {
        throw new Error(res.message)
      }
    } catch (err) {
      console.error('更新项目状态失�?', err)
      import('element-plus').then(({ ElMessage }) => {
        ElMessage.error(`状态更新失�? ${err.message || '未知错误'}`)
      })
      // 失败时回滚本地状�?
      loadProjects()
    }
  }

  if (canRollbackStatus(row)) {
    performUpdate()
    return
  }

  import('element-plus').then(({ ElMessageBox }) => {
    ElMessageBox.confirm(
      `确定要将项目状态修改为“${projectStatuses.value.find(s => s.value === newVal)?.label}”吗？状态一旦修改将无法回退。`,
      '状态修改确认',
      {
        confirmButtonText: '确认修改',
        cancelButtonText: '取消',
        type: 'warning',
        customClass: 'custom-message-box'
      }
    ).then(() => {
      performUpdate()
    }).catch(() => {
      // 取消修改
    })
  })
}

/**
 * 表单内修改状�?
 */
const handleFormStatusChange = (newVal) => {
  if (isEditMode.value && originalProjectStatus.value && newVal !== originalProjectStatus.value) {
    // 长期项目支持状态回溯切换，不需要确认弹窗
    if (canRollbackStatus(form)) {
      return;
    }

    import('element-plus').then(({ ElMessageBox }) => {
      ElMessageBox.confirm(
        `确定要将项目状态修改为“${projectStatuses.value.find(s => s.value === newVal)?.label}”吗？状态一旦修改将无法回退。`,
        '状态修改确认',
        {
          confirmButtonText: '确认修改',
          cancelButtonText: '取消',
          type: 'warning',
          customClass: 'custom-message-box'
        }
      ).then(() => {
        // 确认修改，无需额外操作，v-model已更�?
        // 补录单子编辑时状态从“结账中”改为“已结清�?
        if (form.isHistorical && originalProjectStatus.value === 'settling' && newVal === 'closed') {
          const conEnd = form.constructionPeriod?.[1] ? new Date(form.constructionPeriod[1]) : null;
          if (conEnd && !isNaN(conEnd.getTime())) {
            const now = new Date();
            const formatDateLocal = (date) => {
              const year = date.getFullYear();
              const month = String(date.getMonth() + 1).padStart(2, '0');
              const day = String(date.getDate()).padStart(2, '0');
              return `${year}-${month}-${day}`;
            };
            form.collectionPeriod = [formatDateLocal(conEnd), formatDateLocal(now)];
          }
        }
      }).catch(() => {
        // 取消修改，回退表单状�?
        form.status = originalProjectStatus.value
      })
    })
  }
}

/**
 * 删除项目
 */
const handleDeleteProject = (project) => {
  if (!project) return
  if (!hasPermission('DELETE_PROJECT')) {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.warning('暂无删除项目权限')
    })
    return
  }
  
  import('element-plus').then(({ ElMessageBox, ElMessage, ElLoading }) => {
    ElMessageBox.confirm(
      `确定要删除项目“${project.name}”吗？此操作将永久删除该项目及其所有关联的成本记录和凭证图片，不可恢复。`,
      '危险操作提示',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消返回',
        type: 'warning',
        confirmButtonClass: '!bg-red-500 !border-red-500 !text-white',
        cancelButtonClass: '!bg-neutral-800 !border-white/10 !text-white/60 hover:!text-white',
        customClass: 'danger-message-box',
        center: true,
      }
    ).then(async () => {
      const loading = ElLoading.service({
        lock: true,
        text: '正在删除项目及其关联数据...',
        background: 'rgba(0, 0, 0, 0.7)',
      })
      
      try {
        // 1. 删除项目关联的所有凭证（云存储文�?+ 数据库记录）
        await deleteVouchersByProject({ projectId: project.id })
        
        // 2. 删除项目关联的所有合同文�?
        await axios.post(`${apiDomain}/contractPreviewService`, {
          action: 'deleteAllByProject',
          data: { projectId: project.id, type: 'contract' }
        })

        // 3. 删除项目关联的所有预览图
        await axios.post(`${apiDomain}/contractPreviewService`, {
          action: 'deleteAllByProject',
          data: { projectId: project.id, type: 'preview' }
        })

        // 4. 删除项目本身
        const res = await deleteProject({ id: project.id })
        
        if (res.code === 0) {
          ElMessage.success('项目已成功删除')
          
          // 如果删除的是当前选中的项目，重置状�?
          if (selectedProjectId.value === project.id) {
            selectedProjectId.value = null
            isViewMode.value = false
            isEditMode.value = false
            resetForm()
          }
          
          // 刷新列表
          loadProjects()
        } else {
          throw new Error(res.message)
        }
      } catch (err) {
        if (err !== 'cancel') {
          console.error('删除项目失败:', err)
          ElMessage.error(`删除失败: ${err.message || '未知错误'}`)
        }
      } finally {
        loading.close()
      }
    }).catch(() => {
      // 取消删除
    })
  })
}

/**
 * 查看项目详情
 */
const handleViewProject = async (project) => {
  if (!project) return
  
  isLoadingProject.value = true
  isViewMode.value = true
  isEditMode.value = false
  selectedProjectId.value = project.id
  
  // 回显数据
  const now = today.value.toISOString()
  const pStart = project.negotiatingTime || project.createTime
  Object.assign(form, {
    name: project.name,
    type: project.type || (project.isHistorical ? 'historical' : 'normal'),
    scene: project.scene || '',
    period: project.type === 'long_term'
      ? (project.period || [pStart, now])
      : (project.isHistorical ? (project.period || [null, null]) : [pStart, project.settledTime || now]),
    startDate: pStart ? new Date(pStart).toISOString().split('T')[0] : null,
    constructionPeriod: project.isHistorical ? (project.constructionPeriod || [null, null]) : (project.constructingTime ? [project.constructingTime, project.completedTime || now] : [null, null]),
    collectionPeriod: project.isHistorical ? (project.collectionPeriod || [null, null]) : (project.settlingTime ? [project.settlingTime, project.settledTime || now] : [null, null]),
    client: project.client,
    role: project.role,
    clientSource: project.clientSource,
    status: project.status,
    staffCount: project.staffCount,
    amount: project.amount,
    receivedAmount: project.receivedAmount || 0,
    desc: project.desc,
    isHistorical: !!project.isHistorical,
    completionTime: project.completionTime ? new Date(project.completionTime).toISOString().split('T')[0] : null,
    isHasContract: normalizeYesNo(project.isHasContract, YES_NO_VALUE.NO),
    isHasPreview: normalizeYesNo(project.isHasPreview, YES_NO_VALUE.NO),
    isHasVoucher: normalizeYesNo(project.isHasVoucher, YES_NO_VALUE.YES),
    amountEditCount: project.amountEditCount || 0,
    subProjects: project.subProjects ? project.subProjects.map(sp => ({
      ...sp,
      id: sp.id || Date.now() + Math.random(),
      isHasVoucher: normalizeYesNo(sp.isHasVoucher, YES_NO_VALUE.NO),
      isCollapsed: true // 默认折叠
    })) : []
  })

  // 标记为非新客户，隐藏提示文案
  isNewClient.value = false
  
  // 回显成本�?
  costs.value = project.costs ? project.costs.map(c => ({
    id: Date.now() + Math.random(),
    category: c.category,
    supplier: c.supplier,
    amount: c.amount,
    isSettled: c.isSettled !== undefined ? isCostSettled(c.isSettled) : true // 历史数据默认为已结清
  })) : []
  
  // 回显凭证：先清空，再从接口获取最新凭�?
  vouchers.value = []
  try {
    const res = await getVouchers({ projectId: project.id })
    if (res.success || res.code === 0) {
      vouchers.value = res.data.map(v => ({
        id: v._id || v.id,
        url: v.fileUrl,
        name: v.fileName,
        fileId: v.fileId
      }))
    }
  } catch (err) {
    console.error('获取凭证列表失败:', err)
  }

  // 回显合同
  contracts.value = []
  if (form.isHasContract === YES_NO_VALUE.YES) {
    try {
      const res = await getContracts({ projectId: project.id })
      if (res.code === 0) {
        contracts.value = res.data.map(c => ({
          id: c._id || c.id,
          url: c.url,
          name: c.name,
          fileId: c.fileId,
          type: c.type
        }))
      }
    } catch (err) {
      console.error('获取合同列表失败:', err)
    }
  }

  // 回显预览�?
  previews.value = []
  if (form.isHasPreview === YES_NO_VALUE.YES) {
    try {
      const res = await getPreviews({ projectId: project.id })
      if (res.code === 0) {
        previews.value = res.data.map(p => ({
          id: p._id || p.id,
          url: p.url,
          fileId: p.fileId
        }))
      }
    } catch (err) {
      console.error('获取预览图列表失�?', err)
    }
  }

  // 数据加载完成后，重置加载状�?
  setTimeout(() => {
    isLoadingProject.value = false
  }, 100)
}

/**
 * 进入编辑模式
 */
const enterEditMode = () => {
  isViewMode.value = false
  isEditMode.value = true
  originalProjectName.value = form.name
}

/**
 * 放弃修改
 */
const restoreEditProject = () => {
  const project = projects.value.find(p => p.id === selectedProjectId.value)
  if (project) {
    handleViewProject(project)
  } else {
    enterCreateMode()
  }
}

/**
 * 放弃修改前二次确�? */
const handleAbandonEdit = () => {
  import('element-plus').then(({ ElMessageBox, ElMessage }) => {
    ElMessageBox.confirm(
      '确定要放弃本次修改吗？放弃后，之前修改的数据将被还原？',
      '放弃修改提示',
      {
        confirmButtonText: '确认放弃',
        cancelButtonText: '返回继续',
        type: 'warning',
        confirmButtonClass: '!bg-red-500 !border-red-500 !text-white',
        cancelButtonClass: '!bg-neutral-800 !border-white/10 !text-white/60 hover:!text-white',
        customClass: 'danger-message-box',
        center: true,
      }
    ).then(() => {
      restoreEditProject()
      ElMessage.info('已放弃修改，数据已还原')
    }).catch(() => {
      // 继续编辑
    })
  })
}

/**
 * 进入创建模式
 */
const enterCreateMode = () => {
  isViewMode.value = false
  isEditMode.value = false
  selectedProjectId.value = null
  resetForm()
  form.isHistorical = false
  // 预加载客户列表，用于匹配已有客户
  handleClientVisibleChange(true)
}

/**
 * 放弃创建新项�?
 */
const handleAbandonCreate = () => {
  import('element-plus').then(({ ElMessageBox, ElMessage, ElLoading }) => {
    ElMessageBox.confirm(
      '确定要放弃创建新项目吗？如果已上传凭证、合同或预览图，这些文件将被永久删除？',
      '放弃创建提示',
      {
        confirmButtonText: '确认放弃',
        cancelButtonText: '返回继续',
        type: 'warning',
        confirmButtonClass: '!bg-red-500 !border-red-500 !text-white',
        cancelButtonClass: '!bg-neutral-800 !border-white/10 !text-white/60 hover:!text-white',
        customClass: 'danger-message-box',
        center: true,
      }
    ).then(async () => {
      // 如果有已上传的凭证、合同或预览图，需要清�?
      if (vouchers.value.length > 0 || contracts.value.length > 0 || previews.value.length > 0) {
        const loading = ElLoading.service({
          lock: true,
          text: '正在清理已上传的文件...',
          background: 'rgba(0, 0, 0, 0.7)',
        })
        
        try {
          // 循环删除凭证
          for (const voucher of vouchers.value) {
            await deleteVoucher({ id: voucher.id, fileId: voucher.fileId })
          }
          // 循环删除合同
          for (const contract of contracts.value) {
            await deleteContract({ id: contract.id, fileId: contract.fileId })
          }
          // 循环删除预览�?
          for (const preview of previews.value) {
            await deletePreview({ id: preview.id, fileId: preview.fileId })
          }
          ElMessage.success('已清理上传的文件')
        } catch (err) {
          console.error('清理文件失败:', err)
          ElMessage.error('部分文件清理失败，请手动检查')
        } finally {
          loading.close()
        }
      }
      
      // 重置状�?
      isViewMode.value = false
      isEditMode.value = false
      selectedProjectId.value = null
      resetForm()
      
      // 如果列表有数据，默认选中第一�?
      if (projects.value.length > 0) {
        handleViewProject(projects.value[0])
      }
      
      ElMessage.info('已放弃创建')
    }).catch(() => {
      // 继续创建
    })
  })
}

/**
 * 计算两个日期之间的天�?
 */
const calculateDiffDays = (start, end) => {
  if (!start || !end) return null;
  
  // 处理可能的时间戳对象 (TCB/Firestore 格式)
  const parseDate = (d) => {
    if (d instanceof Date) return d;
    if (typeof d === 'string' || typeof d === 'number') return new Date(d);
    if (d && typeof d === 'object') {
      if (typeof d.toDate === 'function') return d.toDate();
      if (d.seconds !== undefined) return new Date(d.seconds * 1000);
    }
    return new Date(d);
  };

  const s = parseDate(start);
  const e = parseDate(end);
  
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;
  
  // 抹除时间影响，只计算日期�?
  const sCopy = new Date(s);
  const eCopy = new Date(e);
  sCopy.setHours(0, 0, 0, 0);
  eCopy.setHours(0, 0, 0, 0);
  
  const diffTime = Math.abs(eCopy - sCopy);
  return Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
};

/**
 * 加载项目列表
 */
const loadProjects = async () => {
  loadingProjects.value = true
  try {
    const res = await listProjects()
    if (res.success || res.code === 0) {
      projects.value = res.data.map(p => {
        const statusConfig = projectStatuses.value.find(s => s.value === p.status)
        
        const isHistorical = !!(p.isHistorical || p.type === 'historical');
        
        // 计算周期
        let pDays;
        let conDays;
        let colDays;
        let pRange;
        let conRange;
        let colRange;

        const formatDate = (d) => d ? new Date(d).toLocaleDateString() : '-';

        if (p.type === 'historical') {
          // 补录单周期固定展�?-
          pDays = null;
          conDays = null;
          colDays = null;
          pRange = '-';
          conRange = '-';
          colRange = '-';
        } else if (isHistorical) {
          // 历史补录数据直接使用保存的周�?
          pDays = calculateDiffDays(p.period?.[0], p.period?.[1]);
          conDays = calculateDiffDays(p.constructionPeriod?.[0], p.constructionPeriod?.[1]);
          colDays = calculateDiffDays(p.collectionPeriod?.[0], p.collectionPeriod?.[1]);
          
          pRange = `${formatDate(p.period?.[0])} - ${formatDate(p.period?.[1])}`;
          conRange = `${formatDate(p.constructionPeriod?.[0])} - ${formatDate(p.constructionPeriod?.[1])}`;
          colRange = `${formatDate(p.collectionPeriod?.[0])} - ${formatDate(p.collectionPeriod?.[1])}`;
        } else {
          // 活跃项目根据时间节点计算
          const now = today.value.toISOString();
          const pStart = (p.type === 'long_term' ? (p.period && p.period[0]) : null) || p.negotiatingTime || (p.period && p.period[0]) || p.createTime;
          const pEnd = p.type === 'long_term'
            ? getLongTermPeriodEnd(p, now)
            : (p.settledTime || now);
          pDays = calculateDiffDays(pStart, pEnd);
          pRange = `${formatDate(pStart)} - ${formatDate(pEnd)}`;

          if (p.constructingTime) {
            const conEnd = p.completedTime || now;
            conDays = calculateDiffDays(p.constructingTime, conEnd);
            conRange = `${formatDate(p.constructingTime)} - ${formatDate(conEnd)}`;
          } else {
            conRange = '-';
          }

          if (p.settlingTime) {
            const colEnd = p.settledTime || now;
            colDays = calculateDiffDays(p.settlingTime, colEnd);
            colRange = `${formatDate(p.settlingTime)} - ${formatDate(colEnd)}`;
          } else {
            colRange = '-';
          }
        }

        const deliveryDate = p.type === 'long_term' && p.status === 'terminated'
          ? (p.period && p.period[1])
          : (p.type === 'historical' ? p.completionTime : p.completedTime);
        const createDate = p.createTime;

        return {
          ...p,
          isHistorical: isHistorical,
          id: p._id || p.id,
          type: p.type || (isHistorical ? 'historical' : 'normal'),
          typeLabel: projectTypes.value.find(t => t.value === (p.type || (isHistorical ? 'historical' : 'normal')))?.label || (isHistorical ? '补录' : '常规'),
          statusColor: p.status === 'constructing' ? 'bg-primary' : 'bg-secondary',
          statusText: statusConfig ? statusConfig.label : '未知状态',
          date: p.period ? new Date(p.period[0]).toLocaleDateString() : (p.negotiatingTime || p.createTime ? new Date(p.negotiatingTime || p.createTime).toLocaleDateString() : '-'),
          createTimeText: p.createTime ? new Date(p.createTime).toLocaleString() : '-',
          createDateText: createDate ? new Date(createDate).toLocaleDateString() : '-',
          deliveryDateText: deliveryDate ? new Date(deliveryDate).toLocaleDateString() : '-',
          projectDaysText: pDays ? `${pDays}天` : '-',
          constructionDaysText: conDays ? `${conDays}天` : '-',
          collectionDaysText: colDays ? `${colDays}天` : '-',
          projectRangeText: pRange,
          constructionRangeText: conRange,
          collectionRangeText: colRange
        }
      })
      
      // 如果有数据，默认选中最新的一�?
      if (projects.value.length > 0) {
        if (!selectedProjectId.value) {
          handleViewProject(projects.value[0])
        }
      } else {
        // 如果项目列表为空，默认进入新建项目模�?
        enterCreateMode()
      }
    }
  } catch (err) {
    console.error('加载项目列表失败:', err.message || err)
  } finally {
    loadingProjects.value = false
  }
}

/**
 * 重置表单
 */
const resetForm = () => {
  isLoadingProject.value = true
  Object.assign(form, {
    name: '',
    type: 'normal',
    scene: '',
    period: [null, null],
    startDate: new Date().toISOString().split('T')[0],
    constructionPeriod: [null, null],
    collectionPeriod: [null, null],
    completionTime: null,
    client: '',
    role: '',
    clientSource: '',
    status: 'negotiating', // 默认洽谈�?
    staffCount: null,
    amount: '',
    receivedAmount: null,
    desc: '',
    isHistorical: false,
    isHasContract: YES_NO_VALUE.NO,
    isHasPreview: YES_NO_VALUE.NO,
    isHasVoucher: YES_NO_VALUE.YES,
    amountEditCount: 0,
    subProjects: []
  })
  costs.value = []
  vouchers.value = []
  contracts.value = []
  previews.value = []
  isNewClient.value = true
  // 每次重置表单时生成新的临时ID
  currentTempId.value = `TEMP_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  
  setTimeout(() => {
    isLoadingProject.value = false
  }, 100)
}

// 安全校验：拦截特殊字�?
const isSafeInput = (str) => {
  if (!str) return true;
  // 拦截常见�?XSS �?SQL 注入字符
  const unsafePattern = /[<>{}[\]\\^%`|]/;
  return !unsafePattern.test(str);
};

// 格式化数�?
const formatNumber = (num) => {
  return Number(num).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// 财务快报计算逻辑
const totalOrderAmount = computed(() => {
  if (form.type === 'long_term') {
    return form.subProjects.reduce((sum, sp) => sum + (parseFloat(sp.amount) || 0), 0);
  }
  return parseFloat(form.amount) || 0;
});

const totalIncome = computed(() => {
  return totalOrderAmount.value;
});

const totalCost = computed(() => {
  return parseFloat(payableAmount.value) || 0;
});

const estimatedProfit = computed(() => {
  return totalIncome.value - totalCost.value;
});

const profitMargin = computed(() => {
  if (totalIncome.value === 0) return '0.00';
  return ((estimatedProfit.value / totalIncome.value) * 100).toFixed(2);
});

// 成本构成分析数据
const costAnalysisData = computed(() => {
  let allCosts = [];
  if (form.type === 'long_term') {
    form.subProjects.forEach(sp => {
      if (sp.costs) allCosts = allCosts.concat(sp.costs);
    });
  } else {
    allCosts = costs.value;
  }

  if (allCosts.length === 0 || totalCost.value === 0) return [];
  
  // 按类别汇�?
  const summary = {};
  allCosts.forEach(item => {
    if (item.category && item.amount) {
      summary[item.category] = (summary[item.category] || 0) + parseFloat(item.amount);
    }
  });

  // 定义颜色映射 (使用英文 Value 作为 Key 以确保匹�?
  const colorMap = {
    'real_plant': { color: 'bg-emerald-500/30', hover: 'hover:bg-emerald-500/50' },
    'artificial_plant': { color: 'bg-cyan-500/30', hover: 'hover:bg-cyan-500/50' },
    'materials': { color: 'bg-amber-500/30', hover: 'hover:bg-amber-500/50' },
    'labor': { color: 'bg-purple-500/30', hover: 'hover:bg-purple-500/50' },
    'other': { color: 'bg-rose-500/30', hover: 'hover:bg-rose-500/50' },
    // 兼容中文 Key
    '真植': { color: 'bg-emerald-500/30', hover: 'hover:bg-emerald-500/50' },
    '仿真': { color: 'bg-cyan-500/30', hover: 'hover:bg-cyan-500/50' },
    '辅材': { color: 'bg-amber-500/30', hover: 'hover:bg-amber-500/50' },
    '人工': { color: 'bg-purple-500/30', hover: 'hover:bg-purple-500/50' },
    '其他': { color: 'bg-rose-500/30', hover: 'hover:bg-rose-500/50' }
  };

  return Object.keys(summary).map(key => {
    const percentage = ((summary[key] / totalCost.value) * 100).toFixed(1);
    // 从全局配置中查找对应的中文 Label
    const configItem = costCategories.value.find(c => c.value === key);
    const label = configItem ? configItem.label : key;

    return {
      label: label,
      percentage: parseFloat(percentage),
      ...(colorMap[key] || { color: 'bg-neutral-500/20', hover: 'hover:bg-neutral-500/40' })
    };
  }).sort((a, b) => b.percentage - a.percentage); // 按比例降序排�?
});

/**
 * 校验表单完整�?
 */
const validateProjectForm = (checkVouchers = true) => {
  if (!form.name) return '请输入项目名称';
  if (!isSafeInput(form.name)) return '项目名称包含非法字符';
  
  if (form.type === 'historical') {
    if (!form.completionTime) return '请选择交付日期';
    if (new Date(form.completionTime) > new Date()) return '交付日期不能晚于当前时间';
  } else {
    // 常规项目新建时，禁止选择「已结清」状�?
    if (isCreating.value && form.status === 'closed') {
      return '常规项目新建时，禁止选择「已结清」状态';
    }

    // 新建项目模式：校验开始日期
    if (isCreating.value) {
      if (!form.startDate) return '请选择项目开始日期';
      if (new Date(form.startDate) > new Date()) return '项目开始日期不能晚于当前日期';
    } else {
      // 历史模式或编辑模式：校验项目周期
      if (!form.period || !form.period[0] || !form.period[1]) return '请选择项目周期';
    }
  }

  if (checkVouchers) {
    if (form.isHasContract === YES_NO_VALUE.YES && contracts.value.length === 0) return '请上传至少一个合同文件';
    if (form.isHasPreview === YES_NO_VALUE.YES && previews.value.length === 0) return '请上传至少一张预览图';
  }
  
  if (!form.client) return '请输入客户名称';
  if (!isSafeInput(form.client)) return '客户名称包含非法字符';

  if (!form.role) return '请选择客户角色';
  
  if (isNewClient.value && !form.clientSource) return '请选择新客户来源';

  if (!form.status) return '请选择项目状态';
  if (!form.scene) return '请选择项目场景';

  if (form.type !== 'long_term') {
    if (form.staffCount === null || form.staffCount === undefined) return '请输入人员数量';
    
    if (!form.amount) return '请输入订单金额';
    if (isNaN(parseFloat(form.amount))) return '订单金额必须为数字';
  } else {
    if (form.subProjects.length === 0) return '长期项目请至少添加一个子项目';
    for (let i = 0; i < form.subProjects.length; i++) {
      const sp = form.subProjects[i];
      if (!sp.content) return `子项目 ${i + 1} 请选择项目内容`;
      if (!sp.startDate) return `子项目 ${i + 1} 请选择开始日期`;
      if (new Date(sp.startDate) > new Date()) return `子项目 ${i + 1} 开始日期不能晚于当前日期`;
      if (sp.amount === null || sp.amount === undefined) return `子项目 ${i + 1} 请输入订单金额`;
      
      if (checkVouchers && sp.isHasVoucher === YES_NO_VALUE.YES) {
        if (!sp.vouchers || sp.vouchers.length === 0) return `子项目 ${i + 1} 已开启发票凭证，请上传凭证图片`;
      }
    }
  }

  const received = parseFloat(form.receivedAmount) || 0;
  const total = totalOrderAmount.value;
  if (received > total) return '已收账款不可超过订单金额';

  if (!form.desc) return '请输入项目描述';
  if (!isSafeInput(form.desc)) return '项目描述包含非法字符';
  
  if (form.type !== 'long_term' && costs.value.length === 0) return '请至少添加一个成本项';
  
  for (const cost of costs.value) {
    if (!cost.category || cost.amount === undefined || cost.amount === null) return '请完善成本项信息';
    if (isNaN(parseFloat(cost.amount))) return '成本金额必须为数字';
  }

  if (checkVouchers && form.type !== 'long_term' && form.isHasVoucher === YES_NO_VALUE.YES && vouchers.value.length === 0) {
    return '请上传至少一张凭证照片';
  }
  
  return null;
}

/**
 * 确认保存修改（带弹窗提醒�?
 */
const confirmSaveUpdate = () => {
  const currentProject = projects.value.find(p => p.id === selectedProjectId.value);
  const isAmountChanged = currentProject && Number(form.amount) !== Number(currentProject.amount);
  
  // 如果金额发生变化且尚未修改过（次数为0），则显示特殊提�?
  const showAmountWarning = isAmountChanged && (form.amountEditCount || 0) === 0;
  
    const message = showAmountWarning 
      ? '检测到您修改了“订单金额”。注意：订单金额只能修改一次，是否确认修改？'
      : '确认保存对该项目的修改吗？';

  import('element-plus').then(({ ElMessageBox }) => {
    ElMessageBox.confirm(
      message,
      showAmountWarning ? '温馨提示' : '保存确认',
      {
        confirmButtonText: showAmountWarning ? '确认修改' : '确认保存',
        cancelButtonText: '取消返回',
        type: 'warning',
        confirmButtonClass: showAmountWarning ? '!bg-red-500 !border-red-500 !text-white' : '',
        cancelButtonClass: showAmountWarning ? '!bg-neutral-800 !border-white/10 !text-white/60 hover:!text-white' : '',
        customClass: showAmountWarning ? 'danger-message-box' : 'custom-message-box',
        center: showAmountWarning ? true : false,
      }
    ).then(() => {
      handleSaveProject()
    }).catch(() => {
      // 取消操作
    })
  })
}

/**
 * 保存/创建项目
 */
const handleSaveProject = async () => {
  const error = validateProjectForm(true);
  if (error) {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.warning(error)
    })
    return
  }

  savingProject.value = true
  try {
    const shouldSyncNewClient = !isEditMode.value && isNewClient.value && !!form.client?.trim()
    // 1. 手动构建提交数据，彻底避免循环引用
    const projectData = {
      name: form.name,
      type: form.type,
      scene: form.scene,
      sceneLabel: projectScenes.value.find(item => item.value === form.scene)?.label || '',
      client: form.client,
      role: form.role,
      clientSource: form.clientSource,
      status: form.status,
      staffCount: form.type === 'long_term' ? 0 : Number(form.staffCount),
      amount: Number(totalOrderAmount.value),
      receivedAmount: Number(form.receivedAmount),
      desc: form.desc,
      isHistorical: !!form.isHistorical,
      isHasContract: form.isHasContract,
      isHasPreview: form.isHasPreview,
      isHasVoucher: form.isHasVoucher,
      completionTime: form.completionTime ? new Date(form.completionTime).toISOString() : null,
      costs: costs.value.map(item => ({
        category: item.category,
        supplier: item.supplier,
        amount: Number(item.amount),
        isSettled: isCostSettled(item.isSettled)
      })),
      subProjects: form.subProjects.map(sp => ({
        id: sp.id,
        content: sp.content,
        startDate: sp.startDate,
        amount: Number(sp.amount),
        isHasVoucher: normalizeYesNo(sp.isHasVoucher, YES_NO_VALUE.NO),
        vouchers: sp.vouchers || [],
        costs: (sp.costs || []).map(c => ({
          id: c.id,
          category: c.category,
          supplier: c.supplier,
          amount: Number(c.amount),
          isSettled: isCostSettled(c.isSettled)
        }))
      }))
    }

    // 处理周期数据
    if (form.type === 'historical') {
      projectData.period = null;
      projectData.constructionPeriod = null;
      projectData.collectionPeriod = null;
      projectData.negotiatingTime = null;
    } else if (isCreating.value) {
      // 新建项目模式：项目周期开始日期为选择日期，结束日期为系统当前日期
      const startDateStr = form.startDate || new Date().toISOString().split('T')[0];
      const date = new Date(startDateStr).toISOString();
      const today = startDateStr;
      const systemToday = new Date().toISOString().split('T')[0];
      projectData.period = [today, systemToday];
      projectData.negotiatingTime = date; // 记录项目周期开始时�?
      projectData.createTime = new Date().toISOString();
      
      // 根据初始状态初始化其他周期
      if (form.status === 'constructing') {
        projectData.constructingTime = date;
        projectData.constructionPeriod = [today, today];
      } else if (form.status === 'completed') {
        projectData.constructingTime = date;
        projectData.completedTime = date;
        projectData.constructionPeriod = [today, today];
      } else if (form.status === 'settling') {
        projectData.constructingTime = date;
        projectData.completedTime = date;
        projectData.settlingTime = date;
        projectData.constructionPeriod = [today, today];
        projectData.collectionPeriod = [today, today];
      }
    } else {
      // 历史模式或编辑模�?
      // 常规项目编辑模式下，不发送项目类型及三大周期，由后端逻辑自动处理
      // 注意：长期项目需要保留类型，避免被误判为常规项目
      if (form.type !== 'historical' && form.type !== 'long_term' && isEditMode.value) {
        delete projectData.type;
        delete projectData.period;
        delete projectData.constructionPeriod;
        delete projectData.collectionPeriod;
      } else {
        if (form.type === 'long_term') {
          delete projectData.period;
        } else {
          projectData.period = (form.period && form.period[0] && form.period[1]) ? [new Date(form.period[0]).toISOString(), new Date(form.period[1]).toISOString()] : [];
        }
        
        if (form.isHistorical) {
          projectData.constructionPeriod = (form.constructionPeriod && form.constructionPeriod[0] && form.constructionPeriod[1]) ? [new Date(form.constructionPeriod[0]).toISOString(), new Date(form.constructionPeriod[1]).toISOString()] : [];
          projectData.collectionPeriod = (form.collectionPeriod && form.collectionPeriod[0] && form.collectionPeriod[1]) ? [new Date(form.collectionPeriod[0]).toISOString(), new Date(form.collectionPeriod[1]).toISOString()] : [];
        }
      }
      
      // 如果是编辑活跃项目，确保保留或更新开始时�?
      if (form.startDate) {
        projectData.negotiatingTime = new Date(form.startDate).toISOString();
      }
    }
    
    let res;
    
    // 补录单据特殊逻辑：如果是补录单据且状态是“结账中”，清空回款周期
    if (projectData.isHistorical && projectData.status === 'settling') {
      projectData.collectionPeriod = null;
    }

    if (isEditMode.value && selectedProjectId.value) {
      // 更新项目
      res = await updateProject({
        id: selectedProjectId.value,
        ...projectData
      })
    } else {
      // 创建项目
      res = await createProject({
        ...projectData,
        contractFileIds: contracts.value.map(c => c.id),
        previewFileIds: previews.value.map(p => p.id)
      })
    }
    
    if (res.success || res.code === 0) {
      const projectId = isEditMode.value ? selectedProjectId.value : res.data.id
      
      // 2. 如果项目名称修改了，同步修改云存储中的路�?
      if (isEditMode.value && originalProjectName.value && originalProjectName.value !== form.name) {
        console.log(`项目名称已修�? ${originalProjectName.value} -> ${form.name}，同步云存储路径...`)
        try {
          // 同步凭证路径
          await renameProjectVouchers({
            projectId,
            oldName: originalProjectName.value,
            newName: form.name
          })
          // 同步合同与预览图路径
          await renameProjectFiles({
            projectId,
            oldName: originalProjectName.value,
            newName: form.name
          })
        } catch (err) {
          console.error('同步云存储路径失�?', err)
          // 路径同步失败不应阻断项目保存，但记录错误
        }
      }

      // 3. 关联凭证
      if (vouchers.value.length > 0) {
        const voucherIds = vouchers.value.map(v => v.id)
        await updateVouchersProject({
          voucherIds,
          projectId
        })
      }

      // 4. 关联合同
      if (contracts.value.length > 0) {
        const fileIds = contracts.value.map(c => c.id)
        await updateContractsProject({
          fileIds,
          projectId
        })
      }

      // 5. 关联预览�?
      if (previews.value.length > 0) {
        const fileIds = previews.value.map(p => p.id)
        await updatePreviewsProject({
          fileIds,
          projectId
        })
      }

      if (shouldSyncNewClient) {
        try {
          await syncNewClientAfterProjectCreate()
        } catch (error) {
          import('element-plus').then(({ ElMessage }) => {
            ElMessage.warning('项目已保存，但新客户同步失败，请稍后在客户管理中补充')
          })
        }
      }

      import('element-plus').then(({ ElMessage }) => {
        ElMessage.success(isEditMode.value ? '项目更新成功' : '项目创建成功')
      })
      
      // 立即更新本地列表数据，确�?UI 实时响应
      const statusConfig = projectStatuses.value.find(s => s.value === form.status)
      
      // 如果金额发生了变化且是编辑模式，本地模拟增加修改次数
      let localAmountEditCount = form.amountEditCount || 0
      if (isEditMode.value && Number(form.amount) !== Number(projects.value.find(p => p.id === projectId)?.amount)) {
        localAmountEditCount += 1
      }

      const updatedItem = {
        ...projectData,
        id: projectId,
        amountEditCount: localAmountEditCount,
        statusText: statusConfig ? statusConfig.label : '未知状态',
        statusColor: form.status === 'constructing' ? 'bg-primary' : 'bg-secondary',
        date: form.period ? new Date(form.period[0]).toLocaleDateString() : '-',
        createTimeText: new Date().toLocaleString() // 新建时默认当前时间，后续 loadProjects 会刷新为真实时间
      }
      
      const index = projects.value.findIndex(p => p.id === projectId)
      if (index !== -1) {
        // 使用 splice 确保响应式更�?
        projects.value.splice(index, 1, updatedItem)
      } else {
        projects.value.unshift(updatedItem)
      }

      // 强制重置编辑状�?
      isEditMode.value = false
      isViewMode.value = true
      
      // 异步加载最新列表，不阻�?UI 响应
      loadProjects()
      
      // 保持当前选中项并回显
      selectedProjectId.value = projectId
      handleViewProject(updatedItem)
    } else {
      throw new Error(res.message)
    }
  } catch (err) {
    console.error('保存项目失败:', err.message || err)
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.error(`保存失败: ${err.message || '未知错误'}`)
    })
  } finally {
    savingProject.value = false
  }
}

/**
 * 处理合同上传
 */
const handleContractUpload = async (event) => {
  const error = validateProjectForm(false);
  if (error) {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.warning(`请先完善项目基础信息：${error}`)
    })
    event.target.value = ''
    return
  }

  const files = Array.from(event.target.files)
  if (!files.length) return

  if (contracts.value.length + files.length > 10) {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.warning('合同文件最多只能上传 10 个')
    })
    return
  }

  uploadingContract.value = true
  
  try {
    const uploadPromises = files.map(async (file) => {
      try {
        // 校验类型
        const isPdf = file.type === 'application/pdf';
        const isImage = file.type.startsWith('image/');
        if (!isPdf && !isImage) {
          import('element-plus').then(({ ElMessage }) => {
            ElMessage.error(`文件 ${file.name} 格式不支持，仅支持图片或PDF`)
          })
          return null
        }

        // 校验大小
        if (isPdf && file.size > 10 * 1024 * 1024) {
          import('element-plus').then(({ ElMessage }) => {
            ElMessage.error(`PDF文件 ${file.name} 超过10MB限制`)
          })
          return null
        }
        if (isImage && file.size > 5 * 1024 * 1024) {
          import('element-plus').then(({ ElMessage }) => {
            ElMessage.error(`图片文件 ${file.name} 超过5MB限制`)
          })
          return null
        }

        let uploadFile = file;
        if (isImage) {
          uploadFile = await compressImage(file);
        }

        const formData = new FormData()
        formData.append('file', uploadFile, file.name)
        formData.append('type', 'contract')
        formData.append('projectId', selectedProjectId.value || currentTempId.value)
        formData.append('projectName', form.name)
        
        const response = await axios.post(`${apiDomain}/contractPreviewService`, formData, {
          timeout: 60000,
          headers: { 'Content-Type': 'multipart/form-data' }
        })
        
        if (response.data.code === 0) {
          return {
            id: response.data.data.id,
            fileId: response.data.data.fileId,
            url: response.data.data.url,
            name: response.data.data.name,
            type: response.data.data.type
          }
        } else {
          throw new Error(response.data.message)
        }
      } catch (err) {
        console.error(`上传合同 ${file.name} 失败:`, err)
        return null
      }
    })

    const results = await Promise.all(uploadPromises)
    const successfulUploads = results.filter(Boolean)
    if (successfulUploads.length > 0) {
      contracts.value.push(...successfulUploads)
      // 自动切换状态为“是�?
      form.isHasContract = YES_NO_VALUE.YES
      import('element-plus').then(({ ElMessage }) => {
        ElMessage.success(`成功上传 ${successfulUploads.length} 个合同文件`)
      })
    }
  } catch (error) {
    console.error('上传合同失败:', error)
  } finally {
    uploadingContract.value = false
    event.target.value = ''
  }
}

/**
 * 处理预览图上�?
 */
const handlePreviewUpload = async (event) => {
  const error = validateProjectForm(false);
  if (error) {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.warning(`请先完善项目基础信息：${error}`)
    })
    event.target.value = ''
    return
  }

  const files = Array.from(event.target.files)
  if (!files.length) return

  if (previews.value.length + files.length > 4) {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.warning('预览图最多只能上传 4 张')
    })
    return
  }

  uploadingPreview.value = true
  
  try {
    const uploadPromises = files.map(async (file) => {
      try {
        if (!file.type.startsWith('image/')) {
          import('element-plus').then(({ ElMessage }) => {
            ElMessage.error(`文件 ${file.name} 不是图片格式`)
          })
          return null
        }

        if (file.size > 5 * 1024 * 1024) {
          import('element-plus').then(({ ElMessage }) => {
            ElMessage.error(`图片 ${file.name} 超过5MB限制`)
          })
          return null
        }

        const compressedFile = await compressImage(file);

        const formData = new FormData()
        formData.append('file', compressedFile, file.name)
        formData.append('type', 'preview')
        formData.append('projectId', selectedProjectId.value || currentTempId.value)
        formData.append('projectName', form.name)
        
        const response = await axios.post(`${apiDomain}/contractPreviewService`, formData, {
          timeout: 60000,
          headers: { 'Content-Type': 'multipart/form-data' }
        })
        
        if (response.data.code === 0) {
          return {
            id: response.data.data.id,
            fileId: response.data.data.fileId,
            url: response.data.data.url,
            name: response.data.data.name,
            type: response.data.data.type
          }
        } else {
          throw new Error(response.data.message)
        }
      } catch (err) {
        console.error(`上传预览图 ${file.name} 失败:`, err)
        return null
      }
    })

    const results = await Promise.all(uploadPromises)
    const successfulUploads = results.filter(Boolean)
    if (successfulUploads.length > 0) {
      previews.value.push(...successfulUploads)
      // 自动切换状态为“是�?
      form.isHasPreview = YES_NO_VALUE.YES
      import('element-plus').then(({ ElMessage }) => {
        ElMessage.success(`成功上传 ${successfulUploads.length} 张预览图`)
      })
    }
  } catch (error) {
    console.error('上传预览图失败', error)
  } finally {
    uploadingPreview.value = false
    event.target.value = ''
  }
}

/**
 * 删除合同
 */
const removeContract = async (index) => {
  const item = contracts.value[index]
  item.deleting = true
  try {
    await deleteContract({ id: item.id, fileId: item.fileId })
    contracts.value.splice(index, 1)
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.success('合同文件已删除')
    })
  } catch (err) {
    console.error('删除合同失败:', err)
    item.deleting = false
  }
}

/**
 * 删除预览�?
 */
const removePreview = async (index) => {
  const item = previews.value[index]
  item.deleting = true
  try {
    await deletePreview({ id: item.id, fileId: item.fileId })
    previews.value.splice(index, 1)
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.success('预览图已删除')
    })
  } catch (err) {
    console.error('删除预览图失败', err)
    item.deleting = false
  }
}

/**
 * 预览合同
 */
const handleContractPreview = (index) => {
  const item = contracts.value[index]
  if (item.type === 'application/pdf') {
    window.open(item.url, '_blank')
  } else {
    previewList.value = contracts.value.filter(c => c.type !== 'application/pdf').map(c => c.url)
    const currentUrl = item.url
    initialIndex.value = previewList.value.indexOf(currentUrl)
    previewVisible.value = true
  }
}

/**
 * 预览预览�?
 */
const handlePreviewImagePreview = (index) => {
  previewList.value = previews.value.map(p => p.url)
  initialIndex.value = index
  previewVisible.value = true
}
/**
 * 上传子项目凭�?
 */
const handleSubProjectVoucherUpload = async (event, subProject) => {
  const files = Array.from(event.target.files)
  if (!files.length) return

  if ((subProject.vouchers?.length || 0) + files.length > 10) {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.warning('每个子项目最多只能上传 10 张凭证')
    })
    return
  }

  subProject.uploading = true
  
  try {
    const uploadPromises = files.map(async (file) => {
      try {
        const validTypes = ['image/jpeg', 'image/png', 'image/gif']
        if (!validTypes.includes(file.type)) {
          import('element-plus').then(({ ElMessage }) => {
            ElMessage.error(`文件 ${file.name} 格式不支持`)
          })
          return null
        }
        
        if (file.size > 5 * 1024 * 1024) {
          import('element-plus').then(({ ElMessage }) => {
            ElMessage.error(`文件 ${file.name} 超过 5MB`)
          })
          return null
        }
        
        const compressedFile = await compressImage(file)
        
        const formData = new FormData()
        formData.append('action', 'upload')
        formData.append('file', compressedFile, file.name)
        formData.append('fileName', file.name)
        formData.append('fileType', file.type)
        formData.append('projectName', form.name)
        
        const response = await axios.post(`${apiDomain}/voucherService`, formData, {
          timeout: 60000,
          headers: { 'Content-Type': 'multipart/form-data' }
        })
        
        if (response.data.code === 0) {
          // 子项目凭证直接记录在子项目对象中，不单独调用 addVoucher 记录�?vouchers 集合
          // 这样可以简化长期项目的复杂嵌套数据管理
          return {
            id: `SUB_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            fileId: response.data.data.fileId,
            url: response.data.data.url,
            name: file.name
          }
        }
        return null
      } catch (err) {
        console.error('子项目凭证上传失败', err)
        return null
      }
    })

    const results = await Promise.all(uploadPromises)
    const successfulUploads = results.filter(Boolean)
    
    if (successfulUploads.length > 0) {
      if (!subProject.vouchers) subProject.vouchers = []
      subProject.vouchers.push(...successfulUploads)
      import('element-plus').then(({ ElMessage }) => {
        ElMessage.success(`成功上传 ${successfulUploads.length} 张子项目凭证`)
      })
    }
  } catch (error) {
    console.error('上传失败:', error)
  } finally {
    subProject.uploading = false
    event.target.value = ''
  }
}

/**
 * 预览子项目凭�?
 */
const handleSubProjectVoucherPreview = (subProject, index) => {
  previewList.value = subProject.vouchers.map(v => v.url)
  initialIndex.value = index
  previewVisible.value = true
}

/**
 * 移除子项目凭�?
 */
const removeSubProjectVoucher = async (subProject, index) => {
  if (isViewMode.value) return
  
  const voucher = subProject.vouchers[index]
  if (!voucher) return

  voucher.deleting = true
  try {
    // 仅删除云存储文件，因为子项目凭证没有单独的数据库记录
    const formData = new FormData()
    formData.append('action', 'delete')
    formData.append('fileId', voucher.fileId)
    
    await axios.post(`${apiDomain}/voucherService`, formData)
    
    subProject.vouchers.splice(index, 1)
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.success('凭证已删除')
    })
  } catch (error) {
    console.error('删除凭证失败:', error)
    voucher.deleting = false
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.error('删除失败')
    })
  }
}

/**
 * 上传凭证
 */
const handleVoucherUpload = async (event) => {
  if (form.isHasVoucher !== YES_NO_VALUE.YES) {
    event.target.value = ''
    return
  }

  // 0. 拦截校验：必须先填写基础信息和成本
  const error = validateProjectForm(false);
  if (error) {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.warning(`请先完善项目基础信息和成本项：${error}`)
    })
    // 清空 input
    event.target.value = ''
    return
  }

  const files = Array.from(event.target.files)
  if (!files.length) return

  // 1. 校验数量
  if (vouchers.value.length + files.length > 20) {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.warning('总计最多只能上传 20 张凭证')
    })
    return
  }

  uploadingVoucher.value = true
  
  try {
    const uploadPromises = files.map(async (file, index) => {
      console.log(`📤 开始上传文件 ${index + 1}/${files.length}:`, file.name)
      
      try {
        // 检查文件类�?
        const validTypes = ['image/jpeg', 'image/png', 'image/gif']
        if (!validTypes.includes(file.type)) {
          import('element-plus').then(({ ElMessage }) => {
            ElMessage.error('只支持 JPG、PNG、GIF 格式的图片')
          })
          return null
        }
        
        // 检查原始文件大小（限制�?MB�?
        if (file.size > 5 * 1024 * 1024) {
          import('element-plus').then(({ ElMessage }) => {
            ElMessage.error('图片过大，请选择小于 5MB 的图片')
          })
          return null
        }
        
        // 压缩图片（使�?Compressor 三方库）
        console.log(`🔄 压缩图片...`)
        const compressedFile = await compressImage(file)
        
        // 检查压缩后文件大小（限制为4MB，考虑到multipart/form-data的头部信息）
        if (compressedFile.size > 4 * 1024 * 1024) {
          import('element-plus').then(({ ElMessage }) => {
            ElMessage.error('压缩后图片仍过大，请选择尺寸较小的图片')
          })
          return null
        }
        
        // 创建FormData对象
        const formData = new FormData()
        formData.append('action', 'upload')
        formData.append('file', compressedFile, file.name)
        formData.append('fileName', file.name)
        formData.append('fileType', file.type)
        formData.append('projectName', form.name) // 传递项目名称用于文件夹分类
        
        // 发送请求到云函�?
        console.log(`📡 上传到云函数...`)
        const response = await axios.post(`${apiDomain}/voucherService`, formData, {
          timeout: 60000, // 60秒超�?
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        })
        
        if (response.data.code === 0) {
          console.log(`✅ 上传成功，URL: ${response.data.data.url}`)
          
          // 调用云函数记录到数据�?(初始 projectId 为空或临时�?
          console.log(`📝 记录到数据库...`)
          const dbRes = await addVoucher({
            projectId: currentTempId.value, 
            fileName: file.name,
            fileId: response.data.data.fileId,
            fileUrl: response.data.data.url,
            fileSize: compressedFile.size,
            mimeType: file.type
          })

          console.log(`✅ 数据库记录成功，ID: ${dbRes.data.id}`)

          return {
            id: dbRes.data.id,
            fileId: response.data.data.fileId,
            url: response.data.data.url,
            name: file.name
          }
        } else {
          console.error(`❌ 文件 ${file.name} 上传失败:`, response.data.message)
          import('element-plus').then(({ ElMessage }) => {
            ElMessage.error(`文件 ${file.name} 上传失败: ${response.data.message}`)
          })
          return null
        }
      } catch (uploadError) {
        console.error(`❌ 文件 ${file.name} 上传失败:`, uploadError.message || uploadError)
        import('element-plus').then(({ ElMessage }) => {
          ElMessage.error(`文件 ${file.name} 上传失败: ${uploadError.message || '未知错误'}`)
        })
        return null
      }
    })

    const results = await Promise.all(uploadPromises)
    const successfulUploads = results.filter(Boolean)
    
    if (successfulUploads.length > 0) {
      vouchers.value.push(...successfulUploads)
      console.log(`✅ 成功上传 ${successfulUploads.length} 张凭证`)
      import('element-plus').then(({ ElMessage }) => {
        ElMessage.success(`成功上传 ${successfulUploads.length} 张凭证`)
      })
    } else {
      console.log(`❌ 所有文件上传失败`)
      import('element-plus').then(({ ElMessage }) => {
        ElMessage.error('所有文件上传失败，请稍后再试')
      })
    }
  } catch (error) {
    console.error('上传失败:', error.message || error)
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.error('上传失败，请稍后再试')
    })
  } finally {
    uploadingVoucher.value = false
    // 清空 input 方便下次选择同一文件
    event.target.value = ''
  }
}

/**
 * 删除凭证
 */
const removeVoucher = async (index) => {
  if (isViewMode.value) return
  
  const voucher = vouchers.value[index]
  if (!voucher) return

  voucher.deleting = true
  try {
    // 调用整合后的云函数进行删除（包含数据库记录和云存储文件）
    await deleteVoucher({
      id: voucher.id,
      fileId: voucher.fileId
    })
    
    vouchers.value.splice(index, 1)
    
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.success('凭证已删除')
    })
  } catch (error) {
    console.error('删除凭证失败:', error.message || error)
    voucher.deleting = false
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.error('删除失败，请稍后再试')
    })
  }
}

const tableRowClassName = ({ row }) => {
  if (row.id === selectedProjectId.value) {
    return 'active-project-row'
  }
  return ''
}

const handleLogout = () => {
  stopSessionActivityWatcher()
  localStorage.removeItem('isLoggedIn')
  localStorage.removeItem('token')
  localStorage.removeItem('userInfo')
  router.push('/loginService')
}
</script>

<style>
/* 统一禁用状态下的鼠标样�?*/
.is-disabled, 
.is-disabled *,
[disabled],
[disabled] *,
.el-input.is-disabled .el-input__wrapper,
.el-select.is-disabled .el-select__wrapper,
.el-date-editor.is-disabled,
.el-input-number.is-disabled .el-input__wrapper,
.el-textarea.is-disabled .el-textarea__inner,
.cursor-not-allowed {
  cursor: not-allowed !important;
}

/* Custom Scrollbar */
::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: #131314;
}
::-webkit-scrollbar-thumb {
  background: #2a2a2b;
  border-radius: 10px;
}
::-webkit-scrollbar-thumb:hover {
  background: #52ee8a;
}

.el-table__row {
  cursor: pointer;
  transition: all 0.3s;
}
.el-table__row:hover {
  background-color: rgba(255, 255, 255, 0.02) !important;
}

/* Custom Dropdown Styles */
.custom-dropdown {
  background: #1c1b1c !important;
  backdrop-filter: blur(20px) !important;
  border: 1px solid rgba(82, 238, 138, 0.15) !important;
  border-radius: 12px !important;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.8) !important;
  padding: 8px !important;
}

.custom-dropdown .el-select-dropdown__list {
  padding: 0 !important;
}

.custom-dropdown .el-select-dropdown__item {
  color: rgba(229, 226, 227, 0.7) !important;
  height: 44px !important;
  line-height: 44px !important;
  border-radius: 8px !important;
  margin-bottom: 4px !important;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
  font-size: 14px !important;
  background-color: transparent !important;
  padding: 0 16px !important;
  position: relative !important;
}

.custom-dropdown .el-select-dropdown__item:last-child {
  margin-bottom: 0 !important;
}

/* Hover/Active State - Aggressive override to remove white background */
.custom-dropdown .el-select-dropdown__item.hover,
.custom-dropdown .el-select-dropdown__item.is-hovering,
.custom-dropdown .el-select-dropdown__item:hover {
  background-color: rgba(82, 238, 138, 0.1) !important;
  color: #52ee8a !important;
  padding-left: 28px !important;
}

/* Selected State */
.custom-dropdown .el-select-dropdown__item.selected {
  background-color: rgba(82, 238, 138, 0.15) !important;
  color: #52ee8a !important;
  font-weight: 700 !important;
  padding-left: 28px !important;
}

/* Indicator for Hover/Selected */
.custom-dropdown .el-select-dropdown__item.hover::before,
.custom-dropdown .el-select-dropdown__item.is-hovering::before,
.custom-dropdown .el-select-dropdown__item:hover::before,
.custom-dropdown .el-select-dropdown__item.selected::before {
  content: '';
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 4px;
  height: 12px;
  background: #52ee8a;
  border-radius: 2px;
  box-shadow: 0 0 10px rgba(82, 238, 138, 0.5);
}

/* Hide default selected checkmark if any */
.custom-dropdown .el-select-dropdown__item.selected::after {
  display: none !important;
}

/* Popper Arrow */
.el-popper.is-light .el-popper__arrow::before {
  background: rgba(28, 27, 28, 0.95) !important;
  border: 1px solid rgba(82, 238, 138, 0.1) !important;
}

/* High-end Input Focus Effects */
.custom-input .el-input__wrapper,
.custom-select .el-select__wrapper,
.custom-select-small .el-select__wrapper,
.custom-date-picker.el-range-editor,
.custom-number-input .el-input__wrapper,
.custom-textarea .el-textarea__inner {
  background-color: rgba(255, 255, 255, 0.03) !important;
  border: 1px solid rgba(255, 255, 255, 0.05) !important;
  box-shadow: none !important;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1) !important;
}

.custom-select-small .el-select__placeholder,
.custom-select-small .el-select__selected-item {
  color: #e5e2e3 !important;
  font-weight: 500 !important;
  font-size: 14px !important;
}

/* 供应商列文字颜色较浅 */
.supplier-select .el-select__selected-item {
  color: #bbcbba !important;
}

.custom-select-small .el-select__wrapper {
  background-color: transparent !important;
  border-color: transparent !important;
  padding: 0 4px !important;
  box-shadow: none !important;
  transition: all 0.3s !important;
}

/* 鼠标悬浮在行上时，下拉框背景略微显现以提示可编辑 */
.group:hover .custom-select-small .el-select__wrapper {
  background-color: rgba(255, 255, 255, 0.02) !important;
}

.cost-amount-input {
  color: #e5e2e3 !important;
  font-weight: 500 !important;
}

.custom-input .el-input__wrapper.is-focus,
.custom-select .el-select__wrapper.is-focused,
.custom-select-small .el-select__wrapper.is-focused,
.custom-date-picker.is-active,
.custom-number-input .el-input__wrapper.is-focus,
.custom-textarea .el-textarea__inner:focus {
  background-color: rgba(82, 238, 138, 0.02) !important;
  border-color: rgba(82, 238, 138, 0.5) !important;
  box-shadow: 0 0 0 4px rgba(82, 238, 138, 0.05), 0 0 20px rgba(82, 238, 138, 0.1) !important;
}

/* Select Input Text Color Fix */
.custom-select .el-select__placeholder {
  color: rgba(229, 226, 227, 0.3) !important;
}

.custom-select .el-select__selected-item {
  color: #52ee8a !important;
  font-weight: 600 !important;
}

/* Date Picker Range Fix */
.el-range-editor.is-active:hover {
  border-color: rgba(82, 238, 138, 0.5) !important;
}

.el-picker-panel {
  background: #1c1b1c !important;
  border: 1px solid rgba(82, 238, 138, 0.1) !important;
  color: #e5e2e3 !important;
}

/* High-end Image Viewer Styling */
.el-image-viewer__mask {
  background-color: rgba(255, 255, 255, 0.85) !important;
  backdrop-filter: blur(12px) !important;
}

.el-image-viewer__btn {
  color: #1a1a1a !important;
  background-color: rgba(0, 0, 0, 0.05) !important;
  border: 1px solid rgba(0, 0, 0, 0.1) !important;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
}

.el-image-viewer__btn:hover {
  background-color: rgba(0, 0, 0, 0.1) !important;
  transform: scale(1.1);
}

.el-image-viewer__close {
  top: 40px !important;
  right: 40px !important;
  width: 52px !important;
  height: 52px !important;
  font-size: 28px !important;
  border-radius: 50% !important;
  background-color: rgba(0, 0, 0, 0.1) !important;
  border: 1px solid rgba(0, 0, 0, 0.15) !important;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1) !important;
  color: #000 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

.el-image-viewer__close:hover {
  background-color: rgba(0, 0, 0, 0.2) !important;
  transform: scale(1.1) rotate(90deg) !important;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15) !important;
}

.el-image-viewer__actions {
  bottom: 40px !important;
  padding: 0 24px !important;
  height: 52px !important;
  background-color: rgba(0, 0, 0, 0.05) !important;
  border: 1px solid rgba(0, 0, 0, 0.1) !important;
  backdrop-filter: blur(8px) !important;
  border-radius: 26px !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.05) !important;
}

.el-image-viewer__actions__inner {
  font-size: 20px !important;
  gap: 20px !important;
}

.el-image-viewer__prev,
.el-image-viewer__next {
  width: 56px !important;
  height: 56px !important;
  font-size: 24px !important;
  border-radius: 50% !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05) !important;
}

.el-image-viewer__canvas img {
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15) !important;
  border-radius: 4px !important;
}

.el-date-table th {
  color: rgba(229, 226, 227, 0.4) !important;
}

.el-date-table td.in-range .el-date-table-cell {
  background-color: rgba(82, 238, 138, 0.1) !important;
}

.el-date-table td.today .el-date-table-cell__text {
  color: #52ee8a !important;
  font-weight: bold !important;
}

.el-date-table td.available:hover {
  color: #52ee8a !important;
}

/* 优化日期选择器禁用状态样�?*/
.el-date-table td.disabled {
  background-color: transparent !important;
}

.el-date-table td.disabled .el-date-table-cell {
  background-color: rgba(255, 255, 255, 0.02) !important;
  color: rgba(255, 255, 255, 0.1) !important;
  cursor: not-allowed !important;
  position: relative;
  overflow: hidden;
}

/* 为禁用日期添加细腻的斜纹背景，增加辨识度 */
.el-date-table td.disabled .el-date-table-cell::after {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 200%;
  height: 200%;
  background: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 4px,
    rgba(255, 255, 255, 0.03) 4px,
    rgba(255, 255, 255, 0.03) 5px
  );
  pointer-events: none;
}

.el-date-table td.current:not(.disabled) .el-date-table-cell__text {
  background-color: #52ee8a !important;
  color: #131314 !important;
}

/* 科技感弹窗样�?*/
.custom-message-box {
  background-color: #2a2a2b !important; /* 使用 surface-container-high 颜色，增加对比度 */
  backdrop-filter: blur(20px) !important;
  border: 1px solid rgba(82, 238, 138, 0.3) !important; /* 增加边框亮度 */
  border-radius: 16px !important;
  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.8), 0 0 40px rgba(82, 238, 138, 0.1) !important;
}

.custom-message-box .el-message-box__title {
  color: #52ee8a !important;
  font-weight: bold !important;
  letter-spacing: 1px !important;
}

.custom-message-box .el-message-box__content {
  color: #e5e2e3 !important;
  font-size: 15px !important;
  padding-top: 20px !important;
  padding-bottom: 20px !important;
}

.custom-message-box .el-message-box__btns .el-button--primary {
  background-color: #52ee8a !important;
  border-color: #52ee8a !important;
  color: #131314 !important;
  font-weight: bold !important;
  border-radius: 8px !important;
  padding: 8px 20px !important;
}

.custom-message-box .el-message-box__btns .el-button:not(.el-button--primary) {
  background-color: transparent !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  color: rgba(255, 255, 255, 0.6) !important;
  border-radius: 8px !important;
}

.custom-message-box .el-message-box__btns .el-button:not(.el-button--primary):hover {
  border-color: rgba(255, 255, 255, 0.3) !important;
  color: #fff !important;
}

/* 危险操作弹窗增强样式 */
.danger-message-box {
  background-color: #2a2a2b !important; /* 使用较亮的背景色增加对比 */
  border: 1px solid rgba(239, 68, 68, 0.6) !important; /* 增强红色边框 */
  border-radius: 16px !important;
  box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.2), 0 25px 60px rgba(0, 0, 0, 0.9) !important;
  overflow: hidden !important;
  backdrop-filter: blur(15px) !important;
}

.danger-message-box .el-message-box__header {
  background: linear-gradient(to bottom, rgba(239, 68, 68, 0.05), transparent) !important;
  padding-top: 24px !important;
}

.danger-message-box .el-message-box__title {
  color: #ef4444 !important;
  font-weight: 800 !important;
  font-size: 18px !important;
}

.danger-message-box .el-message-box__status.el-icon {
  color: #ef4444 !important;
  font-size: 24px !important;
}

.danger-message-box .el-message-box__content {
  color: rgba(255, 255, 255, 0.8) !important;
  font-size: 14px !important;
  line-height: 1.6 !important;
  padding: 24px 32px !important;
}

.danger-message-box .el-message-box__btns {
  padding: 0 32px 32px !important;
}

.danger-message-box .el-message-box__btns .el-button {
  height: 40px !important;
  padding: 0 24px !important;
  font-weight: 600 !important;
  border-radius: 10px !important;
  transition: all 0.2s !important;
}

/* 列表内状态选择器样式优�?*/
.status-badge-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.02);
}

.status-badge-trigger:hover,
.el-dropdown-selfdefine:focus-visible .status-badge-trigger {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(82, 238, 138, 0.3);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  transition: all 0.3s;
  background-color: #9ca3af; /* 默认灰色 */
}

/* 洽谈�?- 蓝色 */
.is-negotiating .status-dot {
  background-color: #3b82f6;
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.4);
}
.is-negotiating.status-badge-trigger:hover {
  border-color: rgba(59, 130, 246, 0.3);
}

/* 交付�?- 绿色 */
.is-constructing .status-dot {
  background-color: #52ee8a;
  box-shadow: 0 0 8px rgba(82, 238, 138, 0.4);
}
.is-constructing.status-badge-trigger:hover {
  border-color: rgba(82, 238, 138, 0.3);
}

/* 结账�?- 橙色 */
.is-settling .status-dot {
  background-color: #f59e0b;
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.4);
}
.is-settling.status-badge-trigger:hover {
  border-color: rgba(245, 158, 11, 0.3);
}

/* 已结�?- 灰色 */
.is-closed .status-dot {
  background-color: #9ca3af;
  box-shadow: 0 0 8px rgba(156, 163, 175, 0.4);
}
.is-closed.status-badge-trigger {
  cursor: not-allowed;
  opacity: 0.8;
}

.status-text {
  font-size: 11px;
  font-weight: 600;
  color: rgba(229, 226, 227, 0.9);
  letter-spacing: 0.5px;
}

.status-chevron {
  font-size: 10px;
  color: rgba(229, 226, 227, 0.3);
  transition: transform 0.3s;
}

.status-badge-trigger:hover .status-chevron {
  color: #52ee8a;
  transform: rotate(180deg);
}

/* 下拉菜单高级感样�?- 完美复刻截图效果 */
.status-dropdown-popper {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}

.status-dropdown-menu {
  background-color: #1c1b1c !important;
  backdrop-filter: blur(20px) !important;
  border: 1px solid rgba(82, 238, 138, 0.15) !important;
  border-radius: 12px !important;
  padding: 8px !important;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.8) !important;
  margin-top: 8px !important;
}

.status-dropdown-menu :deep(.el-dropdown-menu__item) {
  color: rgba(229, 226, 227, 0.7) !important;
  height: 44px !important;
  line-height: 44px !important;
  border-radius: 8px !important;
  margin-bottom: 4px !important;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
  font-size: 14px !important;
  background-color: transparent !important;
  padding: 0 16px !important;
  position: relative !important;
}

.status-dropdown-menu :deep(.el-dropdown-menu__item:last-child) {
  margin-bottom: 0 !important;
}

/* 悬浮状�?*/
.status-dropdown-menu :deep(.el-dropdown-menu__item:hover) {
  background-color: rgba(82, 238, 138, 0.1) !important;
  color: #52ee8a !important;
  padding-left: 28px !important;
}

/* 选中状�?*/
.status-dropdown-menu :deep(.el-dropdown-menu__item.is-selected) {
  background-color: rgba(82, 238, 138, 0.15) !important;
  color: #52ee8a !important;
  font-weight: 700 !important;
  padding-left: 28px !important;
}

/* 侧边指示�?- 完美复刻基础信息下拉框效�?*/
.status-dropdown-menu :deep(.el-dropdown-menu__item:hover::before),
.status-dropdown-menu :deep(.el-dropdown-menu__item.is-selected::before) {
  content: '';
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 4px;
  height: 12px;
  background: #52ee8a;
  border-radius: 2px;
  box-shadow: 0 0 10px rgba(82, 238, 138, 0.5);
}

/* 隐藏默认图标 */
.status-dropdown-menu :deep(.el-dropdown-menu__item i) {
  display: none !important;
}

/* 高级筛选栏自定义样�?*/
.custom-date-picker-styled {
  width: 100% !important;
  height: 36px !important;
  
  :deep(.el-input__wrapper),
  :deep(.el-range-editor.el-input__wrapper) {
    background-color: #0e0e0f !important;
    border: 1px solid rgba(255, 255, 255, 0.05) !important;
    box-shadow: none !important;
    border-radius: 8px !important;
    height: 36px !important;
    box-sizing: border-box !important;
    transition: all 0.2s;
    
    &:hover {
      border-color: rgba(255, 255, 255, 0.1) !important;
    }
    
    &.is-active {
      border-color: #52ee8a !important;
      box-shadow: 0 0 0 1px #52ee8a !important;
    }
  }
  
  :deep(.el-range-input) {
    background-color: transparent !important;
    color: #e5e2e3 !important;
    font-size: 12px !important;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  }
  
  :deep(.el-range-separator) {
    color: rgba(229, 226, 227, 0.4) !important;
  }

  :deep(.el-range__icon), :deep(.el-range__close-icon) {
    color: #525252 !important;
  }
}

.custom-filter-input, .custom-filter-select, .custom-filter-date {
  :deep(.el-input__wrapper), :deep(.el-select__wrapper), :deep(.el-input) {
    background-color: #0e0e0f !important;
    box-shadow: none !important;
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
    border-radius: 8px !important;
    height: 36px !important;
    transition: all 0.2s;
    
    &:hover {
      border-color: rgba(255, 255, 255, 0.2) !important;
    }
    
    &.is-focus, &.is-focused {
      border-color: #52ee8a !important;
      box-shadow: 0 0 0 1px #52ee8a !important;
    }
  }
  
  :deep(.el-input__inner), :deep(.el-select__placeholder), :deep(.el-select__selected-item) {
    color: #e5e2e3 !important;
    font-size: 12px !important;
    
    &::placeholder {
      color: #525252 !important;
    }
  }
}

/* 调整 Element Plus 下拉框在深色模式下的样式 */
:deep(.el-select-dropdown__item) {
  font-size: 12px !important;
  padding: 8px 12px !important;
}

:deep(.el-select-dropdown__item.is-hovering) {
  background-color: rgba(82, 238, 138, 0.1) !important;
  color: #52ee8a !important;
}

:deep(.el-select-dropdown__item.is-selected) {
  color: #52ee8a !important;
  font-weight: bold !important;
}

/* 方案预览轮播图指示器样式 */
.preview-carousel :deep(.el-carousel__indicators--horizontal) {
  bottom: 64px !important;
  left: 50% !important;
  transform: translateX(-50%) !important;
}

.preview-carousel :deep(.el-carousel__indicator--horizontal .el-carousel__button) {
  width: 6px !important;
  height: 6px !important;
  border-radius: 50% !important;
  background-color: rgba(255, 255, 255, 0.2) !important;
  opacity: 1 !important;
}

.preview-carousel :deep(.el-carousel__indicator--horizontal.is-active .el-carousel__button) {
  background-color: #52ee8a !important;
}

.permission-toggle-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: rgba(82, 238, 138, 0.08);
    border-color: rgba(82, 238, 138, 0.25);
  }
}

.operation-log-control {
  width: 100%;
  height: 40px;
  background: #0e0e0f;
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: #e5e2e3;
  border-radius: 8px;
  padding: 0 12px;
  font-size: 13px;
  outline: none;
  transition: all 0.2s;

  &:focus {
    border-color: rgba(82, 238, 138, 0.7);
    box-shadow: 0 0 0 1px rgba(82, 238, 138, 0.35);
  }
}

.operation-log-page-btn,
.operation-log-number-btn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  transition: all 0.2s;
}

.operation-log-page-btn {
  color: #a3a3a3;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    color: #e5e2e3;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.35;
  }
}

.operation-log-stat::after {
  content: '';
  position: absolute;
  top: -40px;
  right: -40px;
  width: 120px;
  height: 120px;
  border-radius: 999px;
  background: rgba(82, 238, 138, 0.06);
  filter: blur(24px);
}

.dashboard-glass-card {
  background: rgba(42, 42, 43, 0.42);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(60, 74, 62, 0.22);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.14);
}

.dashboard-chart-container {
  perspective: 1000px;
}

.dashboard-scene-svg {
  position: relative;
  z-index: 2;
}

.dashboard-scene-segment {
  cursor: pointer !important;
  opacity: 0.9;
  pointer-events: stroke;
  transform-box: fill-box;
  transform-origin: center;
  transition: stroke-width 0.2s ease, opacity 0.2s ease, transform 0.2s ease, filter 0.2s ease;
}

.dashboard-scene-segment.is-active {
  opacity: 1;
  transform: scale(1.06);
}

.dashboard-scene-legend {
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s ease, transform 0.2s ease;
}

.dashboard-scene-legend.is-active {
  background: rgba(82, 238, 138, 0.08);
  transform: translateY(-1px);
}

.dashboard-scene-tooltip {
  position: absolute;
  z-index: 5;
  min-width: 128px;
  padding: 8px 10px;
  border-radius: 8px;
  pointer-events: none;
  transform: translate(14px, calc(-100% - 12px));
  background: rgba(12, 15, 13, 0.94);
  border: 1px solid rgba(82, 238, 138, 0.28);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.36);
  backdrop-filter: blur(14px);
}

.dashboard-scene-tooltip-title {
  margin-bottom: 4px;
  color: var(--color-on-surface-variant);
  font-size: 10px;
}

.dashboard-scene-tooltip-amount {
  color: var(--color-primary);
  font-size: 14px;
  font-weight: 700;
}

.dashboard-scene-tooltip-meta {
  margin-top: 4px;
  color: rgb(115, 115, 115);
  font-size: 10px;
}

.dashboard-profit-chart {
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(82, 238, 138, 0.04), rgba(82, 238, 138, 0)),
    rgba(8, 10, 9, 0.18);
}

.dashboard-profit-grid line {
  stroke: rgba(255, 255, 255, 0.08);
  stroke-width: 0.4;
}

.dashboard-profit-guide {
  stroke: rgba(82, 238, 138, 0.36);
  stroke-dasharray: 2 2;
  stroke-width: 0.6;
}

.dashboard-profit-line {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: dashboard-profit-line-draw 0.9s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

@keyframes dashboard-profit-line-draw {
  to {
    stroke-dashoffset: 0;
  }
}

.dashboard-profit-hit {
  cursor: pointer;
  fill: transparent;
}

.dashboard-profit-point {
  cursor: pointer;
  fill: #111311;
  stroke: #52ee8a;
  stroke-width: 0.8;
  transition: r 0.18s ease, fill 0.18s ease, filter 0.18s ease, stroke-width 0.18s ease;
}

.dashboard-profit-point.is-active {
  fill: #52ee8a;
  r: 1.9;
  stroke: #d9ffe5;
  stroke-width: 0.6;
  filter: drop-shadow(0 0 4px rgba(82, 238, 138, 0.7));
}

.dashboard-profit-tooltip {
  position: absolute;
  z-index: 3;
  min-width: 128px;
  padding: 8px 10px;
  border-radius: 8px;
  pointer-events: none;
  transform: translate(-50%, calc(-100% - 14px));
  background: rgba(12, 15, 13, 0.92);
  border: 1px solid rgba(82, 238, 138, 0.26);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.36);
  backdrop-filter: blur(14px);
}

.dashboard-profit-tooltip::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -5px;
  width: 10px;
  height: 10px;
  transform: translateX(-50%) rotate(45deg);
  background: rgba(12, 15, 13, 0.92);
  border-right: 1px solid rgba(82, 238, 138, 0.26);
  border-bottom: 1px solid rgba(82, 238, 138, 0.26);
}

.dashboard-bar-3d {
  position: relative;
  cursor: pointer;
  transform-style: preserve-3d;
  transform: rotateX(-15deg) rotateY(20deg);
  transform-origin: bottom center;
  animation: dashboard-bar-grow 0.72s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes dashboard-bar-grow {
  from {
    height: 0;
  }
}

.dashboard-bar-tooltip {
  position: absolute;
  top: -86px;
  left: 50%;
  z-index: 4;
  min-width: 112px;
  padding: 8px 10px;
  border-radius: 8px;
  pointer-events: none;
  transform: translateX(-50%);
  background: rgba(12, 15, 13, 0.92);
  border: 1px solid rgba(82, 238, 138, 0.26);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.36);
  backdrop-filter: blur(14px);
}

.dashboard-bar-tooltip::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -5px;
  width: 10px;
  height: 10px;
  transform: translateX(-50%) rotate(45deg);
  background: rgba(12, 15, 13, 0.92);
  border-right: 1px solid rgba(82, 238, 138, 0.26);
  border-bottom: 1px solid rgba(82, 238, 138, 0.26);
}

.dashboard-bar-face {
  position: absolute;
  bottom: 0;
  left: 0;
}

.dashboard-bar-front {
  width: 100%;
  background: linear-gradient(to top, rgba(82, 238, 138, 0.82), rgba(82, 238, 138, 0.32));
  transform: translateZ(10px);
  border: 1px solid rgba(82, 238, 138, 0.42);
}

.dashboard-bar-back {
  width: 100%;
  background: rgba(82, 238, 138, 0.1);
  transform: translateZ(-10px);
}

.dashboard-bar-right {
  width: 20px;
  background: linear-gradient(to top, rgba(43, 209, 113, 0.62), rgba(43, 209, 113, 0.22));
  transform: rotateY(90deg) translateZ(calc(100% - 10px));
  left: auto;
  right: -10px;
}

.dashboard-bar-top {
  width: 100%;
  height: 20px;
  background: #52ee8a;
  transform: rotateX(90deg) translateZ(10px);
  bottom: auto;
  top: -10px;
  box-shadow: 0 0 15px rgba(82, 238, 138, 0.5);
}
</style>
