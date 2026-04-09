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
          v-for="item in menuItems" 
          :key="item.name"
          class="flex items-center gap-3 px-6 py-4 cursor-pointer transition-all hover:bg-neutral-800/50"
          :class="item.active ? 'text-primary bg-primary/10 font-bold border-r-2 border-primary' : 'text-neutral-400'"
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
            <User class="text-primary w-6 h-6" />
          </div>
          <div class="flex flex-col">
            <span class="text-xs font-bold">管理员</span>
            <span class="text-[10px] text-on-surface-variant uppercase tracking-widest">系统管理员</span>
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
          <el-button 
            v-if="projects.length > 0" 
            type="primary" 
            size="large" 
            class="!bg-gradient-to-br from-primary to-primary-container !border-none !font-bold shadow-lg"
            @click="resetForm"
          >
            <el-icon class="mr-2">
              <Plus />
            </el-icon>
            新建项目
          </el-button>
        </div>

        <!-- Project Table Section -->
        <section class="bg-surface-container-high rounded-xl overflow-hidden border border-white/5">
          <div class="p-6 border-b border-white/5 flex justify-between items-center">
            <h3 class="text-lg font-bold flex items-center gap-2">
              <span class="w-1.5 h-6 bg-primary rounded-full" />
              活跃项目列表
            </h3>
            <div class="flex gap-2">
              <button class="px-3 py-1.5 bg-neutral-800 text-[10px] text-on-surface-variant rounded-md hover:text-primary transition-colors uppercase tracking-wider">
                全部项目
              </button>
              <button class="px-3 py-1.5 bg-primary/10 text-[10px] text-primary rounded-md font-bold border border-primary/20 uppercase tracking-wider">
                进行中
              </button>
              <button class="px-3 py-1.5 bg-neutral-800 text-[10px] text-on-surface-variant rounded-md hover:text-primary transition-colors uppercase tracking-wider">
                已交付
              </button>
            </div>
          </div>
          
          <div class="overflow-x-auto">
            <el-table 
              :data="projects" 
              style="width: 100%"
              :row-class-name="tableRowClassName"
              header-align="left"
              @row-click="handleViewProject"
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
                    <span class="font-bold text-sm text-on-surface truncate">{{ row.name }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column
                prop="client"
                label="客户单位"
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
                prop="date"
                label="开始时间"
                min-width="100"
              >
                <template #default="{ row }">
                  <span 
                    class="font-mono text-xs"
                    :class="row.id === selectedProjectId ? 'text-on-surface' : 'text-on-surface-variant/80'"
                  >{{ row.date }}</span>
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
                label="当前状态"
                min-width="100"
              >
                <template #default="{ row }">
                  <div 
                    class="inline-block px-2.5 py-1 text-[10px] font-bold rounded-full uppercase tracking-wider border"
                    :class="[
                      row.statusText === '施工中' ? 'bg-primary/10 text-primary border-primary/20' : 
                      row.statusText === '设计中' ? 'bg-secondary/10 text-secondary border-secondary/20' : 
                      'bg-neutral-800 text-on-surface-variant border-white/5'
                    ]"
                  >
                    {{ row.statusText }}
                  </div>
                </template>
              </el-table-column>
              <el-table-column
                label="操作"
                align="right"
                width="80"
                fixed="right"
              >
                <template #default>
                  <div class="flex justify-end pr-2">
                    <el-icon class="cursor-pointer text-on-surface-variant hover:text-primary transition-colors text-lg">
                      <ArrowRight />
                    </el-icon>
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
              
              <div class="flex items-center justify-between mb-8 relative z-10">
                <h3 class="text-lg font-bold text-on-surface flex items-center gap-2">
                  <span class="w-1.5 h-6 bg-primary rounded-full" />
                  基础项目信息
                </h3>
                
                <!-- Edit/Save/Cancel Buttons -->
                <div v-if="selectedProjectId" class="flex gap-3">
                  <el-button
                    v-if="isViewMode"
                    type="default"
                    size="small"
                    class="!rounded-full !px-6 !bg-emerald-500/10 !text-primary !border !border-primary/30 hover:!bg-primary/20 hover:scale-105 transition-all duration-300 font-bold shadow-[0_0_15px_rgba(82,238,138,0.1)]"
                    @click="enterEditMode"
                  >
                    <el-icon class="mr-1"><Edit /></el-icon>
                    编辑
                  </el-button>
                  <template v-else-if="isEditMode">
                    <el-button
                      size="small"
                      class="!rounded-full !px-6 !bg-neutral-800 !border-white/10 !text-on-surface-variant hover:!bg-neutral-700 hover:!text-white transition-all duration-300"
                      @click="cancelEdit"
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
                      <el-icon class="mr-1"><Check /></el-icon>
                      保存
                    </el-button>
                  </template>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                <!-- Project Name -->
                <div class="space-y-2">
                  <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">项目名称</label>
                  <el-input
                    v-model="form.name"
                    placeholder="请输入项目名称"
                    class="custom-input"
                    :disabled="isViewMode"
                  />
                </div>

                <!-- Project Period -->
                <div class="space-y-2">
                  <div class="flex justify-between items-center px-1">
                    <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest">项目周期</label>
                    <span
                      v-if="projectDays > 0"
                      class="text-[10px] font-bold text-primary px-2 py-0.5 bg-primary/10 rounded-full border border-primary/20"
                    >共 {{ projectDays }} 天</span>
                  </div>
                  <div class="relative">
                    <el-date-picker
                      v-model="form.period"
                      type="daterange"
                      range-separator="至"
                      start-placeholder="开始日期"
                      end-placeholder="结束日期"
                      class="!w-full custom-date-picker"
                      :disabled="isViewMode"
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
                    :disabled="isViewMode"
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
                    :disabled="isViewMode || !isNewClient"
                  >
                    <el-option 
                      v-for="item in clientRoles" 
                      :key="item.value" 
                      :label="item.label" 
                      :value="item.value" 
                    />
                  </el-select>
                </div>

                <!-- Client Source (Only for new clients) -->
                <div
                  v-if="isNewClient"
                  class="space-y-2"
                >
                  <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">客户来源</label>
                  <el-select 
                    v-model="form.clientSource" 
                    placeholder="请选择客户来源" 
                    class="w-full custom-select" 
                    popper-class="custom-dropdown"
                    :disabled="isViewMode"
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
                <div class="space-y-2">
                  <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">人员数量</label>
                  <el-input-number
                    v-model="form.staffCount"
                    :min="1"
                    :controls="false"
                    placeholder="请输入预计施工及管理人员数量"
                    class="!w-full custom-number-input"
                    :disabled="isViewMode"
                  />
                </div>

                <!-- Order Amount -->
                <div class="space-y-2">
                  <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">订单金额 (¥)</label>
                  <el-input
                    v-model="form.amount"
                    placeholder="请输入总签约金额"
                    class="custom-input amount-input"
                    :disabled="isViewMode"
                  />
                </div>

                <!-- Project Status -->
                <div class="space-y-2">
                  <label class="text-xs font-bold text-on-surface-variant uppercase tracking-widest px-1">项目状态</label>
                  <el-select 
                    v-model="form.status" 
                    placeholder="请选择项目状态" 
                    class="w-full custom-select" 
                    popper-class="custom-dropdown"
                    :disabled="isViewMode"
                  >
                    <el-option 
                      v-for="item in projectStatuses" 
                      :key="item.value" 
                      :label="item.label" 
                      :value="item.value" 
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
                    placeholder="在此详细说明园林项目的设计要求与技术难点..."
                    class="custom-textarea"
                    :disabled="isViewMode"
                  />
                </div>
              </div>
            </section>

            <!-- Cost Management Section -->
            <section class="bg-surface-container-high rounded-xl overflow-hidden border border-white/5">
              <div class="p-6 md:p-8 pb-4 flex justify-between items-center">
                <h3 class="text-lg font-bold flex items-center gap-2">
                  <span class="w-1.5 h-6 bg-secondary rounded-full" />
                  成本支出管理
                </h3>
                <button 
                  class="group flex items-center gap-1.5 px-3 py-1.5 border border-primary/20 text-primary/80 hover:text-primary hover:bg-primary/5 hover:border-primary/40 rounded-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  :disabled="isViewMode || costs.length >= costCategories.length"
                  @click="addCost"
                >
                  <el-icon class="text-sm">
                    <Plus />
                  </el-icon>
                  <span class="text-xs font-medium tracking-tight">{{ costs.length >= costCategories.length ? '已达类目上限' : '添加成本项' }}</span>
                </button>
              </div>

              <div class="px-6 md:px-8 pb-8">
                <div class="overflow-x-auto mb-6">
                  <table class="w-full text-left border-separate border-spacing-y-3 min-w-[600px]">
                    <thead>
                      <tr class="text-[10px] text-on-surface-variant uppercase tracking-[0.2em]">
                        <th class="px-4 py-2 font-medium w-[30%]">
                          类目
                        </th>
                        <th class="px-4 py-2 font-medium w-[30%]">
                          供应商
                        </th>
                        <th class="px-4 py-2 font-medium w-[30%] text-center">
                          成本金额 (¥)
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
                            :disabled="isViewMode"
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
                            :disabled="isViewMode"
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
                              :disabled="isViewMode"
                            >
                          </div>
                        </td>
                        <td class="px-4 py-4 text-right rounded-r-lg">
                          <button 
                            class="text-red-400/40 hover:text-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            :disabled="isViewMode"
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
                <div class="mt-8 border-t border-white/5 pt-6">
                  <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
                    <h4 class="text-xs font-bold text-on-surface-variant uppercase tracking-widest">
                      单据凭证列表 (多图上传)
                    </h4>
                    <button 
                      :disabled="isViewMode || uploadingVoucher"
                      class="flex items-center gap-2 text-xs font-bold text-primary hover:underline disabled:opacity-50"
                      @click="triggerUpload"
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
                    </button>
                  </div>
                  
                  <!-- 隐藏的文件输入框 -->
                  <input 
                    ref="fileInputRef"
                    type="file" 
                    multiple 
                    accept="image/*" 
                    class="hidden" 
                    @change="handleFileUpload"
                  >

                  <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    <!-- 已上传图片展示 -->
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
                        <div class="flex gap-3">
                          <el-icon
                            class="text-white hover:text-primary transition-colors"
                            size="20"
                            @click.stop="handlePreview(idx)"
                          >
                            <View />
                          </el-icon>
                          <el-icon
                            v-if="!isViewMode"
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
                    <button 
                      v-if="vouchers.length < 20"
                      :disabled="isViewMode || uploadingVoucher"
                      class="aspect-square rounded-lg border-2 border-dashed border-white/10 flex flex-col items-center justify-center gap-2 text-on-surface-variant hover:border-primary/50 hover:text-primary transition-all bg-surface-container-lowest/50 group disabled:opacity-30 disabled:cursor-not-allowed"
                      @click="triggerUpload"
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
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <!-- Right: Analysis -->
          <div class="lg:col-span-4 space-y-8">
            <el-card class="!p-6 relative overflow-hidden">
              <div class="absolute -right-4 -top-4 w-24 h-24 bg-primary/10 rounded-full blur-2xl" />
              <h3 class="text-lg font-bold mb-6 font-space">
                项目财务快报
              </h3>
              <div class="space-y-6">
                <div class="p-4 bg-surface-container-lowest rounded-lg border-l-4 border-primary shadow-xl flex justify-between items-center group/item">
                  <div>
                    <p class="text-[10px] text-on-surface-variant uppercase tracking-widest mb-1">
                      预计利润
                    </p>
                    <p class="text-2xl font-mono font-black text-primary">
                      ¥ {{ formatNumber(estimatedProfit) }}
                    </p>
                  </div>
                  <div class="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center transition-all duration-500 group-hover/item:bg-primary/20 group-hover/item:scale-110 shadow-[0_0_15px_rgba(82,238,138,0.1)]">
                    <el-icon
                      size="24"
                      class="text-primary drop-shadow-[0_0_8px_rgba(82,238,138,0.5)]"
                    >
                      <TrendCharts />
                    </el-icon>
                  </div>
                </div>
                
                <div class="grid grid-cols-2 gap-4">
                  <div class="p-4 bg-surface-container-lowest rounded-lg">
                    <p class="text-[10px] text-on-surface-variant uppercase tracking-widest mb-1">
                      利润率
                    </p>
                    <p class="text-xl font-mono font-bold text-secondary">
                      {{ profitMargin }}%
                    </p>
                    <el-progress
                      :percentage="Math.max(0, Math.min(100, parseFloat(profitMargin)))"
                      :show-text="false"
                      color="#00daf3"
                      class="mt-2"
                    />
                  </div>
                  <div class="p-4 bg-surface-container-lowest rounded-lg">
                    <p class="text-[10px] text-on-surface-variant uppercase tracking-widest mb-1">
                      成本率
                    </p>
                    <p class="text-xl font-mono font-bold">
                      {{ costRate }}%
                    </p>
                    <el-progress
                      :percentage="Math.max(0, Math.min(100, parseFloat(costRate)))"
                      :show-text="false"
                      color="#666"
                      class="mt-2"
                    />
                  </div>
                </div>

                <div class="pt-6 border-t border-white/5 space-y-3 text-xs">
                  <div class="flex justify-between">
                    <span class="text-on-surface-variant">总预算收入</span>
                    <span class="font-mono">¥ {{ formatNumber(totalIncome) }}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-on-surface-variant">已核算成本</span>
                    <span class="text-red-400 font-mono">- ¥ {{ formatNumber(totalCost) }}</span>
                  </div>
                  <div class="flex justify-between font-bold">
                    <span class="text-on-surface-variant">预估净得</span>
                    <span class="text-primary font-mono">¥ {{ formatNumber(estimatedProfit) }}</span>
                  </div>
                </div>
              </div>
            </el-card>

            <div class="rounded-xl overflow-hidden aspect-square relative group border border-white/5 flex flex-col items-center justify-center bg-surface-container-high">
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
                  等待上传设计图
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
        <div class="flex justify-end gap-4 pt-4 pb-12">
          <template v-if="isViewMode">
            <el-button
              type="primary"
              size="large"
              class="!px-10 !font-bold shadow-xl"
              @click="enterCreateMode"
            >
              创建新项目
            </el-button>
          </template>
          <template v-else-if="!isEditMode">
            <el-button 
              type="primary" 
              size="large" 
              class="!px-10 !font-bold shadow-xl"
              :loading="savingProject"
              @click="handleSaveProject"
            >
              {{ projects.length > 0 ? '保存项目档案' : '确认并创建首个项目' }}
            </el-button>
          </template>
        </div>
      </main>
    </div>

    <!-- 图片预览组件 -->
    <el-image-viewer
      v-if="previewVisible"
      :url-list="previewList"
      :initial-index="initialIndex"
      teleported
      @close="previewVisible = false"
    />
  </div>
