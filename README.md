# DS Hub

DS Hub 是一个面向普通用户的 DSH Agent 配置与运行观测原型。它把底层插件、Skill、工具、提示词和权限，整理成五个容易理解的模块：感知、记忆、心智、工具、行动。

当前仓库是无构建步骤的静态原型，直接打开 `index.html` 即可体验。推荐通过本地静态服务器运行：

```bash
python3 -m http.server 8080
```

然后访问 `http://127.0.0.1:8080`。

## 产品设计原则

1. 小白先看懂，再逐层展开技术细节。首页只回答“它现在会什么、哪里值得检查”；组件唯一标识等技术信息放进详情抽屉。
2. 详细不等于复杂。每个术语都要有一句人话解释，重复信息和无行动价值的说明不占主界面。
3. 信息按认知负载分层。模块居中、能力环绕；选中一项能力后，才展开对应组件卡片。
4. 配置和运行分开。能力配置回答“它被怎样设置”；运行观测回答“线上实际发生了什么”。
5. 智能建议必须有证据。建议展示数据依据与可信度；缺少成功率或质量数据时，不伪造效果结论。
6. 安全修改遵循：诊断 → 单项候选 → 固定测试集 → 隔离回归 → 用户确认采用 → 写入与真实回读 → 新任务观察。候选和测试不会改变当前配置；写入请求返回但回读失败时，状态必须标为未知，不能自动重试。
7. 提示词一致性优先。先核对模型实际收到的输入，再检查变量缺失、规则冲突和示例复读；能够由代码确定的判断不堆进提示词。

## 当前体验

- “Agent 配置”默认进入完整能力总览；左上角“快速配置”是高频修改入口，不会替代模块 → 能力 → 组件的完整配置页。
- 快速配置一次只展开一个编辑区：切换 DSH 已可路由的 Provider/模型组合与思考深度、调整角色卡的上下文压缩和工具结果裁剪、编辑具体 Persona、以及把现有工具加入/移出当前 Agent 或修改已知参数。Provider 凭据、API Key 和自定义路由仍由原 DSH Web 管理。
- 完整能力页默认展示 DSH 图标；双击或键盘操作可切换机娘形象。
- Agent 显示名可双击修改，只保存在当前浏览器，不会冒充 DSH 配置改名。
- 五个模块采用“模块 → 能力 → 组件”的渐进展开方式。
- 组件库把 166 条 Loader 挂载记录归并为 138 个插件包；中文作用名是主标题，英文包名和原始挂载记录保留在详情中。
- “当前 DSH 回读”和“社区预置候选”分开。
- 运行观测只展示匿名会话统计，不读取标题和消息正文。
- 底部横向“DS Hub 助手”可以诊断、搜索插件、生成候选配置、构建测试集、发起回归并观察采用后的新任务，用一张六步任务卡承接整套过程。
- 模块、能力、插件、Skill、工具和提示词来源可以拖入助手，键盘和移动端也可用“交给助手分析”按钮加入。它们只会成为下一条消息的显式分析对象；不会因拖入而发送消息、安装插件或修改配置。
- “效果测试”是候选配置、固定测试集、隔离对比和采用决策的工作台。没有真实执行器时不会生成虚假的通过率。
- 助手支持本地规则演示，并预留真实 AI、社区搜索、隔离回归与配置采用适配器；未连接时会明确提示。

## 社区预置

社区项目只预置元数据和链接，全部标为“未安装”。列表不下载、不执行、也不自动启用第三方代码。

当前候选依据 2026-08-20 至 2026-08-26 的 npm 周下载量排序，并核对对应版本声明了 DSH 可安装包格式。热度不是安全或兼容性结论。

