export type Language = 'zh' | 'en';

export const STRINGS_ZH = {
  appName: '蛛网 · AI Debug',
  appTitle: '蛛网 · AI Debug —— 蛛网式上下文管理工具',
  appDescription:
    '把 AI 对话从线性列表变成 git 仓库式的蛛网结构。每个分支独立维护自己的上下文路径，支持分叉、合并、放弃、恢复，让复杂问题的排查不再被无关历史污染。',

  projectList: '项目列表',
  newProject: '新建项目',
  noProjects: '还没有项目，点击上方新建',
  nodesCount: '{count} 个节点',
  justNow: '刚刚',
  minutesAgo: '{count} 分钟前',
  hoursAgo: '{count} 小时前',
  daysAgo: '{count} 天前',

  rename: '重命名',
  export: '导出',
  delete: '删除',
  moreActions: '更多操作',

  renameProject: '重命名项目：',
  confirmDeleteProject: '确定删除项目「{name}」？此操作不可撤销。',
  importFailed: '导入失败：文件格式无效',
  importedProjectName: '导入的项目',
  importFromJson: '从 JSON 文件导入',

  derivedFrom: '派生自 {name}',
  deleted: '已删除',
  jumpToOriginal: '跳转到原项目',

  aiPruneNetwork: 'AI 清理蛛网',
  aiPruneFailed: 'AI 清理蛛网失败：{message}',

  noProjectSelected: '未选择项目',

  settings: '设置',
  close: '关闭',
  cancel: '取消',
  save: '保存',

  apiConfig: 'API 配置',
  memoryRules: '记忆 & 规则',
  dataManagement: '数据管理',

  provider: '服务商',
  apiKey: 'API Key',
  showApiKey: '显示 API Key',
  hideApiKey: '隐藏 API Key',
  baseUrl: 'Base URL',
  modelName: '模型名',

  howToGet: '如何获取？',
  officialGuide: '官方获取方法',
  goToProviderConsole: '前往 {provider} 官方控制台创建 API Key，并在模型列表中查看可用的模型名。',

  apiKeySecurityNote:
    'API Key 仅存储在当前浏览器 localStorage，不会上传到任何服务器（除你配置的 LLM 服务商外）',

  pleaseFillApiKey: '请先填写 API Key',
  pleaseFillBaseUrl: '请先填写 Base URL',
  pleaseFillModelName: '请先填写模型名',
  testConnection: '测试连接',
  testing: '测试中...',
  settingsSaved: '设置已保存',

  memoryFunction: '记忆功能',
  enableGlobalMemory: '开启全局记忆（自动提取 + 注入，跨项目共享）',
  enableProjectMemory: '开启项目记忆（自动提取 + 注入，仅当前项目）',
  memoryFrequency: '记忆提取频率（每 N 轮 AI 回答提取一次）',

  conflictDetection: '冲突检测',
  enableConflictAutoCheck: '开启冲突自动检测（每次回答后自动分析支线矛盾）',
  conflictCheckFrequency: '冲突检测频率（每 N 轮检测一次）',

  userRules: '用户规则 / 补充指令（注入到 system prompt，如技术栈、偏好）',
  userRulesPlaceholder: '例如：我是 Java 出身，使用 Cloudflare 部署，优先考虑性能而非可读性...',
  userRulesNote: '默认人设不开放编辑；此处仅添加补充规则，自由度高的用户可自行部署开源版本修改。',

  openMemoryPanel: '打开记忆管理面板（查看/编辑/删除记忆条目）',

  memoryManagement: '记忆管理',
  globalMemory: '全局记忆',
  projectMemory: '项目记忆',
  entriesCount: '{count} 条',
  crossProject: '跨项目',

  add: '添加',
  edit: '编辑',
  auto: '自动',
  manual: '手动',

  addGlobalMemoryPlaceholder: '添加全局记忆条目...',
  addProjectMemoryPlaceholder: '添加项目记忆条目...',

  noGlobalMemory: '暂无全局记忆',
  noProjectMemory: '暂无项目记忆',
  pleaseSelectProject: '请先选择一个项目',

  storageOverview: '本地存储总览',
  totalUsage: '总占用',
  suggestedLimit: '建议上限',
  usageRate: '使用率',
  clearByCategory: '按分类清理',

  projectData: '项目数据',
  projectDataDesc: '所有蛛网项目的节点、边、视口、记忆、turnCounter',
  globalMemoryLabel: '全局记忆',
  globalMemoryDesc: '跨项目共享的长期记忆条目',
  appSettings: '应用设置',
  appSettingsDesc: '规则、频率、模式开关等（不含 API Key）',
  apiConfigLabel: 'API 配置',
  apiConfigDesc: '服务商、API Key、Base URL、模型',

  storageWarning: '本地存储接近上限，建议导出备份后清理旧项目，避免保存失败导致数据丢失。',
  clearAllData: '清空全部数据',
  clearing: '正在清空...',
  cleared: '已清理',
  clear: '清理',
  confirmClearCategory: '确定清理「{label}」吗？此操作不可恢复，建议先导出备份。',
  confirmClearAll:
    '确定清空全部本地数据吗？\n\n此操作将删除：\n• 所有项目与节点\n• 全局/项目记忆\n• 应用设置\n• API 配置\n\n删除后无法恢复，建议先导出备份。',
  reloadingPage: '即将刷新页面...',
  storageTip:
    '提示：浏览器 localStorage 单域名配额约 5MB，适合中小型项目。大型项目建议定期导出备份后清理，避免保存失败。',

  helpTooltip:
    '输入问题 → AI 给出建议方向 → 点击方向卡片可补充后继续追问 → 不满意可重新生成 → 可随时回退到任意节点换方向',
  toggleSidebar: '切换侧边栏',
  collapseSidebar: '收起侧边栏',
  expandSidebar: '展开侧边栏',
  toggleTheme: '切换主题',
  skipToContent: '跳转到主内容',
  lightMode: '切换到亮色模式',
  darkMode: '切换到暗色模式',
  systemMode: '切换到跟随系统',
  help: '帮助',

  notConfigured: '未配置 API Key',
  clickToConfigure: '点击配置 API Key',
  clickToModify: '点击修改 API Key 配置',

  startYourDebug: '开始你的蛛网式排查',
  startYourDebugDesc: '描述你的问题，AI 会像蛛网一样展开不同排查方向',
  inputPlaceholder: '输入你的问题开始排查...',
  startDebug: '开始排查',
  enterSubmit: 'Enter 提交 · Shift+Enter 换行',

  pleaseConfigureApiKey: '请先配置 API Key',

  loadingEditor: '加载蛛网编辑器...',

  githubRepo: 'GitHub 仓库',
  sponsor: '赞赏支持',
  ale160: '阿乐一百六',

  closeInspector: '关闭',

  // Inspector 三 Tab 标签
  inspectorTabConversation: '对话',
  inspectorTabContext: '上下文',
  inspectorTabActions: '操作',
  // 上下文 Tab：注入记忆分区标题与空态
  pathMemoryTitle: '注入的记忆',
  noPathMemory: '当前无注入的记忆条目',
  // 上下文 Tab：路径摘要（rolling summary）展示
  pathSummaryTitle: '路径摘要',
  pathSummaryDesc: '从根到当前节点的聚合结论',
  pathSummaryNotGenerated: '尚未生成',
  pathLengthLabel: '路径长度',
  hybridModeOn: '已启用混合模式（前段摘要 + 后段完整）',
  hybridModeOff: '未启用混合模式（完整拼接）',
  // 设置：可观测性开关
  observabilitySettings: '可观测性',
  hoverShowPathSummary: 'hover 节点时显示路径摘要（默认关闭）',
  // 设置：上下文压缩配置区（T007）
  contextCompression: '上下文压缩',
  enableHybridMode: '启用混合模式（前段摘要 + 后段完整）',
  pathLengthThreshold: '路径长度阈值（超过此节点数启用混合模式）',
  recentKeepCount: '保留完整节点数（后段长度）',
  summaryMaxLength: '摘要最大字数',
  contextCompressionNote:
    '不同模型上下文窗口差异大，按服务商预设默认值；8K 模型建议保守阈值，128K 模型可放宽，2M 上下文模型可关闭混合模式。',
  contextCompressionCurrentPreset: '当前服务商预设',

  aiThinking: 'AI 思考中...',
  errorOccurred: '出错了：{message}',
  unknownError: '未知错误',
  cancelled: '用户取消',
  waitingForGeneration: '等待生成...',

  conflictLabel: '冲突标注',
  abandonBranch: '弃用支线',
  pruneNode: '裁剪节点',
  ignoreNode: '忽略节点',
  clearLabel: '清除标注',
  confirmPruneNode: '将删除此节点及其所有下游子节点，确定裁剪？',

  mergeSources: '合并来源（{count} 路）',
  branchN: '分支 {n}',
  nodeDeleted: '节点已删除',
  conflictLimitNote: '冲突检测仅分析 parentId 主干路径，不展开合并来源多路（已知限制）',

  possibleNextDirections: '可能的下一步方向',

  continueQuestion: '继续追问',
  regenerate: '重新生成',
  restoreBranch: '恢复支线',
  abandonThisBranch: '放弃此支线',
  unignore: '取消忽略',
  ignoreThisNode: '忽略此节点',
  detectConflict: '检测冲突',
  detecting: '检测中...',

  branchAbandoned: '此支线已放弃，可恢复后继续',
  nodeIgnored: '此节点已忽略，构建上下文时跳过，可随时取消忽略',

  inputFollowUpPlaceholder: '输入追问或新方向...',

  mergeNodeLimitTitle: '合并节点限制',
  mergeNodeLimitDesc: '合并节点：仅检测 parentId 主干路径，不展开 mergedFromIds 多路（已知限制）',

  conversation: '对话',
  merge: '合并',
  ignored: '已忽略',
  nRoutes: '{count} 路',
  you: '你',
  ai: 'AI',
  thinking: '思考中...',
  nDirections: '{count} 个方向',
  conflict: '冲突',

  detailedMode: '详细模式',
  compactMode: '紧凑模式',

  mergePrompt: '合并 {n} 个分支为新节点，请输入合并意图：',
  mergeDefaultIntent: '结合这些分支的结论给出下一步',
  clickToEditProjectName: '点击编辑项目名',
  focusModeOnHint: '当前为聚焦模式，点击显示全部节点',
  focusModeOffHint: '开启聚焦模式：仅显示选中路径与子树',
  showAll: '显示全部',
  focusCurrent: '聚焦当前',
  focusHint: '节点较多（{n} 个），建议开启聚焦模式',
  enable: '开启',
  mergeBranches: '合并分支（{n}）',
  mergeBranchesTitle: '合并选中的 {n} 个节点为新支线根',
  selectTool: '选择工具 (V)',
  handTool: '抓手工具 (H / 按住空格)',
  zoomIn: '放大 (Ctrl + 滚轮)',
  zoomOut: '缩小 (Ctrl + 滚轮)',
  fitView: '适应视图 (F)',
  projectName: '项目名',

  language: '语言',
  chinese: '中文',
  english: 'English',
  languageSwitched: '已切换至中文',

  beta: 'Beta',
  attachmentN: '附件 {n}',

  poweredBy: '由阿乐一百六提供技术支持',
  visitWebsite: '访问网站',

  copy: '复制',
  copied: '已复制到剪贴板',
  copyFailed: '复制失败',

  shortcutTitle: '画布操作指南',
  shortcutSubtitle: '快捷键 & 操作说明',
  shortcutGroupCanvas: '画布操作',
  shortcutGroupTool: '工具切换',
  shortcutGroupNode: '节点操作',
  shortcutActionZoomIn: '放大画布',
  shortcutActionZoomOut: '缩小画布',
  shortcutActionHandDrag: '抓手平移',
  shortcutActionFitView: '适应视图',
  shortcutActionSelect: '选择工具',
  shortcutActionHand: '抓手工具',
  shortcutActionTempHand: '临时抓手',
  shortcutActionClickSelect: '选中节点',
  shortcutActionMultiSelect: '多选',
  shortcutActionDeleteNode: '删除节点',
  shortcutDescZoom: '以鼠标为中心',
  shortcutDescHandDrag: '按住空格拖动',
  shortcutDescTempHand: '按住临时切换',
  shortcutDescDelete: '删除选中的节点',
  shortcutDescSelect: '默认，可框选节点',
  shortcutDescHand: '拖拽平移画布',
  shortcutDescFitView: '所有节点居中显示',
  shortcutTip:
    '按住空格键可以临时切换到抓手工具，快速平移画布。滚轮缩放会以鼠标位置为中心进行缩放。',
  shortcutSearchPlaceholder: '搜索快捷键...',
  shortcutNoMatch: '没有匹配的快捷键',
  statusFailed: '生成失败',
  minimapLabel: '蛛网节点小地图',
  nodesRunning: '{count} 个节点生成中',
  previousNode: '上一个节点',
  nextNode: '下一个节点',
  cancelRunning: '取消生成',

  // ========== 侧边栏与分支管理（T009） ==========
  searchProjects: '搜索项目（名称 / 摘要）...',
  pinnedSection: '已置顶',
  projectsSection: '项目',
  pin: '置顶',
  unpin: '取消置顶',
  noSearchResult: '无匹配项目',
  forkFromHere: '从此处分叉',
  forkHint: '下一条消息将作为此节点的新子分支',
  branchCount: '{count} 个分支',
  branchSwitcher: '分支切换',
  prevBranch: '上一个分支',
  nextBranch: '下一个分支',
  branchIndex: '{index} / {total}',
  mergedBadge: 'merged',

  // ========== 自动推演（AutoEvolution） ==========
  autoEvolutionTitle: '自动推演',
  autoEvolutionSubtitle: '从当前节点的有效叶节点出发，AI 自动蔓延探索',
  autoEvolutionStart: '启动推演',
  autoEvolutionStop: '停止推演',
  autoEvolutionClose: '关闭',
  autoEvolutionStartBtn: '开始推演',
  autoEvolutionMaxSteps: '最大步数',
  autoEvolutionMaxBranches: '分叉上限',
  autoEvolutionConfidenceThreshold: '置信度阈值',
  autoEvolutionCostEstimate: '成本预估',
  autoEvolutionEstimatedCalls: '预计 LLM 调用次数',
  autoEvolutionEstimatedTokens: '预计 Token 估算',
  autoEvolutionCalls: '{count} 次',
  autoEvolutionTokens: '约 {count} tokens',
  autoEvolutionProgress: '推演进度',
  autoEvolutionCurrentStep: '当前步数',
  autoEvolutionActiveBranches: '活跃分支',
  autoEvolutionProducedNodes: '已产生节点',
  autoEvolutionStepN: '第 {step} / {max} 步',
  autoEvolutionStepLabel: '第 {step} 步',
  autoEvolutionDone: '推演完成',
  autoEvolutionStopped: '推演已停止',
  autoEvolutionTotalNodes: '节点总数',
  autoEvolutionTotalBranches: '分支数',
  autoEvolutionDeleteThisRun: '删除本次推演',
  autoEvolutionDeleteBranch: '删除此路',
  autoEvolutionConfirmDelete: '确定删除本次推演产生的 {count} 个节点？此操作不可撤销。',
  autoEvolutionConfirmDeleteBranch: '确定删除此路推演产生的 {count} 个节点？',
  autoEvolutionDeleted: '已删除本次推演',
  autoEvolutionNeedSelectNode: '请先选中一个节点',
  autoEvolutionSelectNodeFirst: '需选中节点才能启动推演',
  autoEvolutionNoEffectiveLeaves: '未找到有效叶节点（可能已全部静默）',
  autoEvolutionLowConfidenceTitle: '置信度较低，是否继续？',
  autoEvolutionLowConfidenceDesc: 'AI 对当前方向不够确定，请确认',
  autoEvolutionNodeSummary: '当前节点摘要',
  autoEvolutionReasoning: 'AI 不确定原因',
  autoEvolutionContinue: '继续往这个方向',
  autoEvolutionChangeDirection: '换一个方向',
  autoEvolutionNewDirectionPlaceholder: '输入新的探索方向...',
  autoEvolutionStopRun: '停止推演',
  autoEvolutionNodeTooltip: '自动推演产生 · 第 {step} 步 · 置信度 {confidence}',
  autoEvolutionMetaTitle: '推演元数据',
  autoEvolutionClearMeta: '清除推演标记',
  autoEvolutionConfirmClearMeta: '清除此节点的推演标记？节点会转为普通节点。',
  autoEvolutionMetaCleared: '推演标记已清除',
  autoEvolutionStartFailed: '推演启动失败：{message}',
  autoEvolutionRunning: '推演进行中...',
  autoEvolutionPaused: '推演已暂停，等待确认',
  autoEvolutionNoEvolutionMeta: '此节点非推演产生',
  autoEvolutionConfidence: '置信度',
  autoEvolutionStartNode: '推演起点',
  autoEvolutionReasoningLabel: '生成理由',
  autoEvolutionBranchNodes: '{count} 个节点',
  autoEvolutionEntry: '自动推演',
  autoEvolutionEntryHint: '从选中节点子树的有效叶节点开始 AI 自动蔓延',
  autoEvolutionConverged: '已收敛',
  autoEvolutionNotConfigured: '请先配置 API Key 再启动推演',
};

