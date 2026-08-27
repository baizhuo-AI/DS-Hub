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
6. 安全修改遵循：诊断 → 单项候选 → 用户确认 → 写入 → 真实回读 → 隔离验证。写入请求返回但回读失败时，状态必须标为未知，不能自动重试。
7. 提示词一致性优先。先核对模型实际收到的输入，再检查变量缺失、规则冲突和示例复读；能够由代码确定的判断不堆进提示词。

## 当前体验

- 首页默认展示 DSH 图标；双击或键盘操作可切换机娘形象。
- Agent 显示名可双击修改，只保存在当前浏览器，不会冒充 DSH 配置改名。
- 五个模块采用“模块 → 能力 → 组件”的渐进展开方式。
- 组件库把“当前 DSH 回读”和“社区预置候选”分开。
- 运行观测只展示匿名会话统计，不读取标题和消息正文。
- 配置诊断助手支持本地规则演示，并预留真实 AI 与配置写入适配器；未连接时会明确提示。

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
| [dsh-context](https://www.npmjs.com/package/dsh-context) | 0.34.1 | Apache-2.0 | 上下文组成与压缩观察 |
| [@nanmicoder/dsh-agent-teams](https://www.npmjs.com/package/@nanmicoder/dsh-agent-teams) | 0.1.14 | MIT | 多 Agent 团队协作 |
| [dsh-vision-router](https://www.npmjs.com/package/dsh-vision-router) | 2.0.1 | MIT | 视觉路由与像素工具 |

安装前仍需检查源码、许可证、权限、外部数据传输、版本兼容和组件标识冲突，并在独立配置中完成基础测试。

## 配置诊断适配器

静态原型默认不连接模型，也不写入 DSH。宿主可以显式提供两个受控适配器：

```js
window.DS_HUB_AI_ADAPTER = {
  async ask({ conversationId, message, context, signal }) {
    return { text: '诊断结果', details: ['证据 1', '证据 2'] };
  },
};

window.DS_HUB_CONFIG_ADAPTER = {
  async preflight(request) { return { ok: true }; },
  async apply(request) { /* 只处理白名单 key 与 value */ },
  async readback(key) { return { value: 'workspace-write', verified: true }; },
};
```

页面只接受白名单配置提案。目前允许的目标是“新会话默认权限”和“默认模型推理强度”；模型返回的任意函数、配置键和值都不会直接执行。

每次 AI 请求会携带稳定的 `conversationId`、单独的当前消息、最近 12 条裁剪后的历史对话、当前候选方案和最多 6 条已保存方案。页面负责短期裁剪；更长的会话记忆与压缩由宿主适配器负责。请求等待超过 30 秒会解除界面锁定，并通过 `signal` 通知适配器取消。

写入请求还包含幂等键和修改前的期望值，便于宿主实现 CAS / 版本检查。配置写入只有在 `readback()` 返回的 `value` 与候选值精确一致时才算完成；`verified: true` 不能覆盖缺失或矛盾的回读值。

## 刷新本机快照

确认 DSH Web API 已在本机运行后：

```bash
node scripts/sync-dsh-snapshot.mjs http://127.0.0.1:3080 /path/to/project
```

脚本保存配置清单和匿名汇总统计，不保存对话正文、会话标题、会话 ID、逐会话记录、项目路径或凭据。Skill 名称与说明会进入快照，以便呈现真实能力；如果本机含私有 Skill，公开提交前仍需人工检查 `dsh-snapshot.js`。

## 素材与许可说明

- `assets/dsh-icon.svg` 来自本机安装的 DSH Web 前端品牌图标，仅用于产品原型识别；本项目不代表 DeepSeek 官方发布。
- `assets/ds-mecha-girl.png` 是为本原型生成的概念素材。品牌、角色和商业使用权应在正式发布前单独审查。
- 本仓库暂未声明统一开源许可证；第三方社区项目各自适用其原许可证。