| 候选 | 版本 | 许可证 | 用途 |
|---|---:|---|---|
| [dshmarket](https://www.npmjs.com/package/dshmarket) | 1.34.0 | MIT | 社区插件市场 |
| [dsh-better-sidebar](https://www.npmjs.com/package/dsh-better-sidebar) | 0.16.1 | MIT | 文件、终端、Git 与浏览器侧边工作台 |
| [@linxin666/dsh-client-ui-task-board](https://www.npmjs.com/package/@linxin666/dsh-client-ui-task-board) | 0.3.6 | Apache-2.0 | 任务看板与定时执行 |
| [@linxin666/dsh-doctor](https://www.npmjs.com/package/@linxin666/dsh-doctor) | 0.3.6 | BSD-3-Clause | 配置诊断与恢复 |
| [@liustack/modlens](https://www.npmjs.com/package/@liustack/modlens) | 3.25.2 | MIT | 图片理解与 OCR |
| [dsh-context](https://www.npmjs.com/package/dsh-context) | 0.35.0 | Apache-2.0 | 上下文组成与压缩观察 |
| [@nanmicoder/dsh-agent-teams](https://www.npmjs.com/package/@nanmicoder/dsh-agent-teams) | 0.1.14 | MIT | 多 Agent 团队协作 |
| [dsh-vision-router](https://www.npmjs.com/package/dsh-vision-router) | 2.0.1 | MIT | 视觉路由与像素工具 |

安装前仍需检查源码、许可证、权限、外部数据传输、版本兼容和组件标识冲突，并在独立配置中完成基础测试。

## DS Hub 助手与闭环适配器

静态原型默认不调用模型、不下载插件，也不修改 DSH。真实接入由同源本机 sidecar 提供三个适配器：对话、隔离回归和配置读写。

候选至少绑定两份不能混用的基线：`baseTarget` 是本次要改的精确目标及其 namespace revision；`baseModelEnvironment` 是 `agent-default-model` 自己的 revision 与 provider/model/reasoning。涉及角色卡时还必须绑定第三份 `basePresetRoster`，同时锁住角色卡清单与默认指向。即使几个 revision 数字碰巧相同，也必须分别保存和核验。revision 只接受有限数值，或去掉首尾空白后 1–128 字符的字符串；空串不能充当 CAS 版本。配置原值保留 DSH 原生类型，`5` 不能变成 `"5"`，“排队等待”“未安装”等展示文案也不能进入 CAS。

页面的简单标量白名单映射如下：`permissionDefault → settings:permission#/defaultPreset`、`reasoningEffort → settings:agent-default-model#/reasoningEffort`、`busyEnter → settings:ui-conversation#/busyEnter`、`defaultPresetId → settings:agent-presets#/default`、`webSearchMaxUses → settings:web-search-deepseek#/maxUses`。快速配置的模型组合使用 `modelSelection → settings:agent-default-model#/selection`；上下文、Persona 和工具组成使用 sidecar 的受控虚拟目标 `agent-preset-ref:<opaquePresetRef>#/context-policy`、`#/persona`、`#/tools/<rowId>`，由 sidecar 在同一份 `presetRosterRevision` 下解析成真实 Preset composition，再执行读取、CAS 写入和回读。

每次同步都会为所有观测到的 Preset 生成新的 CSPRNG 128-bit `preset-ref-*` 与新的 `presetMappingId`；公开快照不再包含 raw Preset ID，raw ID 与公开 ref 也不能直接跨快照对应。但稳定名称、默认标志和组成特征仍可能形成间接指纹，因此快照仍是需要审查的真实运行配置，不应视为匿名化数据。`ref → rawId` 只写入仓库外、权限为 `0600` 的 sidecar 私有映射。sidecar 只有在 `presetMappingId + snapshotIdentity + presetRosterRevision` 三者完全匹配，且 ref 仍属于当前公开角色卡清单时才解析引用；旧映射和历史、非当前角色卡引用均不能进入配置读写路径。系统 Preset 必须先复制为用户 Preset，不能原地覆盖；工具“移除”只改变当前 Agent 的组成，不等于卸载。插件安装目标仍为 `plugins:web:<packageName>`，使用 sidecar 自己维护的安装清单 revision 或 digest，不能冒充 DSH settings revision。

```js
// dshBridge 代表同源 sidecar。以下 value/revision/evidence 均须来自真实读取或事件，
// 不能把页面传入的期望值重新包装后回显。
const modelEnvironment = ({ signal } = {}) => dshBridge.readModelEnvironment({
  namespace: 'agent-default-model',
  signal,
}); // -> { targetId, revision, selection:{ provider, model, reasoningEffort }, routable, evidenceRef }

// DSH 原生 event 没有 evidenceRef；sidecar 用不可变的运行坐标生成引用。
const eventEvidence = (run, event, { caseId, parentRef } = {}) => ({
  ref: `dsh:${run.runId}:${run.sessionId}:${event.type}:${event.seq}`,
  runId: run.runId,
  sessionId: run.sessionId,
  turn: run.turn,
  requestId: run.requestId,
  type: event.type,
  seq: event.seq,
  ...(caseId ? { caseId } : {}),
  ...(parentRef ? { parentRef } : {}),
});

// session.models.current 不是事件；sidecar 必须为这次真实读取生成独立凭据。
const sessionSelectionEvidence = (run) => ({
  ref: `dsh:${run.runId}:${run.sessionId}:session-selection:${run.sessionModelsRead.seq}`,
  runId: run.runId,
  sessionId: run.sessionId,
  turn: run.turn,
  requestId: run.requestId,
  type: 'session/selection',
  seq: run.sessionModelsRead.seq,
});

window.DS_HUB_AI_ADAPTER = {
  describeEnvironment: modelEnvironment,
  async ask({ requestId, conversationId, messageDigest, message, context, environment, signal }) {
    const run = await dshBridge.promptAndCollect({ requestId, conversationId, messageDigest, message, context, environment, signal });
    const header = run.requestHeaderEvent.data.header.config;
    const source = run.assistantMessageEvent.data.message.source;
    const ended = run.turnEndEvent.data.reason.kind;
    const selectedEvidence = sessionSelectionEvidence(run);
    const requestEvidence = eventEvidence(run, run.requestHeaderEvent, { parentRef: selectedEvidence.ref });
    const responseEvidence = eventEvidence(run, run.assistantMessageEvent, { parentRef: requestEvidence.ref });
    const endEvidence = eventEvidence(run, run.turnEndEvent, { parentRef: responseEvidence.ref });
    return {
      text: run.text,
      details: run.details,
      environment: {
        settingsRevision: run.modelEnvironment.revision,
        modelEnvironment: run.modelEnvironment,
        runId: run.runId,
        sessionId: run.sessionId,
        turn: run.turn,
        requestId,
        conversationId,
        messageDigest,
        selected: { ...run.sessionModels.current, evidence: selectedEvidence },
        requestHeader: { provider: header.provider, model: header.model, reasoningEffort: header.reasoningEffort, evidence: requestEvidence },
        responseProvenance: { provider: source.provider, model: source.model, kind: source.kind, evidence: responseEvidence },
        turnEnd: { reason: ended, evidence: endEvidence },
      },
    };
  },
};

window.DS_HUB_CONFIG_ADAPTER = {
  // 用户 Preset 的 Persona 正文默认不进入公开快照；编辑前只在本页内存中临时读取。
  async hydratePreset(request) {
    const current = await dshBridge.readPresetFieldByOpaqueRef(request);
    return {
      ok: true,
      presetRef: current.presetRef,
      presetRosterRevision: current.presetRosterRevision,
      presetMappingId: current.presetMappingId,
      snapshotIdentity: current.snapshotIdentity,
      targetId: current.targetId,
      targetRevision: current.revision,
      canonicalValue: current.value,
      evidenceRef: current.evidenceRef,
    };
  },
  // capture 在回归前读取；adopt 在写入前再次读取。两者都是只读。
  async preflight(request) {
    const current = await dshBridge.readConfigTarget(request);
    return {
      ok: true,
      targetId: current.targetId,
      targetRevision: current.revision,
      canonicalValue: current.value,
      evidenceRef: current.evidenceRef,
      ...(current.presetRoster ? { presetRoster: current.presetRoster } : {}),
      ...(current.presetDerivation ? { presetDerivation: current.presetDerivation } : {}),
    };
  },
  async apply(request) {
    const written = await dshBridge.applyTargetWithCAS({
      ...request,
      expectedTargetRevision: request.expectedRevision,
      expectedCanonicalValue: request.expectedOldValue,
      canonicalWriteValue: request.value,
      // sidecar 必须在同一协调锁内再次守住 target、model 与可选 presetRoster。
      guardedTarget: request.adoptionPreflight.target,
      guardedModelEnvironment: request.adoptionPreflight.modelEnvironment,
      guardedPresetRoster: request.adoptionPreflight.presetRoster,
    });
    return {
      ok: true,
      targetId: written.targetId,
      targetRevision: written.revision,
      evidenceRef: written.evidenceRef,
      guardReceipt: written.guardReceipt,
      guards: written.guards,
      ...(written.presetDerivation ? { presetDerivation: written.presetDerivation } : {}),
    };
  },
  async readback(request) {
    const current = await dshBridge.readConfigTarget(request);
    return {
      verified: true,
      targetId: current.targetId,
      targetRevision: current.revision,
      canonicalValue: current.value,
      evidenceRef: current.evidenceRef,
      ...(current.presetRoster ? { presetRoster: current.presetRoster } : {}),
      ...(current.presetDerivation ? { presetDerivation: current.presetDerivation } : {}),
      ...(current.manifest ? { manifest: current.manifest } : {}),
      ...(current.inventory ? { inventory: current.inventory } : {}),
    };
  },
};

const comparisonRun = (run, request) => {
  const selectedEvidence = sessionSelectionEvidence(run);
  const targetReadbackEvidence = eventEvidence(run, run.targetReadback.event, { parentRef: selectedEvidence.ref });
  const requestEvidence = eventEvidence(run, run.requestHeaderEvent, { parentRef: targetReadbackEvidence.ref });
  const responseEvidence = eventEvidence(run, run.assistantMessageEvent, { parentRef: requestEvidence.ref });
  const endEvidence = eventEvidence(run, run.turnEndEvent, { parentRef: responseEvidence.ref });
  return {
    runId: run.runId,
    sessionId: run.sessionId,
    turn: run.turn,
    requestId: run.requestId,
    environment: {
      sandboxPolicy: run.sandboxPolicy,
      isolated: true,
      sessionSelection: { ...run.sessionModels.current, evidence: selectedEvidence },
      requestHeader: { ...run.requestHeaderEvent.data.header.config, evidence: requestEvidence },
      responseProvenance: { ...run.assistantMessageEvent.data.message.source, evidence: responseEvidence },
      turnEnd: { reason: run.turnEndEvent.data.reason, evidence: endEvidence },
    },
    targetReadback: {
      targetId: run.targetReadback.targetId,
      sourceTargetRevision: request.baseTarget.revision,
      canonicalValue: run.targetReadback.value,
      evidence: targetReadbackEvidence,
    },
  };
};

window.DS_HUB_OPTIMIZATION_ADAPTER = {
  describeEnvironment: modelEnvironment,
  searchCommunity: (request) => dshBridge.searchVerifiedCommunityPackages(request),
  async runComparison(request) {
    const result = await dshBridge.runIsolatedComparison(request);
    return {
      id: result.id,
      status: result.status,
      verified: result.verified,
      candidateId: request.candidateId,
      testSuiteId: request.testSuiteId,
      testSuiteVersion: request.testSuiteVersion,
      testSuiteHash: request.testSuiteHash,
      baseTarget: request.baseTarget,
      modelEnvironment: request.modelEnvironment,
      runs: {
        baseline: comparisonRun(result.baseline, request),
        candidate: comparisonRun(result.candidate, request),
      },
      caseResults: result.caseResults.map((item) => ({
        caseId: item.caseId,
        verdict: item.verdict,
        baseline: { status: item.baseline.status, evidence: eventEvidence(result.baseline, item.baseline.event, { caseId: item.caseId }) },
        candidate: { status: item.candidate.status, evidence: eventEvidence(result.candidate, item.candidate.event, { caseId: item.caseId }) },
      })),
    };
  },
  async observeAdoption(request) {
    // 只统计 adoptedAt 之后启动、且运行时回读到 appliedRevision 的新任务。
    // receipt 由 sidecar 对本次请求与逐任务证据清单签发，不能由页面拼装。
    const observed = await dshBridge.observeTasksUsingRevision(request);
    return {
      status: 'observed',
      requestId: request.requestId,
      taskId: request.taskId,
      candidateId: request.candidateId,
      targetId: request.targetId,
      appliedRevision: request.appliedRevision,
      outcome: observed.outcome, // healthy | degraded | insufficient
      taskCount: observed.taskCount,
      window: observed.window,  // { startedAt, endedAt }
      tasks: observed.tasks.map((task) => ({
        taskId: task.taskId,
        sessionId: task.sessionId,
        startedAt: task.startedAt,
        targetId: task.targetId,
        appliedRevision: task.appliedRevision,
        outcome: task.outcome, // passed | failed | unknown
        evidenceRef: task.evidenceRef,
      })),
      observationReceipt: observed.receipt, // id/digest/evidenceRef/issuedAt + request/task/candidate/target/revision + taskEvidenceRefs
    };
  },
};
```

当目标是 DSH 自带的系统 Preset 时，`request.presetDerivation.required` 为 `true`。sidecar 必须在同一受控操作中复制系统 Preset、只修改副本并把副本设为新建 Agent 的默认角色卡；`apply()` 与 `readback()` 都要返回 `presetDerivation`，至少包含 source/derived opaque Preset ref、同一个 `presetMappingId`、source/derived roster revision、source/derived targetId、系统源未改变的 revision/evidenceRef，以及默认角色卡已指向副本的 revision/evidenceRef。复制 receipt 还必须绑定 guard receipt digest、两份 ref、两份 roster revision、derived target 与 applied revision，不能只回显“复制成功”。两阶段证据必须独立，副本 targetId 必须保留原目标的精确 suffix。若写入成功而最终回读失败，状态未知标记必须改绑到派生 target，同时保留全局 `presetRoster` 标记；重新核验也必须同时证明派生副本、系统源未改变、默认角色卡指向和 roster readback，不能读取未变化的系统源后误解锁。缺少任一项时页面把写入视为状态未知，不会把系统 Preset 覆盖或副本启用冒充成成功。

工具候选保持 DSH Preset row 粒度：每个 `tool-*` row 有独立 target、enabled 和 config，不能按 npm package 用一个开关覆盖多个入口；参数 patch 还必须保留原字段集合和原生类型。

测试集的每道题都必须写明输入与通过条件，并绑定配置领域和候选 ID；AI 只能生成草稿，只有用户能锁定。回归结果还必须证明：baseline 真实回读旧值、candidate 真实回读候选值；两边来自不同隔离 run/session；每个 session selection、target readback、request header、assistant message 来源、turn end 和逐题结果都有归属于对应 run/session/turn/case 的结构化证据，且引用彼此独立。模型调用还必须绑定本次 requestId，并满足 `request header < assistant message < turn end`；`selection → target readback → request header → assistant message → turn end` 通过 parentRef 形成因果链，不能拿同一轮里的其他模型调用拼接。修改 `reasoningEffort` 时只允许 candidate 侧 request header 出现该预期变化，实际响应仍须来自同一 provider/model。缺一项都不会开放“采用”。

DSH 原生事件的模型配置在 `request/header.data.header.config`，响应来源在 `assistant/message.data.message.source`，完成状态在 `turn/end.data.reason.kind`；不能把整个 `reason` 当成字符串，也不能假设每一步都会新增 request header。DSH event 本身不提供 evidenceRef，sidecar 必须根据真实 sessionId/type/seq 生成不可变引用；会话选择来自 `session.models.current` 的真实读取凭据。每次 AI 请求会携带唯一 requestId、稳定 conversationId、消息摘要、当前消息、最多 12 条裁剪历史、当前优化任务和显式 `context.focusItems`；摘要同时绑定对象的稳定引用与快照 identity。拖入对象只提交经过当前能力索引重新解析的最小元数据，提示词正文不会作为附件指令发送。30 秒超时会解除界面并请求取消。API Key 始终由 DSH credentials 在宿主侧解析，不进入页面。

社区实时结果最多展示三个，必须同时提供英文包名、中文作用名、一句话说明、SemVer、许可证、兼容性、风险、权限/数据外发数组、核验时间、仓库、版本证据和兼容性证据。静态预置只用于发现，不能直接进入安装。安装候选必须锁定精确版本；采用时 sidecar 还要完成必要的 reload/restart，重新解析实际 manifest，并通过 `pluginInventory/list` 确认包已启用且处于 active。最终回读要分别返回 manifest 证据和 inventory 证据：manifest 必须给出精确 package/version、内容 digest 及其声明的 `{moduleName, entryId}`；inventory 必须返回解析后的 package/version、相同 manifest digest、reload generation，并让 active entry 命中 manifest 声明。包管理器退出码、候选参数回显、仅有 enabled 或仅有 active 状态都不算安装回读；任何一步缺失都标记为状态未知，不自动重试。

采用前页面会重新读取目标配置和模型环境；角色卡相关候选还会重新读取 `settings:agent-presets#/roster`。每次采用预检都必须提供不同于回归基线、且彼此独立的新 evidenceRef。`apply()` 要在同一协调锁里守住 fresh target、model-environment 与可选 presetRoster revision，并返回绑定 candidate、idempotencyKey、各 revision、默认 Preset ref、mapping ID 和 snapshot identity 的 `guardReceipt`；普通的“先查再写”不能关闭 TOCTOU 窗口。

浏览器本地存储只保存无值方案摘要，以及绑定当前快照 identity 的“待刷新标记”；方案摘要不含修改前后值、回读值或证据，标记也不能证明写入或回读成功。任何角色卡组成修改或默认角色卡切换在跨过写入边界前，都会同时建立字段 marker 与全局 `presetRoster` marker；在新快照或完整可信 live roster/composition 回读前，上下文、Persona 和工具编辑器一起遮蔽。只要写入请求跨过执行边界但没有形成可信回读，页面会持久化同样无值的“状态未知”标记并阻止重复提交。页面不恢复已核验回归、采用、线上健康、配置覆盖值或插件安装状态。直接以 `file://` 打开不能安全调用 DSH 回环 API。真实接入应把 DS Hub 作为 DSH Client UI 插件同源托管，或由受控本机 sidecar 提供上述适配器。DSH 当前没有原生社区目录、版本化测试集或 eval RPC，这三部分由 DS Hub sidecar 管理，不能伪装成 DSH 已经提供。

采用并回读一致只表示配置写入完成。`observeAdoption()` 必须回显本次 request/task/candidate/target/revision，返回 sidecar 签发的 observation receipt，以及逐任务的 session、开始时间、配置版本、结果和独立证据；页面会核对证据数量、唯一性、时间窗口和 receipt 绑定。至少 3 个采用后的新任务全部通过才显示“观察正常”；任一失败显示退化，样本不足或存在 unknown 时保持“等待观察”。接口缺失或证据不完整时同样不显示健康，绝不把配置成功等同于运行健康。

## 刷新本机快照

确认 DSH Web API 已在本机运行后：

```bash
node scripts/sync-dsh-snapshot.mjs http://127.0.0.1:3080 /path/to/project
```

脚本只接受 loopback DSH Web API，并在写文件前执行公开快照校验。它保存 DSH 已声明可路由的模型目录、配置清单和匿名汇总统计，不保存对话正文、会话标题、会话 ID、逐会话记录、项目路径、凭据或远程 API 地址；Skill 只从目标项目、目标默认角色卡的会话读取，不会跨项目兜底。默认只保留 Skill 名称和是否可被模型调用，所有角色卡 ID 都替换成本次同步随机引用；系统 Preset 的 Persona 可用于本机快速编辑，用户 Preset 正文默认隐藏。私有反向映射默认原子写入 `~/.dsh/ds-hub/private/preset-mapping.json`，目录权限 `0700`、文件权限 `0600`，也可用 `DS_HUB_PRIVATE_DIR` 指定其他仓库外目录。确实需要在本地评审更多文案时，可显式加 `--include-skill-copy`、`--include-user-preset-names` 或 `--include-user-prompt-copy`；带这些参数生成的文件不应未经人工复核直接公开提交。

## 本地验证

```bash
node --check app.js
node --check dsh-snapshot.js
node --check scripts/sync-dsh-snapshot.mjs
node scripts/ui-contract-smoke.mjs
node scripts/unknown-write-smoke.mjs
```

`ui-contract-smoke` 覆盖默认路由、四类快速候选、助手分析对象、伪造拖放拦截、消息摘要绑定、空 revision 拒绝、派生 proof 绑定与全局 Preset 门禁；`unknown-write-smoke` 覆盖写入状态未知后的遮蔽与重新同步恢复。同步脚本本身还会验证随机 ref、私有映射权限，以及旧 mapping / snapshot / roster 组合不能解析。它们是逻辑回归，不替代真实浏览器视觉验收和 sidecar 集成测试。

## 素材与许可说明

- `assets/dsh-icon.svg` 来自本机安装的 DSH Web 前端品牌图标，仅用于产品原型识别；本项目不代表 DeepSeek 官方发布。
- `assets/ds-mecha-girl.png` 是为本原型生成的概念素材。品牌、角色和商业使用权应在正式发布前单独审查。
- 本仓库暂未声明统一开源许可证；第三方社区项目各自适用其原许可证。