export const STRINGS_EN = {
  appName: 'Spider Web · AI Debug',
  appTitle: 'Spider Web · AI Debug — Web-style Context Management Tool',
  appDescription:
    'Transform AI conversations from linear lists into a git-repository-like web structure. Each branch maintains its own context path independently, supporting forking, merging, abandoning, and restoring — so complex problem debugging is no longer polluted by irrelevant history.',

  projectList: 'Project List',
  newProject: 'New Project',
  noProjects: 'No projects yet, click above to create one',
  nodesCount: '{count} nodes',
  justNow: 'Just now',
  minutesAgo: '{count} min ago',
  hoursAgo: '{count} hr ago',
  daysAgo: '{count} days ago',

  rename: 'Rename',
  export: 'Export',
  delete: 'Delete',
  moreActions: 'More actions',

  renameProject: 'Rename project:',
  confirmDeleteProject: 'Delete project "{name}"? This cannot be undone.',
  importFailed: 'Import failed: invalid file format',
  importedProjectName: 'Imported Project',
  importFromJson: 'Import from JSON file',

  derivedFrom: 'Derived from {name}',
  deleted: 'Deleted',
  jumpToOriginal: 'Jump to original',

  aiPruneNetwork: 'AI Prune Network',
  aiPruneFailed: 'AI prune failed: {message}',

  noProjectSelected: 'No project selected',

  settings: 'Settings',
  close: 'Close',
  cancel: 'Cancel',
  save: 'Save',

  apiConfig: 'API Config',
  memoryRules: 'Memory & Rules',
  dataManagement: 'Data Management',

  provider: 'Provider',
  apiKey: 'API Key',
  showApiKey: 'Show API Key',
  hideApiKey: 'Hide API Key',
  baseUrl: 'Base URL',
  modelName: 'Model Name',

  howToGet: 'How to get?',
  officialGuide: 'Official Guide',
  goToProviderConsole:
    'Go to {provider} console to create an API Key and check available model names.',

  apiKeySecurityNote:
    'API Key is stored only in your browser localStorage, never uploaded to any server (except your configured LLM provider).',

  pleaseFillApiKey: 'Please fill in the API Key',
  pleaseFillBaseUrl: 'Please fill in the Base URL',
  pleaseFillModelName: 'Please fill in the model name',
  testConnection: 'Test Connection',
  testing: 'Testing...',
  settingsSaved: 'Settings saved',

  memoryFunction: 'Memory Function',
  enableGlobalMemory: 'Enable global memory (auto extract + inject, shared across projects)',
  enableProjectMemory: 'Enable project memory (auto extract + inject, current project only)',
  memoryFrequency: 'Memory extraction frequency (every N AI responses)',

  conflictDetection: 'Conflict Detection',
  enableConflictAutoCheck:
    'Enable auto conflict detection (analyze branch contradictions after each response)',
  conflictCheckFrequency: 'Conflict detection frequency (every N turns)',

  userRules:
    'User Rules / Additional Instructions (injected into system prompt, e.g. tech stack, preferences)',
  userRulesPlaceholder:
    'e.g., I come from Java background, deploy on Cloudflare, prioritize performance over readability...',
  userRulesNote:
    'Default persona is not editable; this only adds supplementary rules. Advanced users can self-host the open-source version to modify.',

  openMemoryPanel: 'Open Memory Management Panel (view/edit/delete memory entries)',

  memoryManagement: 'Memory Management',
  globalMemory: 'Global Memory',
  projectMemory: 'Project Memory',
  entriesCount: '{count} entries',
  crossProject: 'cross-project',

  add: 'Add',
  edit: 'Edit',
  auto: 'Auto',
  manual: 'Manual',

  addGlobalMemoryPlaceholder: 'Add global memory entry...',
  addProjectMemoryPlaceholder: 'Add project memory entry...',

  noGlobalMemory: 'No global memory yet',
  noProjectMemory: 'No project memory yet',
  pleaseSelectProject: 'Please select a project first',

  storageOverview: 'Local Storage Overview',
  totalUsage: 'Total Usage',
  suggestedLimit: 'Suggested Limit',
  usageRate: 'Usage',
  clearByCategory: 'Clear by Category',

  projectData: 'Project Data',
  projectDataDesc: 'All web project nodes, edges, viewport, memory, turnCounter',
  globalMemoryLabel: 'Global Memory',
  globalMemoryDesc: 'Long-term memory entries shared across projects',
  appSettings: 'App Settings',
  appSettingsDesc: 'Rules, frequency, mode switches, etc. (excluding API Key)',
  apiConfigLabel: 'API Config',
  apiConfigDesc: 'Provider, API Key, Base URL, model',

  storageWarning:
    'Local storage is near the limit. We recommend exporting backups and cleaning old projects to avoid data loss from save failures.',
  clearAllData: 'Clear All Data',
  clearing: 'Clearing...',
  cleared: 'Cleared',
  clear: 'Clear',
  confirmClearCategory: 'Clear "{label}"? This cannot be undone, we recommend exporting first.',
  confirmClearAll:
    'Clear all local data?\n\nThis will delete:\n• All projects and nodes\n• Global/project memory\n• App settings\n• API config\n\nCannot be undone. Export backup first is recommended.',
  reloadingPage: 'Reloading page...',
  storageTip:
    'Tip: Browser localStorage quota is about 5MB per domain, suitable for small-to-medium projects. For large projects, export backups and clean up regularly to avoid save failures.',

  helpTooltip:
    'Type a question → AI suggests directions → Click a direction card to follow up → Regenerate if unsatisfied → Roll back to any node to try a different path',
  toggleSidebar: 'Toggle sidebar',
  collapseSidebar: 'Collapse sidebar',
  expandSidebar: 'Expand sidebar',
  toggleTheme: 'Toggle theme',
  skipToContent: 'Skip to main content',
  lightMode: 'Switch to light mode',
  darkMode: 'Switch to dark mode',
  systemMode: 'Switch to system theme',
  help: 'Help',

  notConfigured: 'API Key not configured',
  clickToConfigure: 'Click to configure API Key',
  clickToModify: 'Click to modify API Key config',

  startYourDebug: 'Start your web-style debugging',
  startYourDebugDesc:
    'Describe your problem, AI will unfold different debugging directions like a spider web',
  inputPlaceholder: 'Type your question to start debugging...',
  startDebug: 'Start Debug',
  enterSubmit: 'Enter to submit · Shift+Enter for new line',

  pleaseConfigureApiKey: 'Please configure API Key first',

  loadingEditor: 'Loading web editor...',

  githubRepo: 'GitHub Repo',
  sponsor: 'Sponsor',
  ale160: 'ale160',

  closeInspector: 'Close',

  // Inspector three tabs
  inspectorTabConversation: 'Chat',
  inspectorTabContext: 'Context',
  inspectorTabActions: 'Actions',
  // Context Tab: injected memory section title and empty state
  pathMemoryTitle: 'Injected Memory',
  noPathMemory: 'No injected memory entries',
  // Context Tab: path summary (rolling summary) display
  pathSummaryTitle: 'Path Summary',
  pathSummaryDesc: 'Aggregated conclusions from root to current node',
  pathSummaryNotGenerated: 'Not generated yet',
  pathLengthLabel: 'Path length',
  hybridModeOn: 'Hybrid mode enabled (front summary + recent full)',
  hybridModeOff: 'Hybrid mode disabled (full concatenation)',
  // Settings: observability toggles
  observabilitySettings: 'Observability',
  hoverShowPathSummary: 'Show path summary on node hover (off by default)',
  // Settings: context compression config (T007)
  contextCompression: 'Context Compression',
  enableHybridMode: 'Enable hybrid mode (front summary + recent full)',
  pathLengthThreshold: 'Path length threshold (enable hybrid mode beyond this node count)',
  recentKeepCount: 'Keep recent full nodes (rear length)',
  summaryMaxLength: 'Summary max length (chars)',
  contextCompressionNote:
    'Model context windows vary; defaults are preset per provider. Conservative for 8K, relaxed for 128K, disable hybrid mode for 2M models.',
  contextCompressionCurrentPreset: 'Current provider preset',

  aiThinking: 'AI is thinking...',
  errorOccurred: 'Error: {message}',
  unknownError: 'Unknown error',
  cancelled: 'Cancelled',
  waitingForGeneration: 'Waiting for generation...',

  conflictLabel: 'Conflict Label',
  abandonBranch: 'Abandon Branch',
  pruneNode: 'Prune Node',
  ignoreNode: 'Ignore Node',
  clearLabel: 'Clear Label',
  confirmPruneNode: 'Delete this node and all its downstream children, confirm prune?',

  mergeSources: 'Merge Sources ({count})',
  branchN: 'Branch {n}',
  nodeDeleted: 'Node deleted',
  conflictLimitNote:
    'Conflict detection only analyzes the parentId main path, not multi-path merged sources (known limitation)',

  possibleNextDirections: 'Possible Next Directions',

  continueQuestion: 'Continue',
  regenerate: 'Regenerate',
  restoreBranch: 'Restore Branch',
  abandonThisBranch: 'Abandon Branch',
  unignore: 'Unignore',
  ignoreThisNode: 'Ignore This Node',
  detectConflict: 'Detect Conflict',
  detecting: 'Detecting...',

  branchAbandoned: 'This branch is abandoned. Restore to continue.',
  nodeIgnored: 'This node is ignored and skipped when building context. You can unignore anytime.',

  inputFollowUpPlaceholder: 'Type follow-up or new direction...',

  mergeNodeLimitTitle: 'Merge Node Limitation',
  mergeNodeLimitDesc:
    'Merge nodes: only the parentId main path is detected, mergedFromIds multi-paths are not expanded (known limitation)',

  conversation: 'Chat',
  merge: 'Merge',
  ignored: 'Ignored',
  nRoutes: '{count} ways',
  you: 'You',
  ai: 'AI',
  thinking: 'thinking...',
  nDirections: '{count} directions',
  conflict: 'Conflict',

  detailedMode: 'Detailed',
  compactMode: 'Compact',

  mergePrompt: 'Merge {n} branches into a new node, please enter the merge intent:',
  mergeDefaultIntent: 'Combine the conclusions of these branches for the next step',
  clickToEditProjectName: 'Click to edit project name',
  focusModeOnHint: 'Currently in focus mode, click to show all nodes',
  focusModeOffHint: 'Enable focus mode: show only selected path and subtree',
  showAll: 'Show All',
  focusCurrent: 'Focus Current',
  focusHint: 'Many nodes ({n}), recommend enabling focus mode',
  enable: 'Enable',
  mergeBranches: 'Merge Branches ({n})',
  mergeBranchesTitle: 'Merge {n} selected nodes into a new branch root',
  selectTool: 'Select Tool (V)',
  handTool: 'Hand Tool (H / Hold Space)',
  zoomIn: 'Zoom In (Ctrl + Scroll)',
  zoomOut: 'Zoom Out (Ctrl + Scroll)',
  fitView: 'Fit View (F)',
  projectName: 'Project Name',

  language: 'Language',
  chinese: '中文',
  english: 'English',
  languageSwitched: 'Switched to English',

  beta: 'Beta',
  attachmentN: 'Attachment {n}',

  poweredBy: 'Powered by ale160',
  visitWebsite: 'Visit website',

  copy: 'Copy',
  copied: 'Copied to clipboard',
  copyFailed: 'Copy failed',

  shortcutTitle: 'Canvas Guide',
  shortcutSubtitle: 'Shortcuts & Operations',
  shortcutGroupCanvas: 'Canvas',
  shortcutGroupTool: 'Tools',
  shortcutGroupNode: 'Nodes',
  shortcutActionZoomIn: 'Zoom In',
  shortcutActionZoomOut: 'Zoom Out',
  shortcutActionHandDrag: 'Hand Pan',
  shortcutActionFitView: 'Fit View',
  shortcutActionSelect: 'Select Tool',
  shortcutActionHand: 'Hand Tool',
  shortcutActionTempHand: 'Temp Hand',
  shortcutActionClickSelect: 'Select Node',
  shortcutActionMultiSelect: 'Multi Select',
  shortcutActionDeleteNode: 'Delete Node',
  shortcutDescZoom: 'Around mouse',
  shortcutDescHandDrag: 'Hold Space + drag',
  shortcutDescTempHand: 'Hold to switch',
  shortcutDescDelete: 'Delete selected',
  shortcutDescSelect: 'Default, box-select',
  shortcutDescHand: 'Drag to pan',
  shortcutDescFitView: 'Center all nodes',
  shortcutTip:
    'Hold Space to temporarily switch to the hand tool. Scroll to zoom around the mouse position.',
  shortcutSearchPlaceholder: 'Search shortcuts...',
  shortcutNoMatch: 'No matching shortcuts',
  statusFailed: 'Generation failed',
  minimapLabel: 'Network node minimap',
  nodesRunning: '{count} nodes generating',
  previousNode: 'Previous node',
  nextNode: 'Next node',
  cancelRunning: 'Cancel generation',

  // ========== Sidebar & Branch Management (T009) ==========
  searchProjects: 'Search projects (name / summary)...',
  pinnedSection: 'Pinned',
  projectsSection: 'Projects',
  pin: 'Pin',
  unpin: 'Unpin',
  noSearchResult: 'No matching projects',
  forkFromHere: 'Fork from here',
  forkHint: 'Next message will start a new child branch from this node',
  branchCount: '{count} branches',
  branchSwitcher: 'Switch branch',
  prevBranch: 'Previous branch',
  nextBranch: 'Next branch',
  branchIndex: '{index} / {total}',
  mergedBadge: 'merged',

  // ========== Auto Evolution ==========
  autoEvolutionTitle: 'Auto Evolution',
  autoEvolutionSubtitle:
    'From the effective leaves of the selected node, AI auto-spreads to explore',
  autoEvolutionStart: 'Start Evolution',
  autoEvolutionStop: 'Stop Evolution',
  autoEvolutionClose: 'Close',
  autoEvolutionStartBtn: 'Start Evolution',
  autoEvolutionMaxSteps: 'Max Steps',
  autoEvolutionMaxBranches: 'Max Branches',
  autoEvolutionConfidenceThreshold: 'Confidence Threshold',
  autoEvolutionCostEstimate: 'Cost Estimate',
  autoEvolutionEstimatedCalls: 'Estimated LLM Calls',
  autoEvolutionEstimatedTokens: 'Estimated Tokens',
  autoEvolutionCalls: '{count} calls',
  autoEvolutionTokens: '~{count} tokens',
  autoEvolutionProgress: 'Progress',
  autoEvolutionCurrentStep: 'Current Step',
  autoEvolutionActiveBranches: 'Active Branches',
  autoEvolutionProducedNodes: 'Produced Nodes',
  autoEvolutionStepN: 'Step {step} / {max}',
  autoEvolutionStepLabel: 'Step {step}',
  autoEvolutionDone: 'Evolution Done',
  autoEvolutionStopped: 'Evolution Stopped',
  autoEvolutionTotalNodes: 'Total Nodes',
  autoEvolutionTotalBranches: 'Total Branches',
  autoEvolutionDeleteThisRun: 'Delete This Run',
  autoEvolutionDeleteBranch: 'Delete This Branch',
  autoEvolutionConfirmDelete:
    'Delete {count} nodes produced by this evolution? This cannot be undone.',
  autoEvolutionConfirmDeleteBranch: 'Delete {count} nodes produced by this branch?',
  autoEvolutionDeleted: 'Evolution deleted',
  autoEvolutionNeedSelectNode: 'Please select a node first',
  autoEvolutionSelectNodeFirst: 'Select a node to start evolution',
  autoEvolutionNoEffectiveLeaves: 'No effective leaves found (may all be abandoned)',
  autoEvolutionLowConfidenceTitle: 'Low confidence, continue?',
  autoEvolutionLowConfidenceDesc: 'AI is unsure about the current direction, please confirm',
  autoEvolutionNodeSummary: 'Current Node Summary',
  autoEvolutionReasoning: 'AI Uncertainty Reason',
  autoEvolutionContinue: 'Continue This Direction',
  autoEvolutionChangeDirection: 'Change Direction',
  autoEvolutionNewDirectionPlaceholder: 'Type a new exploration direction...',
  autoEvolutionStopRun: 'Stop Evolution',
  autoEvolutionNodeTooltip: 'Auto-evolved · Step {step} · Confidence {confidence}',
  autoEvolutionMetaTitle: 'Evolution Meta',
  autoEvolutionClearMeta: 'Clear Evolution Meta',
  autoEvolutionConfirmClearMeta: 'Clear evolution meta of this node? It will become a normal node.',
  autoEvolutionMetaCleared: 'Evolution meta cleared',
  autoEvolutionStartFailed: 'Evolution start failed: {message}',
  autoEvolutionRunning: 'Evolving...',
  autoEvolutionPaused: 'Paused, waiting for confirmation',
  autoEvolutionNoEvolutionMeta: 'This node is not produced by evolution',
  autoEvolutionConfidence: 'Confidence',
  autoEvolutionStartNode: 'Evolution Start',
  autoEvolutionReasoningLabel: 'Reasoning',
  autoEvolutionBranchNodes: '{count} nodes',
  autoEvolutionEntry: 'Auto Evolution',
  autoEvolutionEntryHint: 'AI auto-spreads from effective leaves of selected node subtree',
  autoEvolutionConverged: 'Converged',
  autoEvolutionNotConfigured: 'Please configure API Key before starting evolution',
};

export type Strings = typeof STRINGS_ZH;

export function getStrings(lang: Language = 'zh'): Strings {
  return lang === 'en' ? STRINGS_EN : STRINGS_ZH;
}

export function formatString(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    return String(vars[key] ?? `{${key}}`);
  });
}