</template>

<script setup>
import { ref, reactive, markRaw, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { queryClients, getGlobalConfig, addVoucher, getVouchers, deleteVoucher, renameProjectVouchers, createProject, updateProject, updateVouchersProject, listProjects } from '../api/common'
import axios from 'axios'
import Compressor from 'compressorjs'
import { 
  DataBoard, 
  User, 
  Search, 
  Bell, 
  QuestionFilled, 
  Plus, 
  ArrowRight,
  Delete,
  Upload,
  View,
  Picture,
  TrendCharts,
  Management,
  Briefcase,
  Box,
  Setting,
  Refresh,
  Edit,
  Check,
} from '@element-plus/icons-vue'

// 获取API域名
const apiDomain = import.meta.env.VITE_TCB_BASE_URL || ''

const router = useRouter()

// 侧边栏菜单配置
const menuItems = ref([
  { name: 'dashboard', label: '数据总览', icon: markRaw(DataBoard), active: false },
  { name: 'projects', label: '项目管理', icon: markRaw(Management), active: true },
  { name: 'clients', label: '客户管理', icon: markRaw(User), active: false },
  { name: 'suppliers', label: '供应商管理', icon: markRaw(Briefcase), active: false },
  { name: 'materials', label: '材料管理', icon: markRaw(Box), active: false },
  { name: 'settings', label: '系统设置', icon: markRaw(Setting), active: false },
])

// 视图模式：true为查看模式（只读），false为创建/编辑模式
const isViewMode = ref(false)
// 是否为编辑模式（针对已存在的项目）
const isEditMode = ref(false)
// 当前选中的项目ID
const selectedProjectId = ref(null)
// 记录编辑前的项目名称，用于同步修改云存储路径
const originalProjectName = ref('')

// 项目列表数据
const projects = ref([])

// 项目录入表单响应式对象
const form = reactive({
  name: '',           // 项目名称
  period: null,       // 项目周期（日期范围数组）
  client: '',         // 客户名称
  role: '',           // 客户角色
  clientSource: '',   // 客户来源（仅新客户可见）
  status: '',         // 项目状态
  staffCount: null,   // 人员数量
  amount: '',         // 订单金额
  desc: ''            // 项目描述
})

// 是否为新客户标识：用于控制“客户来源”显示及“客户角色”是否可编辑
const isNewClient = ref(true)

// 加载状态控制
const clientLoading = ref(false)
const configSyncing = ref(false)
const savingProject = ref(false)

// 现有客户列表（由接口获取）
const existingClients = ref([])

// 客户角色列表（由接口获取）
const clientRoles = ref([])

// 客户来源列表（由接口获取）
const clientSources = ref([])

// 成本类目列表（由接口获取）
const costCategories = ref([])

// 项目状态列表（由接口获取）
const projectStatuses = ref([])

// 供应商列表（目前默认只有一个“无”）
const suppliers = ref([
  { id: 'none', label: '无', value: '无' }
])

/**
 * 初始化全局配置（带 12 小时本地缓存逻辑）
 * @param {Boolean} forceRefresh - 是否强制从云端同步
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

    // 1. 检查本地缓存是否有效 (如果不强制刷新)
    if (!forceRefresh && cachedData && lastFetchTime && (now - parseInt(lastFetchTime) < EXPIRE_TIME)) {
      const configs = JSON.parse(cachedData)
      console.log('📦 [Local Cache Hit] 从本地存储加载配置数据')
      
      // 统一去重处理，防止数据库脏数据导致前端显示重复
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
      projectStatuses.value = deduplicate(configs['PROJECT_STATUS'])
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
      projectStatuses.value = deduplicate(configs['PROJECT_STATUS'])
      
      // 3. 更新本地缓存
      localStorage.setItem(CACHE_KEY, JSON.stringify(configs))
      localStorage.setItem(TIME_KEY, now.toString())
      console.log('✅ [Sync Success] 配置数据已同步并存入本地缓存')
      
      if (forceRefresh) {
        import('element-plus').then(({ ElMessage }) => {
          ElMessage.success('配置同步成功')
        })
      }
    } else {
      throw new Error(res?.message || '获取配置失败')
    }
  } catch (error) {
    console.error('初始化配置失败:', error.message || error)
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
  initGlobalConfigs()
})

// 计算属性：根据选择的日期范围自动计算项目总天数
const projectDays = computed(() => {
  if (!form.period || !Array.isArray(form.period) || form.period.length !== 2) return 0
  const start = new Date(form.period[0])
  const end = new Date(form.period[1])
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0
  // 计算毫秒差并转换为天数，包含首尾两日
  const diffTime = Math.abs(end - start)
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1
})

/**
 * 接口：查询客户名称列表
 */
const handleClientVisibleChange = async (visible) => {
  // 仅在下拉框展开且列表为空时触发查询
  if (visible && existingClients.value.length === 0) {
    clientLoading.value = true
    try {
      // 调用云函数 queryClients
      const res = await queryClients({ keyword: '' })
      // 更新现有客户列表数据
      if (res.data && Array.isArray(res.data)) {
        existingClients.value = res.data.map(item => ({
          id: item._id || item.id,
          name: item.name,
          role: item.role
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
 * @param {string} val - 输入或选择的客户名称
 */
const handleClientChange = (val) => {
  // 在现有客户库中查找
  const client = existingClients.value.find(c => c.name === val)
  if (client) {
    // 匹配到已有客户：自动带出角色，标记为非新客户
    form.role = client.role
    isNewClient.value = false
  } else {
    // 未匹配到：清空角色，标记为新客户，允许手动填写
    form.role = ''
    isNewClient.value = true
  }
}

// 成本支出项列表
const costs = ref([])

/**
 * 添加成本项
 */
const addCost = () => {
  if (costs.value.length >= costCategories.value.length) {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.warning('所有成本类目已添加完毕')
    })
    return
  }
  costs.value.push({
    id: Date.now() + Math.random(), // 增加唯一ID以解决Vue渲染Key的问题
    category: '',
    supplier: '无',
    amount: 0
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
const fileInputRef = ref(null)

// 图片预览状态
const previewVisible = ref(false)
const initialIndex = ref(0)
const previewList = computed(() => vouchers.value.map(v => v.url))

/**
 * 处理图片预览
 */
const handlePreview = (index) => {
  initialIndex.value = index
  previewVisible.value = true
}

/**
 * 触发文件选择
 */
const triggerUpload = () => {
  if (vouchers.value.length >= 20) {
    import('element-plus').then(({ ElMessage }) => {
      ElMessage.warning('最多只能上传 20 张凭证')
    })
    return
  }
  fileInputRef.value?.click()
}

/**
 * 使用 compressorjs 三方库实现图片压缩
 */
const compressImage = (file) => {
  return new Promise((resolve) => {
    new Compressor(file, {
      maxWidth: 600, // 最大宽度
      maxHeight: 600, // 最大高度
      quality: 0.6, // 压缩质量（0-1）
      mimeType: file.type, // 保持原文件类型
      success: (compressedBlob) => {
        // 压缩成功，返回压缩后的 Blob
        resolve(compressedBlob)
      },
      error: (err) => {
        // 压缩失败，返回原文件
        console.error('图片压缩失败:', err.message || err)
        resolve(file)
      }
    })
  })
}

/**
 * 查看项目详情
 */
const handleViewProject = async (project) => {
  if (!project) return
  
  isViewMode.value = true
  isEditMode.value = false
  selectedProjectId.value = project.id
  
  // 回显数据
  Object.assign(form, {
    name: project.name,
    period: project.period,
    client: project.client,
    role: project.role,
    clientSource: project.clientSource,
    status: project.status,
    staffCount: project.staffCount,
    amount: project.amount,
    desc: project.desc
  })
  
  // 回显成本项
  costs.value = project.costs ? project.costs.map(c => ({
    id: Date.now() + Math.random(),
    category: c.category,
    supplier: c.supplier,
    amount: c.amount
  })) : []
  
  // 回显凭证：先清空，再从接口获取最新凭证
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
const cancelEdit = () => {
  const project = projects.value.find(p => p.id === selectedProjectId.value)
  if (project) {
    handleViewProject(project)
  } else {
    enterCreateMode()
  }
}

/**
 * 进入创建模式
 */
const enterCreateMode = () => {
  isViewMode.value = false
  isEditMode.value = false
  selectedProjectId.value = null
  resetForm()
}

/**
 * 加载项目列表
 */
const loadProjects = async () => {
  try {
    const res = await listProjects()
    // Support both res.success and checking res.code
    if (res.success || res.code === 0) {
      projects.value = res.data.map(p => {
        const statusConfig = projectStatuses.value.find(s => s.value === p.status)
        return {
          ...p,
          id: p._id || p.id, // 确保有统一的 id 字段用于高亮匹配
          statusColor: p.status === 'ongoing' || p.status === 'constructing' ? 'bg-primary' : 'bg-secondary',
          statusText: statusConfig ? statusConfig.label : (p.status === 'ongoing' ? '施工中' : '设计中'),
          date: p.period ? new Date(p.period[0]).toLocaleDateString() : '-'
        }
      })
      
      // 如果有数据，默认选中最新的一条（假设后端返回的是按时间降序）
      if (projects.value.length > 0 && !selectedProjectId.value) {
        handleViewProject(projects.value[0])
      }
    }
  } catch (err) {
    console.error('加载项目列表失败:', err.message || err)
  }
}

/**
 * 重置表单
 */
const resetForm = () => {
  Object.assign(form, {
    name: '',
    period: null,
    client: '',
    role: '',
    clientSource: '',
    status: 'negotiating', // 默认谈判中
    staffCount: null,
    amount: '',
    desc: ''
  })
  costs.value = []
  vouchers.value = []
  isNewClient.value = true
}

// 安全校验：拦截特殊字符
const isSafeInput = (str) => {
  if (!str) return true;
  // 拦截常见的 XSS 和 SQL 注入字符
  const unsafePattern = /[<>{}[\]\\^%`|]/;
  return !unsafePattern.test(str);
};

// 格式化数字
const formatNumber = (num) => {
  return Number(num).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// 财务快报计算逻辑
const totalIncome = computed(() => {
  const val = parseFloat(form.amount) || 0;
  return val;
});

const totalCost = computed(() => {
  return costs.value.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
});

const estimatedProfit = computed(() => {
  return totalIncome.value - totalCost.value;
});

const profitMargin = computed(() => {
  if (totalIncome.value === 0) return '0.00';
  return ((estimatedProfit.value / totalIncome.value) * 100).toFixed(2);
});

const costRate = computed(() => {
  if (totalIncome.value === 0) return '0.00';
  return ((totalCost.value / totalIncome.value) * 100).toFixed(2);
});

// 成本构成分析数据
const costAnalysisData = computed(() => {
  if (costs.value.length === 0 || totalCost.value === 0) return [];
  
  // 按类别汇总
  const summary = {};
  costs.value.forEach(item => {
    if (item.category && item.amount) {
      summary[item.category] = (summary[item.category] || 0) + parseFloat(item.amount);
    }
  });

  // 定义颜色映射 (使用英文 Value 作为 Key 以确保匹配)
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
  }).sort((a, b) => b.percentage - a.percentage); // 按比例降序排列
});

/**
 * 校验表单完整性
 */
const validateProjectForm = (checkVouchers = true) => {
  if (!form.name) return '请输入项目名称';
  if (!isSafeInput(form.name)) return '项目名称包含非法字符';
  
  if (!form.period || form.period.length !== 2) return '请选择项目周期';
  
  if (!form.client) return '请输入客户名称';
  if (!isSafeInput(form.client)) return '客户名称包含非法字符';

  if (!form.role) return '请选择客户角色';
  
  if (isNewClient.value && !form.clientSource) return '请选择新客户来源';

  if (!form.status) return '请选择项目状态';

  if (form.staffCount === null || form.staffCount === undefined) return '请输入人员数量';
  
  if (!form.amount) return '请输入订单金额';
  if (isNaN(parseFloat(form.amount))) return '订单金额必须为数字';

  if (!form.desc) return '请输入项目描述';
  if (!isSafeInput(form.desc)) return '项目描述包含非法字符';
  
  if (costs.value.length === 0) return '请至少添加一个成本项';
  
  for (const cost of costs.value) {
    if (!cost.category || cost.amount === undefined || cost.amount === null) return '请完善成本项信息';
    if (isNaN(parseFloat(cost.amount))) return '成本金额必须为数字';
  }

  if (checkVouchers && vouchers.value.length === 0) {
    return '请上传至少一张凭证照片';
  }
  
  return null;
}

/**
 * 确认保存修改（带弹窗提醒）
 */
const confirmSaveUpdate = () => {
  import('element-plus').then(({ ElMessageBox }) => {
    ElMessageBox.confirm(
      '确认保存对该项目的修改吗？',
      '提示',
      {
        confirmButtonText: '确认保存',
        cancelButtonText: '取消',
        type: 'warning',
        customClass: 'custom-message-box'
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
    // 1. 手动构建提交数据，彻底避免循环引用
    const projectData = {
      name: form.name,
      period: form.period ? [new Date(form.period[0]).toISOString(), new Date(form.period[1]).toISOString()] : [],
      client: form.client,
      role: form.role,
      clientSource: form.clientSource,
      status: form.status,
      staffCount: Number(form.staffCount),
      amount: Number(form.amount),
      desc: form.desc,
      costs: costs.value.map(item => ({
        category: item.category,
        supplier: item.supplier,
        amount: Number(item.amount)
      })),
      financials: {
        totalIncome: Number(totalIncome.value),
        totalCost: Number(totalCost.value),
        estimatedProfit: Number(estimatedProfit.value),
        profitMargin: String(profitMargin.value),
        costRate: String(costRate.value)
      }
    }
    
    let res;
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
        status: 'ongoing' // 初始状态
      })
    }
    
    if (res.success || res.code === 0) {
      const projectId = isEditMode.value ? selectedProjectId.value : res.data.id
      
      // 2. 如果项目名称修改了，同步修改云存储中的路径
      if (isEditMode.value && originalProjectName.value && originalProjectName.value !== form.name) {
        console.log(`项目名称已修改: ${originalProjectName.value} -> ${form.name}，同步云存储路径...`)
        try {
          await renameProjectVouchers({
            projectId,
            oldName: originalProjectName.value,
            newName: form.name
          })
        } catch (err) {
          console.error('同步云存储路径失败:', err)
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

      import('element-plus').then(({ ElMessage }) => {
        ElMessage.success(isEditMode.value ? '项目更新成功' : '项目创建成功')
      })
      
      // 立即更新本地列表数据，确保 UI 实时响应
      const statusConfig = projectStatuses.value.find(s => s.value === form.status)
      const updatedItem = {
        ...projectData,
        id: projectId,
        statusText: statusConfig ? statusConfig.label : (form.status === 'ongoing' ? '施工中' : '设计中'),
        statusColor: form.status === 'ongoing' || form.status === 'constructing' ? 'bg-primary' : 'bg-secondary',
        date: form.period ? new Date(form.period[0]).toLocaleDateString() : '-'
      }
      
      const index = projects.value.findIndex(p => p.id === projectId)
      if (index !== -1) {
        // 使用 splice 确保响应式更新
        projects.value.splice(index, 1, updatedItem)
      } else {
        projects.value.unshift(updatedItem)
      }

      // 强制重置编辑状态
      isEditMode.value = false
      isViewMode.value = true
      
      if (!isEditMode.value && !selectedProjectId.value) {
        resetForm()
      }
      
      // 异步加载最新列表，不阻塞 UI 响应
      loadProjects()
      
      // 保持当前选中项
      selectedProjectId.value = projectId
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
 * 处理文件上传
 */
const handleFileUpload = async (event) => {
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
        // 检查文件类型
        const validTypes = ['image/jpeg', 'image/png', 'image/gif']
        if (!validTypes.includes(file.type)) {
          import('element-plus').then(({ ElMessage }) => {
            ElMessage.error('只支持 JPG、PNG、GIF 格式的图片')
          })
          return null
        }
        
        // 检查原始文件大小（限制为5MB）
        if (file.size > 5 * 1024 * 1024) {
          import('element-plus').then(({ ElMessage }) => {
            ElMessage.error('图片过大，请选择小于 5MB 的图片')
          })
          return null
        }
        
        // 压缩图片（使用 Compressor 三方库）
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
        
        // 发送请求到云函数
        console.log(`📡 上传到云函数...`)
        const response = await axios.post(`${apiDomain}/voucherService`, formData, {
          timeout: 30000, // 30秒超时
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        })
        
        if (response.data.code === 0) {
          console.log(`✅ 上传成功，URL: ${response.data.data.url}`)
          
          // 调用云函数记录到数据库 (初始 projectId 为空或临时值)
          console.log(`📝 记录到数据库...`)
          const dbRes = await addVoucher({
            projectId: 'TEMP_UNASSOCIATED', 
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
  localStorage.removeItem('isLoggedIn')
  router.push('/login')
}
</script>

<style>
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

.el-date-table td.current:not(.disabled) .el-date-table-cell__text {
  background-color: #52ee8a !important;
  color: #131314 !important;
}

/* 科技感弹窗样式 */
.custom-message-box {
  background-color: rgba(28, 27, 28, 0.9) !important;
  backdrop-filter: blur(20px) !important;
  border: 1px solid rgba(82, 238, 138, 0.2) !important;
  border-radius: 16px !important;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5), 0 0 30px rgba(82, 238, 138, 0.05) !important;
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
</style>
