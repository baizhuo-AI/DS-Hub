(() => {
  'use strict';

  const SNAPSHOT = window.DSH_SNAPSHOT;
  const app = document.getElementById('app');
  if (!SNAPSHOT) {
    app.innerHTML = '<div style="max-width:760px;margin:80px auto;padding:24px;border:1px solid #fecaca;border-radius:14px;background:#fff;color:#991b1b">真实配置快照未加载。请先运行 <code>node scripts/sync-dsh-snapshot.mjs</code>。</div>';
    return;
  }

  function readAgentName() {
    try { return window.localStorage?.getItem('ds-hub-agent-name') || 'Deepseek Agent'; }
    catch (_) { return 'Deepseek Agent'; }
  }

  const state = {
    view: 'workshop',
    module: null,
    capability: null,
    componentDetail: null,
    componentLimit: 12,
    libraryOpen: false,
    libraryTab: 'native',
    libraryQuery: '',
    libraryScrollTop: 0,
    componentReturnToLibrary: false,
    presetDrawer: false,
    recommendationsOpen: false,
    avatarMode: 'logo',
    assistantOpen: false,
    assistantDraft: '',
    assistantConversationId: `ds-hub-${Date.now().toString(36)}`,
    assistantMessages: [],
    assistantProposal: null,
    assistantPlans: [],
    assistantConfirming: false,
    assistantApplying: false,
    assistantThinking: false,
    assistantAIStatus: 'idle',
    appliedOverrides: {},
    agentName: readAgentName(),
    agentNameEditing: false,
  };
  let lastAvatarTapAt = 0;
  let lastAvatarTouchToggleAt = 0;
  let proposalCounter = 0;
  let assistantRequestControl = null;
  let dialogReturnSelector = null;
  let lastAssistantMobileSheet = null;

  const MODULES = {
    sense:  { name: '感知', en: 'Perception', body: '眼 / 耳 / 触角', icon: '⌁', desc: '决定它能接触和理解哪些当前信息' },
    memory: { name: '记忆', en: 'Memory', body: '背部记忆匣', icon: '◫', desc: '决定它能保存什么、以后怎样找回来' },
    mind:   { name: '心智', en: 'Mind', body: '额心脑核', icon: '◇', desc: '决定它怎样理解任务、思考和推进' },
    tools:  { name: '工具', en: 'Tools', body: '双手', icon: '⌘', desc: '决定它具体可以使用哪些做事手段' },
    action: { name: '行动', en: 'Action', body: '躯干 / 双腿', icon: '▷', desc: '决定它能否执行、何时确认以及怎样恢复' },
  };

  const TYPE_META = {
    plugin: { label: '插件', short: 'P', help: 'DSH Loader 中的实际插件条目' },
    skill:  { label: 'Skill', short: 'S', help: '当前 Agent 可以按需读取的方法说明' },
    tool:   { label: '工具入口', short: 'T', help: '默认 Preset 为 Agent 组装的动作入口' },
    prompt: { label: '提示词来源', short: '文', help: '会向系统提示词贡献规则的实际组件' },
  };

  const PROPOSAL_POLICIES = {
    permissionDefault: {
      target: '网页配置 → 新会话默认权限',
      allowedValues: ['workspace-write'],
      checks: ['确认目标是新会话默认权限', '既有会话保持不变', '写入后重新读取默认权限', '新建隔离会话验证实际边界'],
    },
    reasoningEffort: {
      target: '网页配置 → 默认模型 → 推理强度',
      allowedValues: ['low', 'medium', 'high', 'xhigh', 'max'],
      checks: ['固定同一测试任务与模型版本', '记录质量、耗时和模型用量', '写入后重新读取推理强度', '只让新任务切换'],
    },
  };

  const ABILITY_DEFS = {
    sense: [
      { id: 'input', name: '接收用户材料', desc: '处理消息、附件与引用材料' },
      { id: 'workspace', name: '识别当前环境', desc: '知道项目目录、工作区和可访问位置' },
      { id: 'external', name: '获取外部信息', desc: '接入搜索服务和外部公开资料' },
      { id: 'clarify', name: '主动补问信息', desc: '缺少关键条件时向用户提问' },
    ],
    memory: [
      { id: 'conversation', name: '保留本次对话', desc: '保存会话、标题和消息状态' },
      { id: 'history', name: '查找历史记录', desc: '建立索引、查询和投影过去的会话' },
      { id: 'context', name: '控制上下文长度', desc: '计量 token，并在过长时压缩和裁剪' },
      { id: 'spill', name: '暂存大材料', desc: '把超长结果安全落盘，需要时再取回' },
    ],
    mind: [
      { id: 'model', name: '选择与调用模型', desc: '配置模型、重试和 Agent 推理循环' },
      { id: 'identity', name: '理解身份和规则', desc: '加载身份、系统提示与项目说明' },
      { id: 'plan', name: '规划和推进任务', desc: '维护计划、目标、待办与完成状态' },
      { id: 'workflow', name: '编排复杂任务', desc: '运行多阶段工作流和迭代执行' },
    ],
    tools: [
      { id: 'files', name: '处理文件', desc: '读取、搜索和编辑工作区文件' },
      { id: 'code', name: '运行命令和代码', desc: '执行 Shell、子进程与 Code Mode' },
      { id: 'web', name: '使用网络工具', desc: '把搜索能力作为工具交给 Agent' },
      { id: 'extensions', name: '扩展做事方法', desc: '加载 Skill、插件、界面和扩展协议' },
    ],
    action: [
      { id: 'permission', name: '管理权限和确认', desc: '确定权限档位，并在需要时请求确认' },
      { id: 'sandbox', name: '限制执行边界', desc: '约束文件、命令与进程的可访问范围' },
      { id: 'background', name: '持续完成长任务', desc: '管理后台任务、超时和定时工作' },
      { id: 'delegate', name: '让多个 Agent 协作', desc: '创建、查看和控制子 Agent' },
      { id: 'recovery', name: '记录与恢复运行', desc: '保留检查点、反馈、遥测和失败信息' },
    ],
  };

  const DEFAULT_CAPABILITY = {
    sense: 'external', memory: 'context', mind: 'model', tools: 'extensions', action: 'permission',
  };

  // Community candidates are research-backed presets, not part of the local DSH snapshot.
  // Popularity is a point-in-time npm signal (2026-08-20 through 2026-08-26).
  const COMMUNITY_COMPONENTS = [
    {
      id: 'dshmarket', moduleKey: 'tools', capabilityId: 'extensions',
      name: 'DSH 社区插件市场', packageName: 'dshmarket',
      desc: '在 DSH 内浏览、安装、更新和卸载社区插件。',
      downloads: 145091, license: 'MIT', version: '1.34.0',
      repo: 'https://github.com/dsh-market/dsh-market',
      risk: '会改动当前配置和插件安装状态；安装、升级和卸载都需要逐项确认。',
    },
    {
      id: 'better-sidebar', moduleKey: 'tools', capabilityId: 'files',
      name: '增强侧边工作台', packageName: 'dsh-better-sidebar',
      desc: '把文件、编辑器、终端、Git 与浏览器集中到侧边工作台。',
      downloads: 120348, license: 'MIT', version: '0.16.1',
      repo: 'https://github.com/omdsh-dev/DSH-better-sidebar',
      risk: '同时触达终端、Git、文件与浏览器，启用前应核对每一类权限边界。',
    },
    {
      id: 'task-board', moduleKey: 'mind', capabilityId: 'plan',
      name: '任务看板与定时执行', packageName: '@linxin666/dsh-client-ui-task-board',
      desc: '用真实会话执行任务，并提供看板与定时调度。',
      downloads: 103035, license: 'Apache-2.0', version: '0.3.6',
      repo: 'https://github.com/zhu1090093659/dsh-web',
      risk: '可能创建真实会话和定时任务；预置时保持关闭，启用前确认触发范围。',
    },
    {
      id: 'doctor', moduleKey: 'action', capabilityId: 'recovery',
      name: '配置诊断与恢复', packageName: '@linxin666/dsh-doctor',
      desc: '诊断当前配置，并提供受控修复、健康监控和恢复入口。',
      downloads: 59509, license: 'BSD-3-Clause', version: '0.3.6',
      repo: 'https://github.com/zhu1090093659/dsh-web',
      risk: '具备修复配置的能力；应用前必须展示差异、备份与回滚入口。',
    },
    {
      id: 'modlens', moduleKey: 'sense', capabilityId: 'input',
      name: '视觉理解 ModLens', packageName: '@liustack/modlens',
      desc: '为文本模型补充图片理解、OCR 与版面证据。',
      downloads: 54888, license: 'MIT', version: '3.25.2',
      repo: 'https://github.com/liustack/modlens',
      risk: '图片可能进入外部处理链；需检查隐私策略，并避免与另一视觉路由重复启用。',
    },
    {
      id: 'context', moduleKey: 'memory', capabilityId: 'context',
      name: '上下文透视', packageName: 'dsh-context',
      desc: '查看上下文组成、增长、压缩、剪枝和注入变化。',
      downloads: 31212, license: 'Apache-2.0', version: '0.34.1',
      repo: 'https://github.com/bowenliang123/dsh-context',
      risk: '会展示上下文和提示词内容；共享截图或日志前需要做隐私检查。',
    },
    {
      id: 'agent-teams', moduleKey: 'action', capabilityId: 'delegate',
      name: 'Agent Teams', packageName: '@nanmicoder/dsh-agent-teams',
      desc: '组织多 Agent 团队、依赖任务、消息协作与活动面板。',
      downloads: 21288, license: 'MIT', version: '0.1.14',
      repo: 'https://github.com/NanmiCoder/dsh-agent-teams',
      risk: '可能创建子 Agent、任务和消息；默认关闭自动执行，先限制并发与预算。',
    },
    {
      id: 'vision-router', moduleKey: 'sense', capabilityId: 'input',
      name: '视觉路由与像素工具', packageName: 'dsh-vision-router',
      desc: '为纯文本会话增加视觉路由、OCR、定位和像素工具。',
      downloads: 20320, license: 'MIT', version: '2.0.1',
      repo: 'https://github.com/ysr666/dsh-vision-router',
      risk: '与 ModLens 能力重叠；两者选一测试，并核对图片外发与模型调用范围。',
    },
  ];

  const PLUGIN_NAMES = [
    [/dimension-demo/, '维度 Demo 界面'],
    [/agent-default-model/, '默认模型设置'],
    [/web-search-deepseek/, 'DeepSeek 网页搜索'],
    [/agent-tool-presentation/, 'Code Mode 工具呈现'],
    [/agent-instructions/, '项目说明加载'],
    [/system-prompt/, '系统提示组装'],
    [/permission-presets/, '权限方案'],
    [/user-approval/, '用户确认'],
    [/session-persistence/, '会话持久化'],
    [/session-projection-cache/, '会话投影缓存'],
    [/session-query/, '会话查询'],
    [/session-title/, '会话标题'],
    [/session-stats/, '会话统计'],
    [/session-checkpoint/, '会话检查点'],
    [/session-reference/, '会话引用'],
    [/file-reference/, '文件引用'],
    [/attachment/, '附件处理'],
    [/compaction-tool-result-pruner/, '工具结果裁剪'],
    [/compaction-basic/, '上下文压缩'],
    [/token-meter/, 'Token 计量'],
    [/spill/, '大内容暂存'],
    [/tool-fs-search/, '文件搜索工具'],
    [/tool-fs/, '文件操作工具'],
    [/tool-bash/, 'Bash 工具'],
    [/tool-pwsh/, 'PowerShell 工具'],
    [/tool-web/, '网页工具入口'],
    [/tool-skill/, 'Skill 使用入口'],
    [/skill-filesystem/, '本地 Skill 发现'],
    [/tool-subagent-control\/list-agents/, '子 Agent 名单'],
    [/tool-subagent-control/, '子 Agent 控制'],
    [/tool-subagent/, '子 Agent 委派'],
    [/tool-workflow/, '工作流工具'],
    [/workflow-worker-thread/, '工作流执行器'],
    [/tool-ralph/, '迭代执行工具'],
    [/tool-goal/, '目标工具'],
    [/tool-todo/, '待办工具'],
    [/tool-ask-user/, '补问工具'],
    [/plan-mode/, '计划模式'],
    [/persona/, '身份设定'],
    [/llm-deepseek/, 'DeepSeek 模型接入'],
    [/llm-retry/, '模型重试'],
    [/\bdsh-llm\b/, '模型注册中心'],
    [/agent-loop/, 'Agent 推理循环'],
    [/sandbox-policy/, '沙箱规则'],
    [/bash-sandbox/, 'Bash 沙箱'],
    [/pwsh-sandbox/, 'PowerShell 沙箱'],
    [/subprocess/, '子进程执行'],
    [/jobs/, '后台任务'],
    [/timer/, '定时服务'],
    [/telemetry/, '运行遥测'],
    [/message-feedback/, '消息反馈'],
    [/plugin-inventory/, '插件清单'],
    [/api-gateway|apiproxy/, 'API 服务入口'],
    [/workspace/, '工作区管理'],
    [/storage/, '本地存储'],
    [/settings/, '设置管理'],
    [/credentials/, '凭据引用'],
    [/client-ui/, 'Web 界面组件'],
    [/client-/, '浏览器端组件'],
    [/cordis/, 'Cordis 运行组件'],
    [/typert/, '类型与远程接口'],
  ];

  function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function shortTech(moduleName) {
    return moduleName.replace(/^@deepseek-ai\//, '');
  }

  function humanPluginName(row) {
    const text = `${row.moduleName} ${row.entryId}`.toLowerCase();
    const found = PLUGIN_NAMES.find(([pattern]) => pattern.test(text));
    if (found) return found[1];
    const slug = shortTech(row.moduleName).replace(/^dsh-/, '').replace(/[-_/]+/g, ' ');
    return slug ? `运行组件 · ${slug}` : 'DSH 运行组件';
  }

  function componentScope(row) {
    if (row.entryId.startsWith('include:agent-presets:')) return '默认 Agent Preset';
    if (row.entryId === 'include:agent-presets') return 'Agent Preset 管理';
    if (row.moduleName === 'dsh-dimension-demo') return '本机自定义插件';
    if (row.moduleName.includes('client') || row.entryId.includes(':ui-')) return 'Web 界面';
    if (row.entryId.startsWith('include:')) return 'Web Profile / Host';
    return '运行时注入';
  }

  function classifyPlugin(row) {
    const s = `${row.moduleName} ${row.entryId}`.toLowerCase();
    if (/ask-user|user-question/.test(s)) return ['sense', 'clarify'];
    if (/web-search-deepseek/.test(s)) return ['sense', 'external'];
    if (/attachment|input-trigger|reference/.test(s) && !/file-reference/.test(s)) return ['sense', 'input'];
    if (/directory-picker|\bworkspace\b/.test(s)) return ['sense', 'workspace'];
    if (/compaction|token-meter|context-pressure|context-breakdown/.test(s)) return ['memory', 'context'];
    if (/spill|output-retention/.test(s)) return ['memory', 'spill'];
    if (/sqlite|query|projection-cache|session-reference/.test(s)) return ['memory', 'history'];
    if (/session|conversation|storage/.test(s)) return ['memory', 'conversation'];
    if (/persona|agent-instructions|system-prompt|locale/.test(s)) return ['mind', 'identity'];
    if (/plan|goal|todo|command/.test(s)) return ['mind', 'plan'];
    if (/workflow|ralph/.test(s)) return ['mind', 'workflow'];
    if (/llm|model|agent-loop/.test(s)) return ['mind', 'model'];
    if (/tool-web/.test(s)) return ['tools', 'web'];
    if (/tool-fs|file-reference/.test(s)) return ['tools', 'files'];
    if (/bash|pwsh|subprocess|code-runtime|tool-presentation|shell-env/.test(s)) return ['tools', 'code'];
    if (/skill|plugin|typert|cordis|client|api-|webserver|settings/.test(s)) return ['tools', 'extensions'];
    if (/permission|approval|credential/.test(s)) return ['action', 'permission'];
    if (/sandbox|policy/.test(s)) return ['action', 'sandbox'];
    if (/subagent/.test(s)) return ['action', 'delegate'];
    if (/jobs|timer|timeout|schedule/.test(s)) return ['action', 'background'];
    return ['action', 'recovery'];
  }

  function effectivePermissionDefault() {
    return state.appliedOverrides.permissionDefault ?? SNAPSHOT.config.permission.defaultPreset ?? '未记录';
  }

  function effectiveReasoningEffort() {
    return state.appliedOverrides.reasoningEffort ?? SNAPSHOT.config.model.reasoningEffort ?? '未记录';
  }

  function pluginDescription(row, ability) {
    const tech = row.moduleName;
    if (tech.includes('dsh-persona')) return '为默认 Agent 注入“编码 Agent”身份，以及实际模型与工作目录占位。';
    if (tech.includes('dsh-agent-instructions')) return '从当前项目读取 AGENTS.md 等工作说明；当前 Preset 上限为 65,536 字节。';
    if (tech.includes('dsh-web-search-deepseek')) return `使用 DeepSeek 搜索模型；当前每次任务最多 ${SNAPSHOT.config.webSearch.maxUses ?? '未记录'} 次。`;
    if (tech.includes('dsh-permission-presets')) return `默认权限方案是 ${effectivePermissionDefault()}。`;
    if (tech.includes('dsh-agent-default-model')) return `默认使用 ${SNAPSHOT.config.model.model}，推理强度 ${effectiveReasoningEffort()}。`;
    if (tech.includes('client-ui')) return '这是 Web 界面的实际功能组件，不直接增加 Agent 的推理能力。';
    return `为“${ability.name}”提供运行支持；状态来自当前 DSH Loader 回读。`;
  }

  const toolNames = {
    'tool-bash': '运行 Bash 命令',
    'tool-pwsh': '运行 PowerShell 命令',
    'tool-fs': '读取和编辑文件',
    'tool-fs-search': '搜索文件与内容',
    'tool-jobs': '管理后台任务',
    'tool-skill': '查找并使用 Skill',
    'tool-goal': '维护长期目标',
    'tool-ask-user': '向用户补问',
    'tool-todo': '维护执行待办',
    'tool-web': '搜索公开网络',
    'tool-subagent-control': '控制子 Agent',
    'tool-subagent-list-agents': '查看可用子 Agent',
    'tool-subagent': '委派子任务',
    'tool-subagent-fork': '从当前上下文派生子任务',
    'tool-subagent-codex': '调用 Codex 子 Agent',
    'tool-subagent-claude-code': '调用 Claude Code 子 Agent',
    'tool-workflow': '运行工作流',
    'tool-ralph': '按轮次持续推进',
    'tool-presentation': '用 Code Mode 组合工具',
  };

  function classifyTool(row) {
    const s = `${row.id} ${row.moduleName}`;
    if (/ask-user/.test(s)) return ['sense', 'clarify'];
    if (/tool-web/.test(s)) return ['tools', 'web'];
    if (/tool-fs/.test(s)) return ['tools', 'files'];
    if (/bash|pwsh|presentation/.test(s)) return ['tools', 'code'];
    if (/tool-skill/.test(s)) return ['tools', 'extensions'];
    if (/goal|todo/.test(s)) return ['mind', 'plan'];
    if (/workflow|ralph/.test(s)) return ['mind', 'workflow'];
    if (/subagent/.test(s)) return ['action', 'delegate'];
    if (/jobs/.test(s)) return ['action', 'background'];
    return ['tools', 'extensions'];
  }

  function buildCapabilities() {
    const result = {};
    for (const [moduleKey, defs] of Object.entries(ABILITY_DEFS)) {
      result[moduleKey] = defs.map((def) => ({ ...def, components: [] }));
    }
    const add = (moduleKey, capabilityId, component) => {
      const ability = result[moduleKey].find((item) => item.id === capabilityId);
      if (ability) ability.components.push({ ...component, path: `${MODULES[moduleKey].name} → ${ability.name}` });
    };

    for (const row of SNAPSHOT.plugins) {
      const [moduleKey, capabilityId] = classifyPlugin(row);
      const ability = result[moduleKey].find((item) => item.id === capabilityId);
      add(moduleKey, capabilityId, {
        type: 'plugin',
        name: humanPluginName(row),
        tech: row.moduleName,
        entryId: row.entryId,
        desc: pluginDescription(row, ability),
        status: row.enabled ? 'using' : 'off',
        phase: row.fiberPhase,
        scope: componentScope(row),
        evidence: '运行实例回读',
      });
    }

    for (const skill of SNAPSHOT.skills) {
      add('tools', 'extensions', {
        type: 'skill',
        name: skill.name,
        tech: skill.name,
        desc: skill.description,
        status: skill.modelInvocable ? 'using' : 'off',
        evidence: '当前 code 会话回读',
        scope: '默认 Agent Preset',
      });
    }

    for (const row of SNAPSHOT.config.presetRows.filter((item) => item.id.startsWith('tool-'))) {
      const [moduleKey, capabilityId] = classifyTool(row);
      add(moduleKey, capabilityId, {
        type: 'tool',
        name: toolNames[row.id] || humanPluginName({ moduleName: row.moduleName, entryId: row.id }),
        tech: row.config.toolName || row.id,
        provider: row.moduleName,
        desc: `由默认 ${SNAPSHOT.config.activePreset.name} Preset 组装的工具入口。`,
        status: row.enabled ? 'using' : 'off',
        config: row.config,
        evidence: 'Preset 组装文件',
        scope: '默认 Agent Preset',
      });
    }

    const pluginState = (fragment) => SNAPSHOT.plugins.some((row) => row.enabled && row.moduleName.includes(fragment));
    const rowState = (id) => SNAPSHOT.config.presetRows.find((row) => row.id === id)?.enabled !== false;
    add('mind', 'identity', {
      type: 'prompt', name: '系统提示组装', tech: '@deepseek-ai/dsh-system-prompt',
      desc: '按实际作用域把身份、项目说明和运行规则组装成系统提示。',
      status: pluginState('dsh-system-prompt') ? 'using' : 'off', evidence: '运行实例回读', scope: 'Web Profile / Host',
    });
    add('mind', 'identity', {
      type: 'prompt', name: '编码 Agent 身份', tech: '@deepseek-ai/dsh-persona',
      desc: '当前身份是编码 Agent；模型名与工作目录在会话开始时动态注入。',
      status: rowState('persona') ? 'using' : 'off', evidence: 'code Preset 组装文件', scope: '默认 Agent Preset',
    });
    add('mind', 'identity', {
      type: 'prompt', name: '项目工作说明', tech: '@deepseek-ai/dsh-agent-instructions',
      desc: '读取项目和用户级 AGENTS.md 等说明，当前最大载入 65,536 字节。',
      status: rowState('agent-instructions') ? 'using' : 'off', evidence: 'code Preset 组装文件', scope: '默认 Agent Preset',
    });
    add('mind', 'plan', {
      type: 'prompt', name: '计划模式规则', tech: '@deepseek-ai/dsh-plan-mode',
      desc: '进入计划模式后只做读取、分析和计划；获批后才进入实施。',
      status: rowState('plan-mode') ? 'using' : 'off', evidence: 'code Preset 组装文件', scope: '默认 Agent Preset',
    });
    add('action', 'permission', {
      type: 'prompt', name: '审批策略说明', tech: '@deepseek-ai/dsh-user-approval',
      desc: `向模型说明当前权限与确认边界；新会话默认 ${effectivePermissionDefault()}。`,
      status: pluginState('dsh-user-approval') ? 'using' : 'off', evidence: '运行实例回读', scope: 'Web Profile / Host',
    });

    return result;
  }

  let CAPABILITIES = {};
  let ALL_COMPONENTS = [];
  function rebuildCapabilityIndex() {
    CAPABILITIES = buildCapabilities();
    ALL_COMPONENTS = Object.entries(CAPABILITIES).flatMap(([moduleKey, abilities]) =>
      abilities.flatMap((ability) => ability.components.map((component, index) => ({ moduleKey, ability, component, index }))),
    );
  }
  rebuildCapabilityIndex();

  function formatNumber(value) {
    return new Intl.NumberFormat('zh-CN').format(value || 0);
  }

  function formatDuration(ms) {
    if (!ms) return '0 秒';
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes} 分 ${seconds % 60} 秒`;
  }

  function formatTime(timestamp) {
    if (!timestamp) return '无运行记录';
    return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
  }

  function shortSentence(value, max = 48) {
    const normalized = String(value || '暂无说明').replace(/\s+/g, ' ').trim();
    const sentence = normalized.split(/(?<=[。！？!?])/)[0] || normalized;
    if (sentence.length > max) return `${sentence.slice(0, max - 1)}…`;
    return /[。！？!?]$/.test(sentence) ? sentence : `${sentence}。`;
  }

  function componentStatusLabel(component) {
    const active = component.status === 'using';
    if (component.type === 'plugin') return active ? '已启用' : '未启用';
    if (component.type === 'skill') return active ? 'AI 可调用' : 'AI 不可主动调用';
    if (component.type === 'tool') return active ? '已组装' : '未组装';
    if (component.type === 'prompt') return active ? '已注入' : '未注入';
    return active ? '当前生效' : '未生效';
  }

  function buildRecommendations() {
    const project = SNAPSHOT.sessions.project;
    const permissionName = 'danger-full-access';
    const permissionSessions = project.permissionCounts?.[permissionName] || 0;
    const permissionDefault = state.appliedOverrides.permissionDefault ?? SNAPSHOT.config.permission.defaultPreset;
    const recordedMs = project.stats.llmMs + project.stats.toolMs;
    const llmShare = recordedMs ? Math.round(project.stats.llmMs / recordedMs * 100) : 0;
    const larkSkills = SNAPSHOT.skills.filter((skill) => /^lark-/.test(skill.name)).length;
    const recommendations = [];
    if (permissionDefault === permissionName) recommendations.push({
        id: 'permission', moduleKey: 'action', capabilityId: 'permission', confidence: '高可信', level: 'high',
        title: '收窄普通任务的默认权限',
        summary: `新会话默认 ${permissionDefault || '未记录'}；当前项目 ${permissionSessions}/${project.total} 个会话也使用该档位。普通研究任务可先用 workspace-write，越界时再确认。`,
        evidence: `Settings + ${project.total} 个项目会话`,
      });
    else if (permissionSessions > 0) recommendations.push({
      id: 'permission', moduleKey: 'action', capabilityId: 'permission', confidence: '高可信', level: 'high',
      title: '复核仍在使用高权限的旧会话',
      summary: `新会话默认权限已不是 danger-full-access，但当前项目仍有 ${permissionSessions}/${project.total} 个既有会话使用它。逐个确认是否需要保留。`,
      evidence: `${project.total} 个项目会话`,
    });
    if (recordedMs > 0 && llmShare >= 70) recommendations.push({
        id: 'model', moduleKey: 'mind', capabilityId: 'model', confidence: '中可信', level: 'medium',
        title: '先检查模型与上下文开销',
        summary: `项目记录里模型耗时占 LLM + 工具耗时的 ${llmShare}%。先检查长上下文、压缩时机和推理档位，再考虑增加工具。`,
        evidence: `${project.stats.turns} 轮 / ${project.stats.steps} 步的运行统计`,
      });
    if (SNAPSHOT.skills.length >= 20 && larkSkills / Math.max(1, SNAPSHOT.skills.length) >= .6) recommendations.push({
        id: 'skills', moduleKey: 'tools', capabilityId: 'extensions', confidence: '中可信', level: 'medium',
        title: '为当前项目收窄 Skill 清单',
        summary: `当前会话可发现 ${SNAPSHOT.skills.length} 个 Skill，其中 ${larkSkills} 个属于飞书能力。若本项目很少操作飞书，可用更轻的项目配置减少选择噪音。`,
        evidence: '当前会话可用 Skill 清单',
      });
    return recommendations;
  }

  let RECOMMENDATIONS = buildRecommendations();

  function recommendationFor(moduleKey, capabilityId) {
    return RECOMMENDATIONS.find((item) => item.moduleKey === moduleKey && item.capabilityId === capabilityId);
  }

  function communityFor(moduleKey, capabilityId) {
    return COMMUNITY_COMPONENTS.filter((item) => item.moduleKey === moduleKey && item.capabilityId === capabilityId);
  }

  function toast(message) {
    const box = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast info';
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  function bc(items) {
    return `<div class="crumbs">${items.map((item, index) => {
      const node = item.fn ? `<button type="button" onclick="${item.fn}">${esc(item.t)}</button>` : `<b>${esc(item.t)}</b>`;
      return node + (index < items.length - 1 ? '<span class="sep">›</span>' : '');
    }).join('')}</div>`;
  }

  function renderTopbar() {
    return `<div class="topbar">
      <div class="logo"><span class="lg-ico"><img src="assets/dsh-icon.svg" alt="" width="19" height="19"></span>DS <em>Hub</em></div>
      <div class="top-sep"></div>
      <span class="build-pill" title="DSH 版本 · 当前使用网页配置">DSH ${esc(SNAPSHOT.source.packageVersion)} · 网页配置</span>
      <div class="main-tabs" aria-label="主要功能">
        <button class="${state.view !== 'trial' && state.view !== 'observe' ? 'on' : ''}" onclick="goWorkshop()">能力配置</button>
        <button class="${state.view === 'observe' ? 'on' : ''}" onclick="goObserve()">运行观测</button>
        <button class="${state.view === 'trial' ? 'on' : ''}" onclick="goTrial()">效果测试</button>
      </div>
    </div>`;
  }

  function renderCoreAvatar() {
    const isGirl = state.avatarMode === 'girl';
    return `<div class="core-avatar-wrap">
      <button type="button" class="core-avatar ${isGirl ? 'girl' : 'logo-mode'}" onclick="avatarClick(event)" ondblclick="toggleAvatar(event)" onpointerup="avatarPointerUp(event)" aria-label="${isGirl ? '当前为机娘形象，双击切换为 DSH 图标' : '当前为 DSH 图标，双击切换为机娘'}">
        ${isGirl
          ? '<img class="mascot-img" src="assets/ds-mecha-girl.png" alt="DS Hub 蓝鲸机娘" decoding="async" draggable="false">'
          : '<span class="dsh-orbit"><span class="dsh-orbit-ring"></span><img class="dsh-core-logo" src="assets/dsh-icon.svg" alt="DSH 图标" draggable="false"><b>DS Hub</b><small>Agent Runtime</small></span>'}
      </button>
      <span class="avatar-hint">双击${isGirl ? '恢复图标' : '唤醒机娘'}</span>
      <button type="button" class="core-chat-bubble" onclick="openAssistant()"><span>AI 配置诊断</span><b>想先检查哪一项？</b></button>
    </div>`;
  }

  function moduleComponents(key) {
    return CAPABILITIES[key].flatMap((ability) => ability.components);
  }

  function partStatus(key) {
    return moduleComponents(key).some((component) => component.status === 'using') ? 'ok' : 'weak';
  }

  function moduleSummary(key) {
    const components = moduleComponents(key);
    const enabled = components.filter((component) => component.status === 'using').length;
    return `${CAPABILITIES[key].length} 类能力 · ${enabled}/${components.length} 个组件生效`;
  }

  function linkSVG() {
    const links = [
      { key: 'sense', d: 'M 320 150 C 312 140, 304 128, 296 118', x: 320, y: 150 },
      { key: 'mind', d: 'M 680 150 C 688 138, 696 126, 704 118', x: 680, y: 150 },
      { key: 'memory', d: 'M 320 330 C 310 360, 302 388, 296 406', x: 320, y: 330 },
      { key: 'tools', d: 'M 680 290 C 688 288, 696 286, 704 284', x: 680, y: 290 },
      { key: 'action', d: 'M 560 522 C 620 508, 668 484, 704 464', x: 560, y: 522 },
    ];
    return `<svg class="link-svg" viewBox="0 0 1000 584">${links.map((link) => {
      const status = partStatus(link.key);
      return `<path class="lk-${status}" d="${link.d}"/><circle class="anchor-${status}" cx="${link.x}" cy="${link.y}" r="5"/>`;
    }).join('')}</svg>`;
  }

  function modCard(key, style) {
    const module = MODULES[key];
    const status = partStatus(key);
    return `<button type="button" class="mod-card st-${status}" style="${style}" onclick="openModule('${key}')" aria-label="查看${module.name}模块">
      <div class="mod-head"><div><div class="mod-name">${module.name}</div><div class="mod-en">${module.en} · ${module.body}</div></div><span class="mod-dot ${status}"></span></div>
      <div class="mod-desc">${module.desc}</div>
      <div class="mod-sum"><span class="tag ok">${moduleSummary(key)}</span></div>
      <div class="mod-cta">查看真实组件 →</div>
    </button>`;
  }

  function renderRecommendations() {
    const first = RECOMMENDATIONS[0];
    if (!first) return '<section class="recommend-summary is-clear"><div><b>当前没有高优先级配置建议</b><span>继续观察真实运行数据，有明确证据时再调整。</span></div></section>';
    if (!state.recommendationsOpen) {
      return `<section class="recommend-summary" aria-label="线上数据配置建议">
        <button type="button" onclick="toggleRecommendations()" aria-expanded="false">
          <span class="rs-mark">${RECOMMENDATIONS.length}</span><span><small>根据当前运行数据</small><b>${esc(first.title)}</b></span><span class="rs-more">查看全部建议 ↓</span>
        </button>
      </section>`;
    }
    return `<section class="recommend-panel" aria-label="线上数据配置建议">
      <div class="recommend-head"><div><span>配置建议</span><h2>从运行数据里先处理这些问题</h2></div><button type="button" onclick="toggleRecommendations()" aria-expanded="true">收起 ↑</button></div>
      <div class="recommend-list">${RECOMMENDATIONS.map((item, index) => `<article class="recommend-row">
        <span class="recommend-rank">0${index + 1}</span><div class="recommend-content"><div class="recommend-title"><h3>${esc(item.title)}</h3><span class="confidence ${item.level}">${esc(item.confidence)}</span></div><p>${esc(item.summary)}</p><small>依据：${esc(item.evidence)}</small></div>
        <button type="button" class="recommend-go" onclick="jumpToCapability('${item.moduleKey}','${item.capabilityId}')">查看配置 →</button>
      </article>`).join('')}</div>
      <div class="recommend-foot">这些是配置优先级建议，不是效果结论；当前数据还没有成功率或质量标签。</div>
    </section>`;
  }

  function renderWorkshop() {
    return `<div class="page-head actual-head">
      <h1 class="page-title agent-title">${state.agentNameEditing
        ? `<input id="agent-name-input" class="agent-name-input" value="${esc(state.agentName)}" onkeydown="agentNameInputKeydown(event)" onblur="saveAgentName(this.value)" maxlength="48" aria-label="Agent 名称">`
        : `<button type="button" class="agent-name-display" onclick="agentNameClick(event)" ondblclick="startAgentRename()" title="双击改名" aria-label="${esc(state.agentName)}，双击改名">${esc(state.agentName)}</button>`}</h1>
      <div class="legend"><span><i class="lg-dot" style="background:var(--ok)"></i>当前生效</span><span><i class="lg-dot" style="background:var(--weak)"></i>当前未生效</span><span><i class="lg-dot" style="background:var(--blue)"></i>按用途分组，方便理解</span></div>
    </div>
    <div class="stage-wrap"><div class="mecha-stage">
      <div class="attire"><span class="a-label">当前角色卡</span><span class="a-name">${esc(SNAPSHOT.config.activePreset.name)}</span><span class="chip">默认</span><span class="chip">${SNAPSHOT.config.activePreset.trust === 'system' ? '系统内置' : '用户创建'}</span><button onclick="openPresetDrawer()">查看完整配置</button></div>
      <div class="mascot-holder">${renderCoreAvatar()}</div>${linkSVG()}
      ${modCard('sense', 'left:20px;top:34px')}${modCard('mind', 'left:708px;top:34px')}${modCard('memory', 'left:20px;top:330px')}${modCard('tools', 'left:708px;top:210px')}${modCard('action', 'left:708px;top:396px')}
    </div></div>
    ${renderRecommendations()}
    <div class="note-bar"><b>快照日期：</b>${esc(String(SNAPSHOT.capturedAt).slice(0, 10))}。点击任一模块查看当前配置；社区候选在组件库里单独标注，均未安装。</div>
    ${state.presetDrawer ? renderPresetDrawer() : ''}`;
  }

  function renderPresetDrawer() {
    const preset = SNAPSHOT.config.activePreset;
    return `<div class="drawer-mask" onclick="closePresetDrawer()"></div><aside class="drawer" role="dialog" aria-modal="true" tabindex="-1" aria-label="Agent Preset 详情">
      <button class="d-close" onclick="closePresetDrawer()" aria-label="关闭">✕</button>
      <h3>${esc(preset.name)} <span class="tag cy">${esc(preset.id)}</span></h3>
      <div class="d-sub">${esc(preset.description)}</div>
      <div class="plain-explain"><b>它是什么：</b>这是当前 DSH 的完整 Agent 组装，不只是角色卡。身份提示只是其中的 persona 一项。</div>
      <div class="detail-sec"><h4>当前默认值</h4>
        <div class="detail-line"><b>Preset ID</b><span class="mono">${esc(preset.id)}</span></div>
        <div class="detail-line"><b>来源</b><span>${preset.trust === 'system' ? '系统随附' : '用户目录'}</span></div>
        <div class="detail-line"><b>工具呈现</b><span>${SNAPSHOT.config.presetRows.some((row) => row.id === 'tool-presentation') ? 'Code Mode' : '原生工具调用'}</span></div>
        <div class="detail-line"><b>组装行</b><span>${SNAPSHOT.config.presetRows.length} 个插件行</span></div>
      </div>
      <div class="detail-sec"><h4>DSH 实际可用的 Preset</h4>${SNAPSHOT.config.presets.map((item) => `<div class="id-card ${item.isDefault ? 'on' : ''}"><div class="id-name">${esc(item.name || item.id)} ${item.isDefault ? '<span class="tag vio">默认</span>' : ''}</div><div class="cr-tech">${esc(item.id)} · ${item.trust === 'system' ? '系统内置' : '用户创建'}</div><div style="font-size:12px;color:var(--muted);margin-top:6px">${esc(item.description || item.broken || '无说明')}</div></div>`).join('')}</div>
      <div class="note-bar">此原型只回读配置，不在这里切换 Preset；避免把静态展示误认为已经修改了 DSH。</div>
    </aside>`;
  }

  function activeCapability(key) {
    return CAPABILITIES[key].find((item) => item.id === state.capability) || null;
  }

  function orbitPoint(index, count) {
    const angle = (-90 + index * (360 / count)) * Math.PI / 180;
    return { x: 50 + Math.cos(angle) * 39, y: 50 + Math.sin(angle) * 35 };
  }

  function renderModuleRail(key) {
    return `<aside class="module-rail" aria-label="五个能力模块"><div class="rail-label">五个模块</div>
      ${Object.entries(MODULES).map(([moduleKey, module]) => `<button type="button" class="module-switch ${moduleKey === key ? 'on' : ''}" onclick="openModule('${moduleKey}')"><span class="ms-ico">${module.icon}</span><span><b>${module.name}</b><small>${moduleSummary(moduleKey)}</small></span></button>`).join('')}
      <button type="button" class="rail-library" onclick="openLibrary()"><b>全部真实组件</b><small>${SNAPSHOT.plugins.length} 插件 · ${SNAPSHOT.skills.length} Skill · ${ALL_COMPONENTS.filter((item) => item.component.type === 'tool').length} 工具入口</small></button>
    </aside>`;
  }

  function renderComponentGroups(key, ability) {
    return Object.keys(TYPE_META).map((type) => {
      const rows = ability.components.map((component, index) => ({ component, index })).filter((item) => item.component.type === type);
      if (!rows.length) return '';
      const meta = TYPE_META[type];
      return `<section class="component-group"><div class="cg-title"><span>${meta.label}</span><span>${meta.help}</span><span>${rows.length}</span></div>
        ${rows.map(({ component, index }) => `<button type="button" class="component-row" data-component-ref="${key}-${ability.id}-${index}" onclick="openComponent('${key}','${ability.id}',${index})"><span class="type-ico ${type}">${meta.short}</span><span><span class="cr-name">${esc(component.name)}</span><span class="cr-tech">${esc(component.tech)}</span></span><span class="cr-status ${component.status === 'off' ? 'off' : ''}">${esc(componentStatusLabel(component))} ›</span></button>`).join('')}
      </section>`;
    }).join('');
  }

  function renderModule() {
    const key = state.module || 'sense';
    const module = MODULES[key];
    const abilities = CAPABILITIES[key];
    const ability = activeCapability(key);
    const componentTotal = moduleComponents(key).length;
    const dock = Object.entries(MODULES).map(([moduleKey, item]) => `<button type="button" class="${moduleKey === key ? 'on' : ''}" onclick="openModule('${moduleKey}')" aria-label="切换到${item.name}模块" ${moduleKey === key ? 'aria-current="page"' : ''} title="${item.name} · ${item.desc}"><span>${item.icon}</span><b>${item.name}</b></button>`).join('');
    const abilityNodes = abilities.map((item, index) => {
      const point = orbitPoint(index, abilities.length);
      const selected = ability?.id === item.id;
      return `<button type="button" class="ability-orbit-node ${selected ? 'on' : ''}" style="--x:${point.x.toFixed(2)}%;--y:${point.y.toFixed(2)}%" onclick="selectCapability('${item.id}')" aria-pressed="${selected}">
        <b>${esc(item.name)}</b><span class="ao-count">${item.components.length}</span><p>${esc(item.desc)}</p>${selected ? '<span class="ao-state">正在查看</span>' : ''}
      </button>`;
    }).join('');
    let unfold = `<section id="component-unfold" class="component-unfold" tabindex="-1" aria-live="polite"><div class="component-wait"><b>先选择一项能力</b>点击周围的能力，下面只展开与它有关的真实组件。</div></section>`;
    if (ability) {
      const visible = ability.components.slice(0, state.componentLimit);
      const remaining = Math.max(0, ability.components.length - visible.length);
      const recommendation = recommendationFor(key, ability.id);
      const community = communityFor(key, ability.id);
      const utilities = `${ability.id === 'model' ? '<button type="button" onclick="openLLM()">查看模型设置</button>' : ''}${ability.id === 'workflow' ? '<button type="button" onclick="openFlow()">查看工作流能力</button>' : ''}<button type="button" onclick="openLibrary('native')">搜索全部原生组件</button>`;
      unfold = `<section id="component-unfold" class="component-unfold" tabindex="-1" aria-live="polite">
        <div class="unfold-head"><span class="uh-mark">${esc(module.icon)}</span><div><h2>${esc(ability.name)}</h2><p>${esc(ability.desc)}</p></div><span class="uh-count">${ability.components.length} 个已发现组件</span></div>
        ${recommendation ? `<div class="ability-advice"><span class="confidence ${recommendation.level}">${esc(recommendation.confidence)}</span><div><b>${esc(recommendation.title)}</b><p>${esc(recommendation.summary)}</p><small>依据：${esc(recommendation.evidence)}</small></div><button type="button" onclick="askAssistant('${esc(recommendation.id)}')">让 AI 解释</button></div>` : ''}
        <div class="component-field"><div class="component-net">${visible.length ? visible.map((component, index) => `<button type="button" class="component-tile ${component.status === 'off' ? 'off' : ''}" data-component-ref="${key}-${ability.id}-${index}" onclick="openComponent('${key}','${ability.id}',${index})" aria-label="查看${esc(component.name)}详情，${esc(componentStatusLabel(component))}">
          <span class="ct-top"><span class="ct-type">${TYPE_META[component.type].label}</span><span class="ct-state" aria-hidden="true"></span><span class="ct-status-label">${esc(componentStatusLabel(component))}</span></span><h3>${esc(component.name)}</h3><p>${esc(shortSentence(component.desc))}</p>
        </button>`).join('') : '<div class="component-empty">当前快照没有发现对应组件。</div>'}</div>
        ${remaining ? `<button type="button" class="component-more" onclick="showMoreComponents()">继续展开 ${remaining} 个组件 ↓</button>` : ''}
        <div class="ability-utilities">${utilities}</div></div>
        ${community.length ? `<div class="community-shelf"><div class="community-shelf-head"><div><span>社区预置候选</span><b>未安装，不计入上方真实组件</b></div><button type="button" onclick="openLibrary('community')">查看全部社区候选 →</button></div><div class="community-mini-grid">${community.map((item) => `<a href="${item.repo}" target="_blank" rel="noopener" class="community-mini"><span>社区 · 未安装</span><h3>${esc(item.name)}</h3><p>${esc(item.desc)}</p></a>`).join('')}</div></div>` : ''}
      </section>`;
    }
    return bc([{ t: '能力配置', fn: 'goWorkshop()' }, { t: module.name }]) + `<main class="spatial-workbench">
      <div class="spatial-head"><div class="page-head"><h1 class="page-title">${module.name}模块 <span class="tag cy">${module.en}</span></h1><div class="page-sub">选择一项能力，再查看它实际由哪些插件、Skill、工具和提示词组成。</div></div><nav class="module-dock" aria-label="切换能力模块">${dock}</nav></div>
      <details class="term-guide"><summary>插件、Skill、工具、提示词分别是什么？</summary><div><span><b>插件</b>装进 DSH 的功能零件</span><span><b>Skill</b>AI 需要时读取的做事说明</span><span><b>工具</b>AI 可以实际调用的动作入口</span><span><b>提示词</b>告诉 AI 身份、规则和做事方式的文字</span></div></details>
      <section class="capability-orbit" aria-label="${module.name}模块的能力分布"><div class="module-core"><span class="mc-icon">${module.icon}</span><h2>${module.name}</h2><p>${module.desc}</p><small>${abilities.length} 类能力 · ${componentTotal} 个组件</small></div><div class="orbit-nodes">${abilityNodes}</div><div class="orbit-hint">选择周围一项能力，展开它的真实组件</div></section>
      ${unfold}
    </main>${state.componentDetail ? renderComponentDrawer() : ''}${state.libraryOpen ? renderLibraryDrawer() : ''}`;
  }

  function findComponentDetail() {
    if (!state.componentDetail) return null;
    const [moduleKey, capabilityId, indexText] = state.componentDetail.split(':');
    const ability = CAPABILITIES[moduleKey]?.find((item) => item.id === capabilityId);
    const component = ability?.components[Number(indexText)];
    return component ? { moduleKey, ability, component } : null;
  }

  function renderComponentDrawer() {
    const found = findComponentDetail();
    if (!found) return '';
    const { moduleKey, ability, component } = found;
    const meta = TYPE_META[component.type];
    const configRows = Object.entries(component.config || {});
    return `<div class="drawer-mask" onclick="closeComponent()"></div><aside class="drawer" role="dialog" aria-modal="true" tabindex="-1" aria-label="组件详情"><button class="d-close" onclick="closeComponent()" aria-label="关闭">✕</button>
      <h3><span class="type-ico ${component.type}">${meta.short}</span>${esc(component.name)}</h3>
      <div class="comp-drawer-path">${MODULES[moduleKey].name} → ${ability.name} → ${meta.label}</div>
      <div class="plain-explain"><b>它负责什么：</b>${esc(component.desc)}</div>
      <div class="detail-sec"><h4>真实状态</h4>
        <div class="detail-line"><b>当前状态</b><span class="tag ${component.status === 'using' ? 'ok' : ''}">${esc(componentStatusLabel(component))}</span></div>
        <div class="detail-line"><b>证据来源</b><span>${esc(component.evidence)}</span></div>
        <div class="detail-line"><b>所在层</b><span>${esc(component.scope || '未记录')}</span></div>
        <div class="detail-line"><b>技术名称</b><span class="mono">${esc(component.tech)}</span></div>
        ${component.entryId ? `<div class="detail-line"><b>唯一标识</b><span class="mono">${esc(component.entryId)}</span></div>` : ''}
        ${component.provider ? `<div class="detail-line"><b>提供插件</b><span class="mono">${esc(component.provider)}</span></div>` : ''}
        ${component.phase ? `<div class="detail-line"><b>Fiber 状态</b><span class="mono">${esc(component.phase)}</span></div>` : ''}
      </div>
      ${configRows.length ? `<div class="detail-sec"><h4>Preset 中的实际参数</h4>${configRows.map(([key, value]) => `<div class="detail-line"><b>${esc(key)}</b><span class="mono">${esc(value)}</span></div>`).join('')}</div>` : ''}
      <div class="note-bar">这里只展示回读结果，不会修改 DSH。要刷新数据，请重新运行同步脚本。</div>
    </aside>`;
  }

  function renderLibraryDrawer() {
    const query = state.libraryQuery.trim().toLowerCase();
    const counts = Object.fromEntries(Object.keys(TYPE_META).map((type) => [type, ALL_COMPONENTS.filter((item) => item.component.type === type).length]));
    const nativeRows = ALL_COMPONENTS.filter(({ component, ability, moduleKey }) => !query || `${component.name} ${component.tech} ${component.entryId || ''} ${ability.name} ${MODULES[moduleKey].name}`.toLowerCase().includes(query));
    const communityRows = COMMUNITY_COMPONENTS.filter((item) => !query || `${item.name} ${item.packageName} ${item.desc} ${MODULES[item.moduleKey].name}`.toLowerCase().includes(query));
    const isCommunity = state.libraryTab === 'community';
    return `<div class="drawer-mask" onclick="closeLibrary()"></div><aside class="drawer wide-drawer" role="dialog" aria-modal="true" tabindex="-1" aria-label="全部组件">
      <button class="d-close" onclick="closeLibrary()" aria-label="关闭">✕</button><h3>组件库</h3>
      <div class="library-tabs" aria-label="组件来源"><button type="button" aria-pressed="${!isCommunity}" class="${!isCommunity ? 'on' : ''}" onclick="setLibraryTab('native')">当前 DSH <span>${ALL_COMPONENTS.length}</span></button><button type="button" aria-pressed="${isCommunity}" class="${isCommunity ? 'on' : ''}" onclick="setLibraryTab('community')">社区预置 <span>${COMMUNITY_COMPONENTS.length}</span></button></div>
      ${!isCommunity ? `<div class="d-sub">来自本机 DSH 配置快照；状态可以回读。</div><div class="library-counts"><span>插件 ${counts.plugin}</span><span>Skill ${counts.skill}</span><span>工具 ${counts.tool}</span><span>提示词来源 ${counts.prompt}</span></div>` : '<div class="d-sub">来自开源社区的候选目录；均未安装，不能视为当前 Agent 能力。</div>'}
      <input class="library-search" value="${esc(state.libraryQuery)}" oninput="filterLibrary(this.value,event)" oncompositionend="filterLibrary(this.value,event)" placeholder="${isCommunity ? '搜索社区插件或用途' : '搜索中文作用、技术名或 entryId'}" aria-label="搜索组件">
      <div class="library-result-note">找到 ${isCommunity ? communityRows.length : nativeRows.length} 个${isCommunity ? '社区候选' : '本机组件'}。</div>
      ${isCommunity
        ? (communityRows.length ? `<div class="community-library">${communityRows.map((item) => `<article class="community-card"><div class="community-card-top"><span class="source-badge community">社区开源</span><span class="install-state">未安装</span></div><h4>${esc(item.name)}</h4><p>${esc(item.desc)}</p><div class="community-meta"><span>${esc(item.packageName)}</span><span>v${esc(item.version)}</span><span>${esc(item.license)}</span><span>近 7 天 ${formatNumber(item.downloads)} 次下载</span><span>DSH 可安装格式已核对</span></div><div class="community-risk"><b>接入前注意</b><span>${esc(item.risk)}</span></div><div class="community-actions"><a href="https://www.npmjs.com/package/${item.packageName}" target="_blank" rel="noopener">npm 包 ↗</a><a href="${item.repo}" target="_blank" rel="noopener">源码 ↗</a><button type="button" onclick="assessCommunity('${item.id}')">AI 评估</button></div></article>`).join('')}</div>` : '<div class="note-bar">没有找到匹配的社区候选。</div>')
        : (nativeRows.length ? nativeRows.map(({ moduleKey, ability, component, index }) => `<button type="button" class="library-row" onclick="openLibraryComponent('${moduleKey}','${ability.id}',${index})"><span class="lr-top"><span class="type-ico ${component.type}">${TYPE_META[component.type].short}</span><span class="lr-name">${esc(component.name)}</span><span class="source-badge native">当前回读</span><span class="tag ${component.status === 'using' ? 'ok' : ''}">${esc(componentStatusLabel(component))}</span></span><span class="cr-tech" style="margin:6px 0 0 42px">${esc(component.tech)}${component.entryId ? ` · ${esc(component.entryId)}` : ''}</span><span class="lr-path" style="margin-left:42px">${MODULES[moduleKey].name} → ${ability.name} · ${esc(component.evidence)} · 点击查看详情</span></button>`).join('') : '<div class="note-bar">没有找到匹配组件。</div>')}
      ${isCommunity ? '<div class="community-disclaimer">热度仅取 2026-08-20 至 08-26 的 npm 下载量；“预置”表示列入候选目录，不代表安全审查通过。安装前仍需检查源码、权限、版本兼容与组件标识冲突。</div>' : ''}
    </aside>`;
  }

  function renderLLM() {
    const model = SNAPSHOT.config.model;
    return bc([{ t: '能力配置', fn: 'goWorkshop()' }, { t: '心智', fn: "openModule('mind')" }, { t: '模型设置' }]) + `<div class="page-head"><h1 class="page-title">当前模型设置 <span class="tag ok">设置已读取</span></h1><div class="page-sub">当前网页配置只有一条默认模型设置。</div></div>
      <section class="metric-grid"><div class="card metric-card"><div class="m-label">模型</div><div class="m-value compact-value">${esc(model.model)}</div><div class="m-note">${esc(model.provider)}</div></div><div class="card metric-card"><div class="m-label">推理强度</div><div class="m-value">${esc(effectiveReasoningEffort())}</div><div class="m-note">当前设置值</div></div><div class="card metric-card"><div class="m-label">上下文窗口</div><div class="m-value">${formatNumber(model.contextWindow)}</div><div class="m-note">模型最多可参考的文字量（token）</div></div><div class="card metric-card"><div class="m-label">输入类型</div><div class="m-value compact-value">${(model.inputModalities || []).map(esc).join(' + ')}</div><div class="m-note">当前模型声明</div></div></section>
      <div class="card settings-facts"><h3>与运行直接相关的真实参数</h3><div class="settings-grid"><div><b>模型最大输出</b><span>${formatNumber(model.maxTokens)} tokens</span></div><div><b>并行工具调用</b><span>${formatNumber(SNAPSHOT.config.agentLoop.maxParallelToolCalls)} 个</span></div><div><b>Shell 默认超时</b><span>${formatDuration(SNAPSHOT.config.shell.timeoutMs)}</span></div><div><b>Shell 最大超时</b><span>${formatDuration(SNAPSHOT.config.shell.maxTimeoutMs)}</span></div><div><b>网页搜索模型</b><span>${esc(SNAPSHOT.config.webSearch.model || '未记录')}</span></div><div><b>每任务搜索上限</b><span>${formatNumber(SNAPSHOT.config.webSearch.maxUses)} 次</span></div></div></div>
      <div class="note-bar">DSH 设置接口返回的是脱敏视图；页面没有读取或保存 API Key 明文。</div>`;
  }

  function renderFlow() {
    const workflowRows = SNAPSHOT.config.presetRows.filter((row) => /workflow|ralph/.test(`${row.id} ${row.moduleName}`));
    return bc([{ t: '能力配置', fn: 'goWorkshop()' }, { t: '心智', fn: "openModule('mind')" }, { t: '工作流能力' }]) + `<div class="page-head"><h1 class="page-title">当前工作流能力 <span class="tag ok">配置已读取</span></h1><div class="page-sub">DSH 已具备运行多步骤任务的底层能力，但当前没有可读取的具体业务流程。</div></div>
      <section class="map-board simple-map"><div class="map-root-col"><div class="map-col-label">当前完整配置</div><div class="map-root"><div class="root-kicker">${esc(SNAPSHOT.config.activePreset.id)}</div><div class="root-name">${esc(SNAPSHOT.config.activePreset.name)}</div><div class="root-desc">${esc(SNAPSHOT.config.activePreset.description)}</div></div></div><div class="component-col span-two"><div class="map-col-label">工作流组件</div><div class="component-panel"><div class="component-head"><h3>${workflowRows.length} 个组成部分</h3><p>这些组件只是运行工作流的底座，不代表已经配置了具体业务流程。</p></div><div class="component-groups">${workflowRows.map((row) => `<div class="library-row"><div class="lr-top"><span class="type-ico tool">T</span><span class="lr-name">${esc(toolNames[row.id] || humanPluginName({ moduleName: row.moduleName, entryId: row.id }))}</span><span class="tag ${row.enabled ? 'ok' : ''}" style="margin-left:auto">${row.enabled ? '已组装' : '未启用'}</span></div><div class="cr-tech" style="margin:6px 0 0 42px">${esc(row.moduleName)} · ${esc(row.id)}</div>${Object.keys(row.config).length ? `<div class="lr-path" style="margin-left:42px">${Object.entries(row.config).map(([key, value]) => `${esc(key)}=${esc(value)}`).join(' · ')}</div>` : ''}</div>`).join('')}</div></div></div></section>
      <div class="note-bar"><b>当前结论：</b>工作流引擎和工具已装配；业务流程库、流程实例与验收记录没有可回读数据，因此不画假的流程图。</div>`;
  }

  function renderObserve() {
    const project = SNAPSHOT.sessions.project;
    const nonBlank = Math.max(1, project.total - project.blank);
    const totalRuntime = project.stats.llmMs + project.stats.toolMs;
    const maxDaily = Math.max(1, ...project.daily.map((day) => day.count));
    const distributionRows = (counts, labelFor) => Object.entries(counts || {}).map(([key, count]) => `<div class="distribution-row"><div><b>${esc(labelFor(key))}</b><span>${count} 个会话</span></div><span class="distribution-track"><i style="width:${project.total ? Math.max(4, count / project.total * 100) : 0}%"></i></span><strong>${project.total ? Math.round(count / project.total * 100) : 0}%</strong></div>`).join('');
    const presetNames = Object.fromEntries((SNAPSHOT.config.presets || []).map((preset) => [preset.id, preset.name || preset.id]));
    return `<div class="page-head"><h1 class="page-title">运行观测 <span class="tag ok">当前项目记录</span></h1><div class="page-sub">一个“会话”就是一次独立任务或对话。这里展示会话、轮次、步骤、耗时和模型用量；当前数据没有成功或失败结果，所以不展示虚假的完成率。</div><div class="observe-kicker"><span class="tag cy">${esc(project.path)}</span><span class="tag">快照日期 ${esc(String(SNAPSHOT.capturedAt).slice(0, 10))}</span><span class="tag">本机共 ${SNAPSHOT.sessions.all.total} 个会话</span></div></div>
      <section class="metric-grid" aria-label="运行概览"><div class="card metric-card"><div class="m-label">项目会话</div><div class="m-value">${project.total}</div><div class="m-note">${project.blank} 个尚未开始</div></div><div class="card metric-card"><div class="m-label">真实轮次 / 步骤</div><div class="m-value">${project.stats.turns} / ${project.stats.steps}</div><div class="m-note">来自运行统计</div></div><div class="card metric-card"><div class="m-label">平均记录耗时</div><div class="m-value compact-value">${formatDuration(totalRuntime / nonBlank)}</div><div class="m-note">模型 + 工具；不等于完整等待时间</div></div><div class="card metric-card"><div class="m-label">当前运行中</div><div class="m-value">${project.running}</div><div class="m-note">停止不代表成功或失败</div></div></section>
      <div class="observe-grid"><section class="card run-list"><div class="run-list-head"><h3>会话构成</h3><span class="faint" style="font-size:11px">只展示汇总，不落盘逐会话明细</span></div><div class="distribution-group"><h4>按角色卡</h4>${distributionRows(project.presetCounts, (key) => presetNames[key] || key)}</div><div class="distribution-group"><h4>按权限</h4>${distributionRows(project.permissionCounts, (key) => key)}</div></section>
      <aside class="card trend-card"><h3>近 7 天会话更新量</h3><div class="page-sub" style="margin-top:2px">按会话 updatedAt 统计，不等同于任务成功量</div><div class="trend-bars" aria-label="近七天会话趋势">${project.daily.map((day) => `<span class="trend-bar" style="height:${Math.max(6, day.count / maxDaily * 100)}%" title="${day.date}: ${day.count}"></span>`).join('')}</div><div class="trend-labels">${project.daily.map((day) => `<span>${day.date.slice(5).replace('-', '/')}</span>`).join('')}</div><div class="note-bar" style="margin-top:14px"><b>累计 token：</b>输入 ${formatNumber(project.stats.uncachedInputTokens)} · 输出 ${formatNumber(project.stats.outputTokens)} · 缓存命中 ${formatNumber(project.stats.cacheReadTokens)}</div></aside></div>`;
  }

  function renderTrial() {
    return `<div class="page-head"><h1 class="page-title">效果测试 <span class="tag warn">尚无真实测试结果</span></h1><div class="page-sub">当前只能读取配置和运行记录，还没有候选配置版本、固定测试题、评分结果或发布记录。</div></div>
      <div class="card honest-empty"><div class="empty-mark">◎</div><h2>还不能判断哪套配置更好</h2><p>达到可上线标准至少需要：固定测试题、候选配置版本、隔离运行记录、评价指标和最终采用记录。缺一项，只能标为“未验证”。</p><div class="empty-grid"><span><b>已有</b>插件、角色卡、Skill 和模型设置</span><span><b>已有</b>会话轮次、步骤、耗时与模型用量</span><span class="missing"><b>缺少</b>候选配置版本库</span><span class="missing"><b>缺少</b>测试题与评分结果</span></div></div>`;
  }

  function renderAssistantMessage(message, index) {
    const action = message.action ? `<button type="button" class="chat-inline-action" onclick="runAssistantMessageAction(${index})">${esc(message.action.label)}</button>` : '';
    const details = message.details?.length ? `<ul>${message.details.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>` : '';
    return `<div class="assistant-msg ${message.role}"><span class="am-avatar">${message.role === 'assistant' ? '<img src="assets/dsh-icon.svg" alt="">' : '你'}</span><div class="am-bubble"><p>${esc(message.text)}</p>${details}${action}</div></div>`;
  }

  function renderAssistantProposal() {
    const proposal = state.assistantProposal;
    if (!proposal) return '';
    const canWrite = configAdapterReady();
    let outcome = '';
    if (proposal.status === 'draft') outcome = '<div class="cp-applied draft"><b>已加入候选方案</b><span>没有写入真实 DSH；可继续讨论或等待后端接入。</span></div>';
    if (proposal.status === 'applying') outcome = '<div class="cp-progress"><b>正在检查并提交</b><span>请勿重复操作。</span></div>';
    if (proposal.status === 'verified') outcome = `<div class="cp-applied"><b>写入已完成并回读一致</b><span>${esc(proposal.readbackValue ?? proposal.newValue)}</span></div>`;
    if (proposal.status === 'submitted-unverified') outcome = '<div class="cp-unknown"><b>写入请求已返回，但回读未确认</b><span>真实状态未知；先核对设置，不要重复提交。</span></div>';
    const diffLabels = proposal.status === 'verified' ? ['修改前', '已回读']
      : proposal.status === 'draft' ? ['当前', '候选']
        : proposal.status === 'applying' ? ['修改前', '写入目标']
          : proposal.status === 'submitted-unverified' ? ['修改前', '期望值']
            : ['当前', '建议'];
    return `<section class="change-proposal" aria-label="候选配置修改"><div class="cp-head"><span>候选修改</span><span class="confidence ${proposal.level}">${esc(proposal.confidence)}</span></div><h3>${esc(proposal.title)}</h3>
      <div class="cp-target"><span>修改位置</span><b>${esc(proposal.target)}</b></div>
      <div class="cp-diff"><span><small>${diffLabels[0]}</small><b>${esc(proposal.oldValue)}</b></span><i>→</i><span class="new"><small>${diffLabels[1]}</small><b>${esc(proposal.readbackValue ?? proposal.newValue)}</b></span></div>
      <p>${esc(proposal.impact)}</p><details><summary>正式写入前必须通过</summary><ul>${proposal.checks.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></details>
      ${outcome || (state.assistantConfirming ? `<div class="cp-confirm"><p>${canWrite ? '只写入上面这一项，并在写入后回读。确认继续吗？' : '只把上面这一项加入页面候选方案；不会写入 DSH。确认继续吗？'}</p><button type="button" onclick="cancelAssistantConfirm()">取消</button><button type="button" class="primary" onclick="applyAssistantProposal()">${canWrite ? '确认写入并回读' : '加入候选方案'}</button></div>` : `<div class="cp-actions"><button type="button" onclick="dismissAssistantProposal()">暂不处理</button><button type="button" class="primary" onclick="prepareAssistantProposal()">${canWrite ? '预览并确认' : '保存为候选'}</button></div>`)}
    </section>`;
  }

  function configAdapterReady() {
    const adapter = window.DS_HUB_CONFIG_ADAPTER;
    return Boolean(adapter && typeof adapter.preflight === 'function' && typeof adapter.apply === 'function' && typeof adapter.readback === 'function');
  }

  function aiAdapterReady() {
    return Boolean(window.DS_HUB_AI_ADAPTER && typeof window.DS_HUB_AI_ADAPTER.ask === 'function');
  }

  function normalizeProposal(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const policy = PROPOSAL_POLICIES[raw.key];
    if (!policy) return null;
    const writeValue = String(raw.writeValue ?? raw.expectedValue ?? raw.newValue ?? '');
    if (!policy.allowedValues.includes(writeValue)) return null;
    const currentValues = {
      permissionDefault: state.appliedOverrides.permissionDefault ?? SNAPSHOT.config.permission.defaultPreset ?? '未记录',
      reasoningEffort: state.appliedOverrides.reasoningEffort ?? SNAPSHOT.config.model.reasoningEffort ?? '未记录',
    };
    if (String(currentValues[raw.key]) === writeValue) return { noOp: true, key: raw.key, target: policy.target, value: writeValue };
    const level = raw.level === 'high' ? 'high' : 'medium';
    const clean = (value, fallback, max = 160) => String(value || fallback).replace(/\s+/g, ' ').trim().slice(0, max);
    return {
      id: raw.id || `proposal-${Date.now()}-${++proposalCounter}`,
      key: raw.key,
      target: policy.target,
      title: clean(raw.title, '候选配置修改', 56),
      confidence: clean(raw.confidence, level === 'high' ? '高可信' : '中可信', 12),
      level,
      oldValue: String(currentValues[raw.key]),
      newValue: clean(raw.newValue, writeValue, 64),
      writeValue,
      expectedValue: writeValue,
      impact: clean(raw.impact, '需要在隔离任务中验证实际影响。', 220),
      checks: policy.checks,
    };
  }

  function isMobileSheet() {
    return typeof matchMedia === 'function' && matchMedia('(max-width: 520px)').matches;
  }

  function renderSavedPlans() {
    if (!state.assistantPlans.length) return '';
    const statusLabel = { candidate: '已替换', draft: '候选，未写入', verified: '已写入并回读', 'submitted-unverified': '状态未知' };
    return `<details class="saved-plans"><summary>方案与修改记录 <span>${state.assistantPlans.length}</span></summary>${state.assistantPlans.map((plan) => `<div><b>${esc(plan.title)}</b><span>修改前 ${esc(plan.oldValue)} · ${esc(statusLabel[plan.status] || '候选')} ${esc(plan.readbackValue ?? plan.newValue)}</span></div>`).join('')}</details>`;
  }

  function renderAssistant() {
    if (!state.assistantOpen) {
      if (state.view === 'workshop') return '';
      return `<button type="button" class="assistant-launcher" onclick="openAssistant()" aria-label="打开 AI 配置诊断"><span class="al-icon"><img src="assets/dsh-icon.svg" alt=""></span><span><b>AI 配置诊断</b><small>${aiAdapterReady() ? (state.assistantAIStatus === 'ok' ? 'AI 最近响应成功' : 'AI 接口已配置') : '本地规则演示'}</small></span><i>${RECOMMENDATIONS.length}</i></button>`;
    }
    const writeConnected = configAdapterReady();
    const aiConnected = aiAdapterReady();
    const mobileSheet = isMobileSheet();
    const aiStatusText = !aiConnected ? '当前是本地诊断规则演示，AI 模型尚未连接。' : state.assistantAIStatus === 'ok' ? 'AI 最近一次请求响应成功。' : state.assistantAIStatus === 'error' ? 'AI 接口已配置，但最近一次请求失败。' : 'AI 接口已配置，尚未验证本次连接。';
    const starter = { role: 'assistant', text: `${aiStatusText}我已读取当前项目的 ${SNAPSHOT.sessions.project.total} 个会话和本机配置快照。你可以问我为什么这样配、哪里可能有风险，或让我先生成一项候选修改。` };
    const messages = state.assistantMessages.length ? state.assistantMessages : [starter];
    return `${mobileSheet ? '<button type="button" class="assistant-scrim" onclick="closeAssistant()" aria-label="关闭 AI 配置诊断"></button>' : ''}<aside class="config-assistant" role="dialog" aria-modal="${mobileSheet}" tabindex="-1" aria-label="AI 配置诊断"><header class="assistant-head"><div class="assistant-title"><span><img src="assets/dsh-icon.svg" alt=""></span><div><b>AI 配置诊断</b><small><i></i>当前配置与运行快照已读取</small></div></div><button type="button" onclick="closeAssistant()" aria-label="关闭 AI 配置诊断">✕</button></header>
      <div class="assistant-boundary ${state.assistantAIStatus === 'ok' && writeConnected ? 'connected' : ''}">${aiConnected ? (state.assistantAIStatus === 'ok' ? 'AI 最近一次请求响应成功' : state.assistantAIStatus === 'error' ? 'AI 最近一次请求失败' : 'AI 接口已配置，尚未验证请求') : 'AI 模型未连接，当前回答来自本地诊断规则'} · ${writeConnected ? '写入接口已配置，只有回读值一致才算完成' : '真实写入未连接，只保存候选方案'}</div>
      <details class="methodology-mini"><summary>诊断方法：证据 → 最小改动 → 回读</summary><ol><li>先核对模型实际收到的输入与当前配置</li><li>沿“现象 → 机制 → 证据”定位，不靠猜测</li><li>检查提示词变量、规则冲突和示例复读；可确定判断尽量交给代码</li><li>一次只生成一项可回退的候选修改</li><li>用户确认后写入；真实回读一致，再做隔离验证</li></ol></details>
      ${renderSavedPlans()}
      <div id="assistant-messages" class="assistant-messages" aria-live="polite">${messages.map((message, index) => renderAssistantMessage(message, index)).join('')}${state.assistantThinking ? '<div class="assistant-thinking"><i></i><span>正在结合当前配置诊断…</span><button type="button" onclick="cancelAssistantRequest()">停止</button></div>' : ''}${renderAssistantProposal()}</div>
      ${!state.assistantMessages.length ? `<div class="assistant-quick"><button type="button" onclick="askAssistant('permission')">检查权限</button><button type="button" onclick="askAssistant('prompt')">检查提示词一致性</button><button type="button" onclick="askAssistant('community')">推荐社区插件</button></div>` : ''}
      <div class="assistant-composer"><textarea rows="2" oninput="updateAssistantDraft(this.value)" onkeydown="assistantKeydown(event)" placeholder="例如：为什么建议降低默认权限？" aria-label="输入配置诊断问题" ${state.assistantApplying || state.assistantThinking ? 'disabled' : ''}>${esc(state.assistantDraft)}</textarea><button type="button" onclick="sendAssistantMessage()" aria-label="发送" ${state.assistantApplying || state.assistantThinking ? 'disabled' : ''}>↑</button></div>
    </aside>`;
  }

  function diagnoseAssistantMessage(text) {
    const normalized = text.toLowerCase();
    const project = SNAPSHOT.sessions.project;
    const communityCandidate = COMMUNITY_COMPONENTS.find((item) => normalized.includes(item.packageName.toLowerCase()) || normalized.includes(item.name.toLowerCase()));
    if (communityCandidate) {
      return {
        text: `${communityCandidate.name}与“${MODULES[communityCandidate.moduleKey].name} → ${CAPABILITIES[communityCandidate.moduleKey].find((item) => item.id === communityCandidate.capabilityId)?.name}”匹配，近 7 天 npm 下载 ${formatNumber(communityCandidate.downloads)} 次。这个数字只能说明近期关注度，不能替代安全与兼容性审查。`,
        details: [`主要风险：${communityCandidate.risk}`, `核对许可证：${communityCandidate.license}`, '在独立测试环境检查依赖、权限和组件标识冲突', '基础测试通过后再决定是否加入当前 Agent'],
        action: { label: '查看对应能力', type: 'jump', moduleKey: communityCandidate.moduleKey, capabilityId: communityCandidate.capabilityId },
      };
    }
    if (/权限|danger|workspace-write|permission/.test(normalized)) {
      const used = project.permissionCounts?.['danger-full-access'] || 0;
      const currentDefault = state.appliedOverrides.permissionDefault ?? SNAPSHOT.config.permission.defaultPreset;
      if (currentDefault !== 'danger-full-access') {
        return {
          text: used
            ? `新会话默认权限已经是 ${currentDefault || '未记录'}，不应重复修改；但当前项目还有 ${used}/${project.total} 个既有会话使用 danger-full-access，可以逐个复核。`
            : `新会话默认权限是 ${currentDefault || '未记录'}，当前项目也没有记录到 danger-full-access 会话。现在没有证据支持继续收窄。`,
          details: ['先确认旧会话是否仍在运行', '只调整确实不再需要高权限的会话', '改后从会话详情回读实际权限'],
          action: { label: '查看权限配置', type: 'jump', moduleKey: 'action', capabilityId: 'permission' },
        };
      }
      return {
        text: `默认权限确实偏宽：当前新会话默认 danger-full-access，项目内 ${used}/${project.total} 个会话也使用它。这个结论来自配置和会话投影，不是效果猜测。`,
        details: ['普通研究与配置任务先用 workspace-write', '真正越界时再请求一次性确认', '应用后只影响新会话，已有会话需单独处理'],
        proposal: {
          key: 'permissionDefault', title: '收窄新会话默认权限', confidence: '高可信', level: 'high',
          oldValue: SNAPSHOT.config.permission.defaultPreset || '未记录', newValue: 'workspace-write', expectedValue: 'workspace-write',
          impact: '降低普通任务无提示访问工作区外文件或执行高风险命令的范围。',
          checks: ['确认修改目标是 Web Profile 的默认权限', '保留已有会话不变', '写入后重新读取 Settings', '新建隔离会话验证实际权限'],
        },
      };
    }
    if (/提示词|prompt|一致性|规则|人设/.test(normalized)) {
      return {
        text: '当前快照只能证明提示词由哪些组件注入，不能证明完整文本没有冲突。要做可靠诊断，应先拿到模型实际收到的 messages，而不是只读配置文件。',
        details: ['核对 {{变量}} 是否都有真实输入', '搜索相互冲突的“必须 / 不许”规则', '检查完整示例句是否被模型当成模板复读', '能用代码判定的规则移出提示词', '改后用同一真实入口回归，并核对模型实际收到的内容'],
        action: { label: '查看提示词来源', type: 'jump', moduleKey: 'mind', capabilityId: 'identity' },
      };
    }
    if (/\bskill\b|技能|飞书能力|选择噪音/.test(normalized)) {
      const larkSkills = SNAPSHOT.skills.filter((item) => item.name.startsWith('lark-')).length;
      return {
        text: `当前会话能发现 ${SNAPSHOT.skills.length} 个 Skill，其中 ${larkSkills} 个是飞书相关。数量本身不是问题；只有当项目很少使用飞书、模型又频繁选错能力时，才值得收窄。`,
        details: ['先看真实任务里是否调用过这些 Skill', '按项目目标保留常用能力，其他能力放到需要时再加载的项目配置', '改前后用相同任务比较选错率与提示词长度', '不要仅因数量多就删除本机能力'],
        action: { label: '查看扩展做事方法', type: 'jump', moduleKey: 'tools', capabilityId: 'extensions' },
      };
    }
    if (/社区|插件|mcp|扩展/.test(normalized)) {
      return {
        text: `我已预置 ${COMMUNITY_COMPONENTS.length} 个社区候选，并按近 7 天 npm 下载量排序。它们与当前 DSH 组件分栏显示，全部标为“未安装”。`,
        details: ['先查源码与许可证', '再检查权限、版本兼容和组件标识冲突', '最后在独立测试环境运行基础测试，不直接装进当前配置'],
        action: { label: '查看社区预置', type: 'library', tab: 'community' },
      };
    }
    if (/模型|慢|耗时|token|推理/.test(normalized)) {
      const total = project.stats.llmMs + project.stats.toolMs;
      const share = total ? Math.round(project.stats.llmMs / total * 100) : 0;
      const currentEffort = effectiveReasoningEffort();
      const shouldTestHigh = ['max', 'xhigh'].includes(currentEffort);
      return {
        text: `项目记录里模型耗时占模型 + 工具耗时的 ${share}%，当前默认推理强度是 ${currentEffort}。这支持先做一轮模型与上下文对照，但还不足以证明应该直接降档。`,
        details: ['用相同任务对照 max 与 high', '同时记录质量、耗时和 token', '只在效果不退化时采用'],
        proposal: shouldTestHigh ? {
          key: 'reasoningEffort', title: '为普通任务试用较轻推理档', confidence: '中可信', level: 'medium',
          oldValue: currentEffort, newValue: 'high（先隔离测试）', writeValue: 'high', expectedValue: 'high',
          impact: '候选方向是降低普通任务等待时间；是否采用必须由效果测试决定。',
          checks: ['固定同一测试集与模型版本', '记录端到端耗时和 token', '检查答案质量是否退化', '只让新任务切换'],
        } : undefined,
      };
    }
    const firstRecommendation = RECOMMENDATIONS[0];
    return {
      text: firstRecommendation
        ? `我会先把问题定位到模块和能力，再用当前配置与运行数据找证据。目前优先级最高的是“${firstRecommendation.title}”；这仍是配置建议，不是效果结论。`
        : '我会先把问题定位到模块和能力，再用当前配置与运行数据找证据。当前没有高优先级建议，可以从你观察到的具体问题开始诊断。',
      details: ['说一个现象：慢、答偏、工具太多或权限太宽', '我会给出证据、影响和一项最小修改', '你确认后才进入应用步骤'],
    };
  }

  function afterRender(callback) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(callback);
    else setTimeout(callback, 0);
  }

  function restoreDialogFocus(fallbackSelector) {
    const selector = dialogReturnSelector || fallbackSelector;
    dialogReturnSelector = null;
    afterRender(() => document.querySelector(selector)?.focus?.({ preventScroll: true }));
  }

  function activeModal() {
    return document.querySelector('.drawer[aria-modal="true"]') || document.querySelector('.config-assistant[aria-modal="true"]');
  }

  function syncModalState() {
    const modal = activeModal();
    const topbar = document.querySelector('.topbar');
    const view = document.getElementById('view');
    if (topbar) topbar.inert = Boolean(modal);
    if (view) {
      view.inert = Boolean(modal?.classList?.contains('config-assistant'));
      Array.from(view.children || []).forEach((child) => {
        child.inert = Boolean(modal?.classList?.contains('drawer')) && !child.classList?.contains('drawer') && !child.classList?.contains('drawer-mask');
      });
    }
    document.body?.classList?.toggle?.('modal-open', Boolean(modal));
  }

  function trapModalTab(event) {
    if (event.key !== 'Tab') return false;
    const modal = activeModal();
    if (!modal?.querySelectorAll) return false;
    const focusable = Array.from(modal.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),summary,[tabindex]:not([tabindex="-1"])'));
    if (!focusable.length) {
      event.preventDefault();
      modal.focus?.();
      return true;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus?.();
      return true;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus?.();
      return true;
    }
    if (!modal.contains?.(document.activeElement)) {
      event.preventDefault();
      first.focus?.();
      return true;
    }
    return false;
  }

  function goWorkshop() { state.view = 'workshop'; state.module = null; state.capability = null; state.componentDetail = null; state.libraryOpen = false; render(); }
  function goObserve() { state.view = 'observe'; state.componentDetail = null; state.libraryOpen = false; render(); }
  function goTrial() { state.view = 'trial'; state.componentDetail = null; state.libraryOpen = false; render(); }
  function openModule(key) { state.view = 'module'; state.module = key; state.capability = null; state.componentLimit = 12; state.componentDetail = null; state.libraryOpen = false; render(); }
  function selectCapability(id) {
    state.capability = id;
    state.componentLimit = 12;
    state.componentDetail = null;
    render();
    afterRender(() => {
      const target = document.getElementById('component-unfold');
      if (!target) return;
      const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      target.focus?.({ preventScroll: true });
    });
  }
  function showMoreComponents() { state.componentLimit += 12; render(); }
  function jumpToCapability(moduleKey, capabilityId) { state.view = 'module'; state.module = moduleKey; state.capability = capabilityId; state.componentLimit = 12; state.componentDetail = null; state.libraryOpen = false; render(); afterRender(() => { const target = document.getElementById('component-unfold'); target?.scrollIntoView?.({ block: 'start' }); target?.focus?.({ preventScroll: true }); }); }
  function openComponent(moduleKey, capabilityId, index) { dialogReturnSelector = `[data-component-ref="${moduleKey}-${capabilityId}-${index}"]`; state.componentReturnToLibrary = false; state.componentDetail = `${moduleKey}:${capabilityId}:${index}`; state.libraryOpen = false; render(); afterRender(() => document.querySelector('.drawer')?.focus?.()); }
  function closeComponent() {
    state.componentDetail = null;
    if (state.componentReturnToLibrary) {
      state.componentReturnToLibrary = false;
      state.libraryOpen = true;
      render();
      afterRender(() => { const drawer = document.querySelector('.wide-drawer'); if (drawer) drawer.scrollTop = state.libraryScrollTop; document.querySelector('.library-search')?.focus?.(); });
      return;
    }
    render();
    restoreDialogFocus('#component-unfold');
  }
  function openLibrary(tab = 'native') {
    dialogReturnSelector = '.rail-library';
    if (state.view !== 'module') { state.view = 'module'; state.module = 'tools'; state.capability = 'extensions'; }
    state.componentDetail = null; state.libraryOpen = true; state.libraryTab = tab; state.libraryQuery = ''; state.assistantOpen = false; render();
    afterRender(() => document.querySelector('.library-search')?.focus?.());
  }
  function closeLibrary() { state.libraryOpen = false; state.libraryQuery = ''; state.libraryScrollTop = 0; render(); restoreDialogFocus('.rail-library'); }
  function openLibraryComponent(moduleKey, capabilityId, index) { state.view = 'module'; state.module = moduleKey; state.capability = capabilityId; state.libraryScrollTop = document.querySelector('.wide-drawer')?.scrollTop || 0; state.componentReturnToLibrary = true; state.libraryOpen = false; state.componentDetail = `${moduleKey}:${capabilityId}:${index}`; render(); afterRender(() => document.querySelector('.drawer')?.focus?.()); }
  function setLibraryTab(tab) { state.libraryTab = tab === 'community' ? 'community' : 'native'; state.libraryQuery = ''; render(); }
  function filterLibrary(value, event) { state.libraryQuery = value; if (event?.isComposing) return; render(); const input = document.querySelector('.library-search'); if (input) { input.focus(); input.setSelectionRange(value.length, value.length); } }
  function openPresetDrawer() { dialogReturnSelector = '.attire button'; state.presetDrawer = true; render(); afterRender(() => document.querySelector('.drawer')?.focus?.()); }
  function closePresetDrawer() { state.presetDrawer = false; render(); restoreDialogFocus('.attire button'); }
  function openLLM() { state.view = 'llm'; render(); }
  function openFlow() { state.view = 'flow'; render(); }
  function toggleRecommendations() { state.recommendationsOpen = !state.recommendationsOpen; render(); }

  function startAgentRename() {
    state.agentNameEditing = true;
    render();
    afterRender(() => {
      const input = document.getElementById('agent-name-input');
      input?.focus();
      input?.select();
    });
  }
  function agentNameClick(event) { if (event.detail === 0) startAgentRename(); }
  function saveAgentName(value) {
    const nextName = String(value || '').trim().slice(0, 48) || 'Deepseek Agent';
    state.agentName = nextName;
    state.agentNameEditing = false;
    try { window.localStorage?.setItem('ds-hub-agent-name', nextName); } catch (_) { /* File previews may block storage. */ }
    render();
    toast('显示名已保存在本浏览器，未改写 DSH 配置');
  }
  function cancelAgentRename() { state.agentNameEditing = false; render(); }
  function agentNameInputKeydown(event) {
    if (event.isComposing) return;
    if (event.key === 'Enter') { event.preventDefault(); saveAgentName(event.currentTarget.value); }
    if (event.key === 'Escape') { event.preventDefault(); cancelAgentRename(); }
  }

  function toggleAvatar(event) {
    if (event?.type === 'dblclick' && Date.now() - lastAvatarTouchToggleAt < 700) return;
    state.avatarMode = state.avatarMode === 'girl' ? 'logo' : 'girl';
    render();
    afterRender(() => document.querySelector('.core-avatar')?.focus?.({ preventScroll: true }));
    toast(state.avatarMode === 'girl' ? '机娘形象已唤醒' : '已恢复 DSH 默认图标');
  }
  function avatarClick(event) {
    if (event.detail === 0) toggleAvatar(event);
  }
  function avatarPointerUp(event) {
    if (event.pointerType !== 'touch') return;
    const now = Date.now();
    if (now - lastAvatarTapAt < 420) { event.preventDefault(); lastAvatarTapAt = 0; lastAvatarTouchToggleAt = now; toggleAvatar(); }
    else lastAvatarTapAt = now;
  }
  function focusAssistantInput(opening = false) {
    afterRender(() => {
      if (opening && isMobileSheet()) document.querySelector('.config-assistant')?.focus?.({ preventScroll: true });
      else document.querySelector('.assistant-composer textarea')?.focus();
      const messages = document.getElementById('assistant-messages');
      if (messages) messages.scrollTop = messages.scrollHeight;
    });
  }
  function openAssistant() { dialogReturnSelector = state.view === 'workshop' ? '.core-chat-bubble' : '.assistant-launcher'; state.assistantOpen = true; state.libraryOpen = false; render(); focusAssistantInput(true); }
  function closeAssistant() { state.assistantOpen = false; render(); restoreDialogFocus(state.view === 'workshop' ? '.core-chat-bubble' : '.assistant-launcher'); }
  function updateAssistantDraft(value) { state.assistantDraft = value; }
  function assistantKeydown(event) { if (!event.isComposing && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendAssistantMessage(); } }

  function assistantContext(options = {}) {
    const project = SNAPSHOT.sessions.project;
    const conversation = options.excludeCurrentMessage ? state.assistantMessages.slice(0, -1) : state.assistantMessages;
    return {
      selected: { view: state.view, module: state.module, capability: state.capability },
      config: {
        preset: SNAPSHOT.config.activePreset.id,
        model: SNAPSHOT.config.model.model,
        reasoningEffort: state.appliedOverrides.reasoningEffort ?? SNAPSHOT.config.model.reasoningEffort,
        permissionDefault: state.appliedOverrides.permissionDefault ?? SNAPSHOT.config.permission.defaultPreset,
        pluginCount: SNAPSHOT.plugins.length,
        skillCount: SNAPSHOT.skills.length,
      },
      runtime: {
        sessions: project.total, turns: project.stats.turns, steps: project.stats.steps,
        llmMs: project.stats.llmMs, toolMs: project.stats.toolMs,
        permissionCounts: project.permissionCounts,
      },
      recommendations: RECOMMENDATIONS,
      methodology: ['核对实际输入', '定位机制与证据', '检查提示词一致性', '一次一项可回退修改', '确认后写入并回读'],
      evidence: {
        promptSources: ALL_COMPONENTS.filter((item) => item.component.type === 'prompt').slice(0, 24).map((item) => ({
          name: item.component.name,
          tech: item.component.tech,
          status: componentStatusLabel(item.component),
          evidence: item.component.evidence,
        })),
        selectedComponents: state.module && state.capability
          ? (CAPABILITIES[state.module]?.find((item) => item.id === state.capability)?.components || []).slice(0, 24).map((item) => ({ type: item.type, name: item.name, status: componentStatusLabel(item), tech: item.tech }))
          : [],
        communityCandidates: COMMUNITY_COMPONENTS.map((item) => ({ packageName: item.packageName, version: item.version, license: item.license, downloads: item.downloads, risk: item.risk })),
      },
      conversation: conversation.slice(-12).map((item) => ({
        role: item.role,
        text: String(item.text || '').slice(0, 1200),
        details: Array.isArray(item.details) ? item.details.slice(0, 6).map((detail) => String(detail).slice(0, 240)) : undefined,
      })),
      activeProposal: state.assistantProposal ? {
        key: state.assistantProposal.key,
        target: state.assistantProposal.target,
        newValue: state.assistantProposal.newValue,
        status: state.assistantProposal.status,
      } : null,
      savedPlans: state.assistantPlans.slice(-6).map((plan) => ({ key: plan.key, target: plan.target, newValue: plan.newValue, status: plan.status })),
    };
  }

  function normalizeAssistantAction(raw) {
    if (!raw || typeof raw !== 'object') return undefined;
    const label = String(raw.label || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!label) return undefined;
    if (raw.type === 'jump' && MODULES[raw.moduleKey] && CAPABILITIES[raw.moduleKey]?.some((item) => item.id === raw.capabilityId)) {
      return { type: 'jump', label, moduleKey: raw.moduleKey, capabilityId: raw.capabilityId };
    }
    if (raw.type === 'library' && ['native', 'community'].includes(raw.tab)) return { type: 'library', label, tab: raw.tab };
    return undefined;
  }

  function acceptAssistantResult(result) {
    const normalized = typeof result === 'string' ? { text: result } : (result || {});
    state.assistantMessages.push({
      role: 'assistant',
      text: normalized.text || '没有得到可用的诊断结果。',
      details: Array.isArray(normalized.details) ? normalized.details : undefined,
      action: normalizeAssistantAction(normalized.action),
    });
    if (normalized.proposal) {
      const safeProposal = normalizeProposal(normalized.proposal);
      if (!safeProposal) {
        state.assistantMessages.push({ role: 'assistant', text: '这项修改超出了当前允许的配置范围，已拦截；没有进入确认或写入步骤。' });
        return;
      }
      if (safeProposal.noOp) {
        state.assistantMessages.push({ role: 'assistant', text: `当前“${safeProposal.target}”已经是 ${safeProposal.value}，不生成重复修改。` });
        return;
      }
      if (state.assistantProposal && !state.assistantPlans.some((plan) => plan.id === state.assistantProposal.id)) {
        state.assistantPlans.push({ ...state.assistantProposal });
      }
      state.assistantProposal = { ...safeProposal, status: 'candidate' };
      state.assistantConfirming = false;
    }
  }

  async function sendAssistantMessage(value, options = {}) {
    if (state.assistantThinking || state.assistantApplying) { toast(state.assistantApplying ? '配置修改正在处理，请等待回读结果' : '正在诊断，请稍候'); return; }
    const text = String(value ?? state.assistantDraft).trim();
    if (!text) return;
    state.assistantMessages.push({ role: 'user', text });
    state.assistantDraft = '';
    state.assistantOpen = true;
    if (aiAdapterReady()) {
      state.assistantThinking = true;
      render();
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      let cancelRequest;
      const cancelled = new Promise((_, reject) => { cancelRequest = reject; });
      assistantRequestControl = { controller, reject: cancelRequest };
      const timeoutId = setTimeout(() => cancelAssistantRequest('诊断超过 30 秒，已停止等待'), 30_000);
      try {
        const result = await Promise.race([
          window.DS_HUB_AI_ADAPTER.ask({
            conversationId: state.assistantConversationId,
            message: text,
            context: assistantContext({ excludeCurrentMessage: true }),
            signal: controller?.signal,
          }),
          cancelled,
        ]);
        state.assistantAIStatus = 'ok';
        acceptAssistantResult(result);
      } catch (error) {
        state.assistantAIStatus = 'error';
        acceptAssistantResult({ text: `AI 对话暂时不可用：${error?.message || '连接失败'}。没有生成或修改配置。` });
      } finally {
        clearTimeout(timeoutId);
        assistantRequestControl = null;
        state.assistantThinking = false;
      }
    } else {
      acceptAssistantResult(diagnoseAssistantMessage(text));
    }
    render();
    if (options.focus !== false) focusAssistantInput();
  }
  function cancelAssistantRequest(reason = '已由用户停止') {
    if (!assistantRequestControl) return;
    const message = typeof reason === 'string' ? reason : '已由用户停止';
    assistantRequestControl.controller?.abort?.(message);
    assistantRequestControl.reject(new Error(message));
  }
  function askAssistant(topic) {
    const questions = {
      permission: '为什么建议收窄默认权限？',
      prompt: '帮我检查提示词一致性，应该先看什么？',
      community: '有哪些社区插件值得先评估？',
      model: '当前模型配置是否可能太重？',
      skills: '当前 Skill 是否太多？',
    };
    state.assistantOpen = true;
    sendAssistantMessage(questions[topic] || topic, { focus: false });
  }
  function runAssistantMessageAction(index) {
    const action = state.assistantMessages[Number(index)]?.action;
    if (!action || typeof action !== 'object') return;
    if (action.type === 'jump' && MODULES[action.moduleKey] && CAPABILITIES[action.moduleKey]?.some((item) => item.id === action.capabilityId)) {
      if (isMobileSheet()) state.assistantOpen = false;
      jumpToCapability(action.moduleKey, action.capabilityId);
      return;
    }
    if (action.type === 'library' && ['native', 'community'].includes(action.tab)) openLibrary(action.tab);
  }
  function prepareAssistantProposal() { if (state.assistantApplying) return; state.assistantConfirming = true; render(); }
  function cancelAssistantConfirm() { state.assistantConfirming = false; render(); }
  function dismissAssistantProposal() { if (state.assistantApplying) return; state.assistantProposal = null; state.assistantConfirming = false; render(); }
  async function applyAssistantProposal() {
    const proposal = state.assistantProposal;
    if (!proposal || state.assistantApplying) return;
    const safeProposal = normalizeProposal(proposal);
    if (!safeProposal || safeProposal.noOp) {
      state.assistantMessages.push({ role: 'assistant', text: '候选修改未通过允许范围校验，已停止；没有发起写入。' });
      state.assistantProposal = null;
      render();
      return;
    }
    Object.assign(proposal, safeProposal);
    const adapter = window.DS_HUB_CONFIG_ADAPTER;
    if (!configAdapterReady()) {
      proposal.status = 'draft';
      if (!state.assistantPlans.some((plan) => plan.key === proposal.key && plan.newValue === proposal.newValue)) state.assistantPlans.push({ ...proposal });
      state.assistantMessages.push({ role: 'assistant', text: '已加入页面候选方案。真实写入未连接，所以 DSH 配置没有变化。' });
      state.assistantProposal = null;
      state.assistantConfirming = false;
      render();
      focusAssistantInput();
      return;
    }
    state.assistantApplying = true;
    state.assistantConfirming = false;
    proposal.status = 'applying';
    render();
    let writeStarted = false;
    try {
      const writeRequest = {
        idempotencyKey: proposal.id,
        key: proposal.key,
        target: proposal.target,
        title: proposal.title,
        expectedOldValue: proposal.oldValue,
        value: proposal.writeValue,
        newValue: proposal.writeValue,
        expectedValue: proposal.expectedValue,
        checks: [...proposal.checks],
      };
      const preflight = await adapter.preflight(writeRequest);
      if (preflight === false || preflight?.ok === false) throw new Error(preflight?.message || '应用前检查未通过');
      writeStarted = true;
      await adapter.apply(writeRequest);
      const readback = await adapter.readback(proposal.key);
      const readbackIsObject = Boolean(readback && typeof readback === 'object');
      const hasReadbackValue = readbackIsObject ? Object.prototype.hasOwnProperty.call(readback, 'value') : readback !== undefined;
      const readbackValue = readbackIsObject ? readback.value : readback;
      const expectedValue = proposal.expectedValue ?? proposal.newValue;
      const verified = hasReadbackValue && String(readbackValue) === String(expectedValue);
      if (verified) {
        proposal.status = 'verified';
        proposal.readbackValue = readbackValue;
        state.appliedOverrides[proposal.key] = readbackValue;
        rebuildCapabilityIndex();
        RECOMMENDATIONS = buildRecommendations();
        if (!state.assistantPlans.some((plan) => plan.id === proposal.id)) state.assistantPlans.push({ ...proposal });
        state.assistantProposal = null;
        state.assistantMessages.push({ role: 'assistant', text: `写入完成，并已回读一致：${proposal.title}。下一步应在隔离任务里验证效果。` });
      } else {
        proposal.status = 'submitted-unverified';
        state.assistantMessages.push({ role: 'assistant', text: '写入请求已返回，但回读值与候选值不一致。真实状态未知，请先核对设置，不要重复提交。' });
      }
    } catch (error) {
      proposal.status = writeStarted ? 'submitted-unverified' : 'candidate';
      state.assistantMessages.push({ role: 'assistant', text: writeStarted
        ? `写入已发起，但没有拿到可信回读：${error?.message || '未知错误'}。真实状态未知，请先核对设置，不要重复提交。`
        : `应用前检查或写入未完成：${error?.message || '未知错误'}。没有证据表明配置已改变。` });
    } finally {
      state.assistantApplying = false;
      render();
      focusAssistantInput();
    }
  }
  function assessCommunity(id) {
    const item = COMMUNITY_COMPONENTS.find((candidate) => candidate.id === id);
    if (!item) return;
    state.libraryOpen = false;
    state.assistantOpen = true;
    sendAssistantMessage(`评估社区插件 ${item.packageName} 是否适合当前配置`, { focus: false });
  }

  function globalKeydown(event) {
    if (trapModalTab(event)) return;
    if (event.key !== 'Escape') return;
    if (state.libraryOpen) { closeLibrary(); return; }
    if (state.componentDetail) { closeComponent(); return; }
    if (state.presetDrawer) { closePresetDrawer(); return; }
    if (state.assistantOpen) closeAssistant();
  }

  function render() {
    let body = '';
    if (state.view === 'workshop') body = renderWorkshop();
    else if (state.view === 'module') body = renderModule();
    else if (state.view === 'llm') body = renderLLM();
    else if (state.view === 'flow') body = renderFlow();
    else if (state.view === 'observe') body = renderObserve();
    else body = renderTrial();
    app.innerHTML = renderTopbar() + `<div id="view">${body}</div>` + renderAssistant();
    syncModalState();
    lastAssistantMobileSheet = state.assistantOpen ? isMobileSheet() : null;
  }

  Object.assign(window, {
    render, goWorkshop, goObserve, goTrial, openModule, selectCapability, showMoreComponents,
    jumpToCapability, openComponent, closeComponent, openLibrary, closeLibrary, openLibraryComponent, setLibraryTab,
    filterLibrary, openPresetDrawer, closePresetDrawer, openLLM, openFlow, toggleRecommendations,
    startAgentRename, agentNameClick, saveAgentName, cancelAgentRename, agentNameInputKeydown,
    toggleAvatar, avatarClick, avatarPointerUp, openAssistant, closeAssistant,
    updateAssistantDraft, assistantKeydown, sendAssistantMessage, askAssistant,
    runAssistantMessageAction, cancelAssistantRequest,
    prepareAssistantProposal, cancelAssistantConfirm, dismissAssistantProposal,
    applyAssistantProposal, assessCommunity, toast,
  });

  document.addEventListener?.('keydown', globalKeydown);
  window.addEventListener?.('resize', () => {
    if (!state.assistantOpen) return;
    const mobileSheet = isMobileSheet();
    if (mobileSheet !== lastAssistantMobileSheet) render();
  });

  const route = (location.hash || '').replace(/^#\/?/, '');
  const [routeModule, routeCapability] = route.split('/');
  if (MODULES[routeModule] && CAPABILITIES[routeModule]?.some((item) => item.id === routeCapability)) {
    state.view = 'module'; state.module = routeModule; state.capability = routeCapability; render();
  }
  else if (['sense', 'memory', 'mind', 'tools', 'action'].includes(route)) openModule(route);
  else if (route === 'observe') goObserve();
  else if (route === 'trial' || route === 'try' || route === 'tune') goTrial();
  else if (route === 'llm') openLLM();
  else if (route === 'flow' || route === 'flow-pro') openFlow();
  else if (route === 'library') { state.view = 'module'; state.module = 'tools'; state.capability = 'extensions'; state.libraryOpen = true; render(); }
  else render();
})();
