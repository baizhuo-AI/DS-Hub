/* Generated privacy-minimized snapshot. Review before public sharing; no conversation text or per-session records are included. */
window.DSH_SNAPSHOT = {
  "schemaVersion": 1,
  "capturedAt": "2026-08-27T21:32:13.100Z",
  "source": {
    "api": "loopback-dsh-web",
    "profile": "web",
    "packageVersion": "0.1.1-rc.2",
    "hostVersion": "0.0.1"
  },
  "config": {
    "defaultPresetId": "code",
    "presets": [
      {
        "id": "standard",
        "trust": "system",
        "isDefault": false,
        "name": "标准模式"
      },
      {
        "id": "code",
        "trust": "system",
        "isDefault": true,
        "name": "PTC 模式"
      },
      {
        "id": "minimal",
        "trust": "system",
        "isDefault": false,
        "name": "极简模式"
      },
      {
        "id": "cordis",
        "trust": "system",
        "isDefault": false,
        "name": "创造模式"
      }
    ],
    "authorablePresets": true,
    "activePreset": {
      "id": "code",
      "trust": "system",
      "name": "PTC 模式"
    },
    "model": {
      "provider": "deepseek-official",
      "model": "deepseek-v4-flash-vision-exp",
      "reasoningEffort": "max",
      "contextWindow": 1000000,
      "inputModalities": [
        "text",
        "image"
      ],
      "maxTokens": 256000,
      "metadataNamespace": "llm-deepseek"
    },
    "webSearch": {
      "model": "deepseek-v4-flash",
      "maxTokens": 4096,
      "maxUses": 5
    },
    "agentLoop": {
      "maxParallelToolCalls": 10
    },
    "shell": {
      "timeoutMs": 60000,
      "maxTimeoutMs": 600000
    },
    "permission": {
      "defaultPreset": "danger-full-access"
    },
    "locale": "zh",
    "theme": "system",
    "conversation": {
      "busyEnter": "queue"
    },
    "presetRows": [
      {
        "id": "persona",
        "moduleName": "@deepseek-ai/dsh-persona",
        "enabled": true,
        "config": {}
      },
      {
        "id": "agent-instructions",
        "moduleName": "@deepseek-ai/dsh-agent-instructions",
        "enabled": true,
        "config": {
          "maxBytes": 65536
        }
      },
      {
        "id": "tool-bash",
        "moduleName": "@deepseek-ai/dsh-tool-bash",
        "enabled": true,
        "config": {}
      },
      {
        "id": "tool-pwsh",
        "moduleName": "@deepseek-ai/dsh-tool-pwsh",
        "enabled": false,
        "config": {}
      },
      {
        "id": "tool-fs",
        "moduleName": "@deepseek-ai/dsh-tool-fs",
        "enabled": true,
        "config": {}
      },
      {
        "id": "tool-fs-search",
        "moduleName": "@deepseek-ai/dsh-tool-fs-search",
        "enabled": true,
        "config": {}
      },
      {
        "id": "tool-jobs",
        "moduleName": "@deepseek-ai/dsh-tool-jobs",
        "enabled": true,
        "config": {}
      },
      {
        "id": "skill-filesystem",
        "moduleName": "@deepseek-ai/dsh-skill-filesystem",
        "enabled": true,
        "config": {}
      },
      {
        "id": "tool-skill",
        "moduleName": "@deepseek-ai/dsh-tool-skill",
        "enabled": true,
        "config": {}
      },
      {
        "id": "tool-goal",
        "moduleName": "@deepseek-ai/dsh-tool-goal",
        "enabled": true,
        "config": {}
      },
      {
        "id": "plan-mode",
        "moduleName": "@deepseek-ai/dsh-plan-mode",
        "enabled": true,
        "config": {}
      },
      {
        "id": "compaction-basic",
        "moduleName": "@deepseek-ai/dsh-compaction-basic",
        "enabled": true,
        "config": {}
      },
      {
        "id": "command-compact",
        "moduleName": "@deepseek-ai/dsh-command-compact",
        "enabled": true,
        "config": {}
      },
      {
        "id": "tool-result-pruner",
        "moduleName": "@deepseek-ai/dsh-compaction-tool-result-pruner",
        "enabled": true,
        "config": {
          "thresholdChars": 8192
        }
      },
      {
        "id": "tool-subagent-control",
        "moduleName": "@deepseek-ai/dsh-tool-subagent-control",
        "enabled": true,
        "config": {}
      },
      {
        "id": "tool-subagent-list-agents",
        "moduleName": "@deepseek-ai/dsh-tool-subagent-control/list-agents",
        "enabled": true,
        "config": {}
      },
      {
        "id": "tool-subagent",
        "moduleName": "@deepseek-ai/dsh-tool-subagent",
        "enabled": true,
        "config": {
          "provider": "spawn",
          "toolName": "subagent"
        }
      },
      {
        "id": "tool-subagent-fork",
        "moduleName": "@deepseek-ai/dsh-tool-subagent",
        "enabled": true,
        "config": {
          "provider": "fork",
          "toolName": "subagent_fork"
        }
      },
      {
        "id": "tool-subagent-codex",
        "moduleName": "@deepseek-ai/dsh-tool-subagent",
        "enabled": false,
        "config": {
          "provider": "codex",
          "toolName": "subagent_codex"
        }
      },
      {
        "id": "tool-subagent-claude-code",
        "moduleName": "@deepseek-ai/dsh-tool-subagent",
        "enabled": false,
        "config": {
          "provider": "claude-code",
          "toolName": "subagent_claude_code"
        }
      },
      {
        "id": "workflow-worker-thread",
        "moduleName": "@deepseek-ai/dsh-workflow-worker-thread",
        "enabled": true,
        "config": {
          "provider": "spawn"
        }
      },
      {
        "id": "tool-workflow",
        "moduleName": "@deepseek-ai/dsh-tool-workflow",
        "enabled": true,
        "config": {}
      },
      {
        "id": "tool-ralph",
        "moduleName": "@deepseek-ai/dsh-tool-ralph",
        "enabled": true,
        "config": {
          "maxRounds": 64
        }
      },
      {
        "id": "tool-ask-user",
        "moduleName": "@deepseek-ai/dsh-tool-ask-user",
        "enabled": true,
        "config": {}
      },
      {
        "id": "tool-todo",
        "moduleName": "@deepseek-ai/dsh-tool-todo",
        "enabled": true,
        "config": {
          "allowParallelInProgress": true
        }
      },
      {
        "id": "tool-web",
        "moduleName": "@deepseek-ai/dsh-tool-web",
        "enabled": true,
        "config": {
          "fetch": false,
          "searchTimeoutMs": 60000
        }
      },
      {
        "id": "tool-presentation",
        "moduleName": "@deepseek-ai/dsh-agent-tool-presentation",
        "enabled": true,
        "config": {
          "mode": "code"
        }
      }
    ]
  },
  "plugins": [
    {
      "entryId": "include",
      "moduleName": "cordis:include",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:timer",
      "moduleName": "@deepseek-ai/cordis-plugin-timer",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:hmr",
      "moduleName": "@deepseek-ai/cordis-plugin-hmr",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:llm",
      "moduleName": "@deepseek-ai/dsh-llm",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:session",
      "moduleName": "@deepseek-ai/dsh-session",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:typert",
      "moduleName": "@deepseek-ai/dsh-typert-registry",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:typert-loader",
      "moduleName": "@deepseek-ai/dsh-typert-loader",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:typert-gateway",
      "moduleName": "@deepseek-ai/dsh-api-gateway",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:session-title",
      "moduleName": "@deepseek-ai/dsh-session-title",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:session-title-llm",
      "moduleName": "@deepseek-ai/dsh-session-title-first-prompt-llm",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:user-questions",
      "moduleName": "@deepseek-ai/dsh-user-questions",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent",
      "moduleName": "@deepseek-ai/dsh-agent",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-default-model",
      "moduleName": "@deepseek-ai/dsh-agent-default-model",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:jobs",
      "moduleName": "@deepseek-ai/dsh-jobs-local",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:llm-retry",
      "moduleName": "@deepseek-ai/dsh-llm-retry",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:settings",
      "moduleName": "@deepseek-ai/dsh-settings-file",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:credentials",
      "moduleName": "@deepseek-ai/dsh-credentials-local",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:llm-pi-ai",
      "moduleName": "@deepseek-ai/dsh-llm-pi-ai",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:session-persistence-jsonl",
      "moduleName": "@deepseek-ai/dsh-session-persistence-jsonl",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:attachment-local",
      "moduleName": "@deepseek-ai/dsh-attachment-local",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:session-query-sqlite",
      "moduleName": "@deepseek-ai/dsh-session-query-sqlite",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:session-projection",
      "moduleName": "@deepseek-ai/dsh-session-projection",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:session-telemetry-otel",
      "moduleName": "@deepseek-ai/dsh-session-telemetry-otel",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:subprocess",
      "moduleName": "@deepseek-ai/dsh-subprocess-local",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:sandbox",
      "moduleName": "@deepseek-ai/dsh-sandbox-local",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:sandbox-policy",
      "moduleName": "@deepseek-ai/dsh-sandbox-policy",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:bash-sandbox",
      "moduleName": "@deepseek-ai/dsh-bash-sandbox",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:pwsh-sandbox",
      "moduleName": "@deepseek-ai/dsh-pwsh-sandbox",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:approval",
      "moduleName": "@deepseek-ai/dsh-user-approval",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:permission",
      "moduleName": "@deepseek-ai/dsh-permission-presets",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:shell-env",
      "moduleName": "@deepseek-ai/dsh-shell-env",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:tool-bash",
      "moduleName": "@deepseek-ai/dsh-tool-bash",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:tool-pwsh",
      "moduleName": "@deepseek-ai/dsh-tool-pwsh",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:tool-jobs",
      "moduleName": "@deepseek-ai/dsh-tool-jobs",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:fs-observation-policy",
      "moduleName": "@deepseek-ai/dsh-fs-observation-policy",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:tool-fs",
      "moduleName": "@deepseek-ai/dsh-tool-fs",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:tool-fs-search",
      "moduleName": "@deepseek-ai/dsh-tool-fs-search",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:agent-instructions",
      "moduleName": "@deepseek-ai/dsh-agent-instructions",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:skill",
      "moduleName": "@deepseek-ai/dsh-skill",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:skill-filesystem",
      "moduleName": "@deepseek-ai/dsh-skill-filesystem",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:skill-badge",
      "moduleName": "@deepseek-ai/dsh-skill-badge",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:tool-skill",
      "moduleName": "@deepseek-ai/dsh-tool-skill",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:commands",
      "moduleName": "@deepseek-ai/dsh-commands",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:command-feedback",
      "moduleName": "@deepseek-ai/dsh-command-feedback",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:goal",
      "moduleName": "@deepseek-ai/dsh-goal",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:goal-round-driver",
      "moduleName": "@deepseek-ai/dsh-goal-round-driver",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:command-goal",
      "moduleName": "@deepseek-ai/dsh-command-goal",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:plan-mode",
      "moduleName": "@deepseek-ai/dsh-plan-mode",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:token-meter",
      "moduleName": "@deepseek-ai/dsh-token-meter",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:compaction-basic",
      "moduleName": "@deepseek-ai/dsh-compaction-basic",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:command-compact",
      "moduleName": "@deepseek-ai/dsh-command-compact",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:subagent",
      "moduleName": "@deepseek-ai/dsh-subagent",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:subagent-spawn-in-process",
      "moduleName": "@deepseek-ai/dsh-subagent-spawn-in-process",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:subagent-fork-in-process",
      "moduleName": "@deepseek-ai/dsh-subagent-fork-in-process",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:tool-subagent-control",
      "moduleName": "@deepseek-ai/dsh-tool-subagent-control",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:tool-subagent-list-agents",
      "moduleName": "@deepseek-ai/dsh-tool-subagent-control/list-agents",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:tool-subagent",
      "moduleName": "@deepseek-ai/dsh-tool-subagent",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:tool-subagent-fork",
      "moduleName": "@deepseek-ai/dsh-tool-subagent",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:tool-subagent-report",
      "moduleName": "@deepseek-ai/dsh-tool-subagent-report",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:workflow-worker-thread",
      "moduleName": "@deepseek-ai/dsh-workflow-worker-thread",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:tool-workflow",
      "moduleName": "@deepseek-ai/dsh-tool-workflow",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:timeout-policy",
      "moduleName": "@deepseek-ai/dsh-tool-call-timeout-policy",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:spill-local",
      "moduleName": "@deepseek-ai/dsh-spill-local",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:spill-policy",
      "moduleName": "@deepseek-ai/dsh-spill-policy",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:session-checkpoint-policy",
      "moduleName": "@deepseek-ai/dsh-session-checkpoint-policy",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:tool-result-pruner",
      "moduleName": "@deepseek-ai/dsh-compaction-tool-result-pruner",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:tool-todo",
      "moduleName": "@deepseek-ai/dsh-tool-todo",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:tool-goal",
      "moduleName": "@deepseek-ai/dsh-tool-goal",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:tool-ralph",
      "moduleName": "@deepseek-ai/dsh-tool-ralph",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:tool-str-replace-editor",
      "moduleName": "@deepseek-ai/dsh-tool-str-replace-editor",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:repeat-tool-reminder",
      "moduleName": "@deepseek-ai/dsh-repeat-tool-reminder",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:web",
      "moduleName": "@deepseek-ai/dsh-web",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:web-search-deepseek",
      "moduleName": "@deepseek-ai/dsh-web-search-deepseek",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:tool-web",
      "moduleName": "@deepseek-ai/dsh-tool-web",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:tools",
      "moduleName": "@deepseek-ai/dsh-tools",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:system-prompt",
      "moduleName": "@deepseek-ai/dsh-system-prompt",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-loop",
      "moduleName": "@deepseek-ai/dsh-agent-loop",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:fs-sandbox",
      "moduleName": "@deepseek-ai/dsh-fs-sandbox",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:llm-deepseek",
      "moduleName": "@deepseek-ai/dsh-llm-deepseek",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:code-runtime",
      "moduleName": "@deepseek-ai/dsh-code-runtime-worker-thread",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:storage",
      "moduleName": "@deepseek-ai/dsh-storage",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:storage-json",
      "moduleName": "@deepseek-ai/dsh-storage-json",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:storage-domain",
      "moduleName": "@deepseek-ai/dsh-storage-domain",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:message-feedback",
      "moduleName": "@deepseek-ai/dsh-message-feedback",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:session-log-download",
      "moduleName": "@deepseek-ai/dsh-session-log-export",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:workspace",
      "moduleName": "@deepseek-ai/dsh-workspace",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:session-projection-cache",
      "moduleName": "@deepseek-ai/dsh-session-projection-cache",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:session-reference",
      "moduleName": "@deepseek-ai/dsh-session-reference",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:file-reference-local",
      "moduleName": "@deepseek-ai/dsh-file-reference-local",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:session-stats",
      "moduleName": "@deepseek-ai/dsh-session-stats",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:directory-picker",
      "moduleName": "@deepseek-ai/dsh-host-directory-picker-auto",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:plugin-inventory",
      "moduleName": "@deepseek-ai/dsh-host-plugin-inventory",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:api-gateway",
      "moduleName": "@deepseek-ai/dsh-host-apiproxy",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:cordis-host-runner",
      "moduleName": "@deepseek-ai/dsh-cordis-host-runner",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:web-startup",
      "moduleName": "@deepseek-ai/dsh-web-app/startup",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:webserver",
      "moduleName": "@deepseek-ai/dsh-host-webserver",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:web-runtime",
      "moduleName": "@deepseek-ai/dsh-web-app",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:client-hmr",
      "moduleName": "@deepseek-ai/dsh-client-hmr",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:modules",
      "moduleName": "@deepseek-ai/dsh-client-modules",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:connection",
      "moduleName": "@deepseek-ai/dsh-client-connection",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:api-remotes",
      "moduleName": "@deepseek-ai/dsh-api-remotes",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:client-runtime",
      "moduleName": "@deepseek-ai/dsh-client-runtime",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:cordis-client-runner",
      "moduleName": "@deepseek-ai/dsh-cordis-client-runner",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-theme",
      "moduleName": "@deepseek-ai/dsh-client-ui-theme",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:locale",
      "moduleName": "@deepseek-ai/dsh-client-locale",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-layout",
      "moduleName": "@deepseek-ai/dsh-client-ui-layout",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-renderer",
      "moduleName": "@deepseek-ai/dsh-client-ui-renderer",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-sidebar",
      "moduleName": "@deepseek-ai/dsh-client-ui-sidebar",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-settings",
      "moduleName": "@deepseek-ai/dsh-client-ui-settings",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-settings-general",
      "moduleName": "@deepseek-ai/dsh-client-ui-settings-general",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-settings-models",
      "moduleName": "@deepseek-ai/dsh-client-ui-settings-models",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-settings-plugin-inventory",
      "moduleName": "@deepseek-ai/dsh-client-ui-settings-plugin-inventory",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-conversation",
      "moduleName": "@deepseek-ai/dsh-client-ui-conversation",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-brand-official",
      "moduleName": "@deepseek-ai/dsh-client-ui-brand-official",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-attachment",
      "moduleName": "@deepseek-ai/dsh-client-ui-attachment",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-tool",
      "moduleName": "@deepseek-ai/dsh-client-ui-tool",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-cordis",
      "moduleName": "@deepseek-ai/dsh-client-ui-cordis",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-workflow-run",
      "moduleName": "@deepseek-ai/dsh-client-ui-workflow-run",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-deliverables",
      "moduleName": "@deepseek-ai/dsh-client-ui-deliverables",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-workspace",
      "moduleName": "@deepseek-ai/dsh-client-ui-workspace",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-input-trigger",
      "moduleName": "@deepseek-ai/dsh-client-ui-input-trigger",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-commands",
      "moduleName": "@deepseek-ai/dsh-client-ui-commands",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-skill",
      "moduleName": "@deepseek-ai/dsh-client-ui-skill",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-subagent",
      "moduleName": "@deepseek-ai/dsh-client-ui-subagent",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-reference",
      "moduleName": "@deepseek-ai/dsh-client-ui-reference",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-jobs",
      "moduleName": "@deepseek-ai/dsh-client-ui-jobs",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-goal",
      "moduleName": "@deepseek-ai/dsh-client-ui-goal",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-message-feedback",
      "moduleName": "@deepseek-ai/dsh-client-ui-message-feedback",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-model-selection",
      "moduleName": "@deepseek-ai/dsh-client-ui-model-selection",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-permission",
      "moduleName": "@deepseek-ai/dsh-client-ui-permission-presets",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-agent-preset",
      "moduleName": "@deepseek-ai/dsh-client-ui-agent-preset",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-settings-plugins",
      "moduleName": "@deepseek-ai/dsh-client-ui-settings-plugins",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-plan",
      "moduleName": "@deepseek-ai/dsh-client-ui-plan",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-user-questions",
      "moduleName": "@deepseek-ai/dsh-client-ui-user-questions",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-trajectory",
      "moduleName": "@deepseek-ai/dsh-client-ui-trajectory",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets",
      "moduleName": "@deepseek-ai/dsh-agent-presets",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets:persona",
      "moduleName": "@deepseek-ai/dsh-persona",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets:agent-instructions",
      "moduleName": "@deepseek-ai/dsh-agent-instructions",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets:tool-bash",
      "moduleName": "@deepseek-ai/dsh-tool-bash",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets:tool-pwsh",
      "moduleName": "@deepseek-ai/dsh-tool-pwsh",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:agent-presets:tool-fs",
      "moduleName": "@deepseek-ai/dsh-tool-fs",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets:tool-fs-search",
      "moduleName": "@deepseek-ai/dsh-tool-fs-search",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets:tool-jobs",
      "moduleName": "@deepseek-ai/dsh-tool-jobs",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets:skill-filesystem",
      "moduleName": "@deepseek-ai/dsh-skill-filesystem",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets:tool-skill",
      "moduleName": "@deepseek-ai/dsh-tool-skill",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets:tool-goal",
      "moduleName": "@deepseek-ai/dsh-tool-goal",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets:tool-ask-user",
      "moduleName": "@deepseek-ai/dsh-tool-ask-user",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets:tool-todo",
      "moduleName": "@deepseek-ai/dsh-tool-todo",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets:tool-web",
      "moduleName": "@deepseek-ai/dsh-tool-web",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets:plan-mode",
      "moduleName": "@deepseek-ai/dsh-plan-mode",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets:compaction-basic",
      "moduleName": "@deepseek-ai/dsh-compaction-basic",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets:command-compact",
      "moduleName": "@deepseek-ai/dsh-command-compact",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets:tool-result-pruner",
      "moduleName": "@deepseek-ai/dsh-compaction-tool-result-pruner",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets:tool-subagent-control",
      "moduleName": "@deepseek-ai/dsh-tool-subagent-control",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets:tool-subagent-list-agents",
      "moduleName": "@deepseek-ai/dsh-tool-subagent-control/list-agents",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets:tool-subagent",
      "moduleName": "@deepseek-ai/dsh-tool-subagent",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets:tool-subagent-fork",
      "moduleName": "@deepseek-ai/dsh-tool-subagent",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets:tool-subagent-codex",
      "moduleName": "@deepseek-ai/dsh-tool-subagent",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:agent-presets:tool-subagent-claude-code",
      "moduleName": "@deepseek-ai/dsh-tool-subagent",
      "enabled": false,
      "fiberPhase": null
    },
    {
      "entryId": "include:agent-presets:workflow-worker-thread",
      "moduleName": "@deepseek-ai/dsh-workflow-worker-thread",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets:tool-workflow",
      "moduleName": "@deepseek-ai/dsh-tool-workflow",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:agent-presets:tool-ralph",
      "moduleName": "@deepseek-ai/dsh-tool-ralph",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "include:ui-dimension-demo",
      "moduleName": "dsh-dimension-demo",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "03e542aa",
      "moduleName": "@deepseek-ai/dsh-host-directory-picker-native",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "8621559e",
      "moduleName": "@deepseek-ai/dsh-client-ui-directory-picker-native",
      "enabled": true,
      "fiberPhase": "active"
    },
    {
      "entryId": "af372855",
      "moduleName": "@deepseek-ai/cordis-plugin-hmr",
      "enabled": true,
      "fiberPhase": "active"
    }
  ],
  "skillInventory": {
    "status": "available",
    "source": "project_session",
    "presetId": "code",
    "copyIncluded": false
  },
  "skills": [
    {
      "name": "lark-approval",
      "modelInvocable": true
    },
    {
      "name": "lark-apps",
      "modelInvocable": true
    },
    {
      "name": "lark-attendance",
      "modelInvocable": true
    },
    {
      "name": "lark-base",
      "modelInvocable": true
    },
    {
      "name": "lark-calendar",
      "modelInvocable": true
    },
    {
      "name": "lark-contact",
      "modelInvocable": true
    },
    {
      "name": "lark-doc",
      "modelInvocable": true
    },
    {
      "name": "lark-drive",
      "modelInvocable": true
    },
    {
      "name": "lark-event",
      "modelInvocable": true
    },
    {
      "name": "lark-im",
      "modelInvocable": true
    },
    {
      "name": "lark-mail",
      "modelInvocable": true
    },
    {
      "name": "lark-markdown",
      "modelInvocable": true
    },
    {
      "name": "lark-meeting",
      "modelInvocable": true
    },
    {
      "name": "lark-minutes",
      "modelInvocable": true
    },
    {
      "name": "lark-note",
      "modelInvocable": true
    },
    {
      "name": "lark-okr",
      "modelInvocable": true
    },
    {
      "name": "lark-openapi-explorer",
      "modelInvocable": true
    },
    {
      "name": "lark-shared",
      "modelInvocable": true
    },
    {
      "name": "lark-sheets",
      "modelInvocable": true
    },
    {
      "name": "lark-skill-maker",
      "modelInvocable": true
    },
    {
      "name": "lark-slides",
      "modelInvocable": true
    },
    {
      "name": "lark-task",
      "modelInvocable": true
    },
    {
      "name": "lark-vc",
      "modelInvocable": true
    },
    {
      "name": "lark-vc-agent",
      "modelInvocable": true
    },
    {
      "name": "lark-whiteboard",
      "modelInvocable": true
    },
    {
      "name": "lark-wiki",
      "modelInvocable": true
    },
    {
      "name": "lark-workflow-meeting-summary",
      "modelInvocable": true
    },
    {
      "name": "lark-workflow-standup-report",
      "modelInvocable": true
    }
  ],
  "sessions": {
    "all": {
      "total": 11,
      "running": 0,
      "blank": 4,
      "presetCounts": {
        "code": 7,
        "standard": 4
      },
      "permissionCounts": {
        "danger-full-access": 11
      },
      "stats": {
        "turns": 44,
        "steps": 255,
        "llmMs": 3087774,
        "toolMs": 291993,
        "uncachedInputTokens": 742027,
        "outputTokens": 218497,
        "cacheReadTokens": 20219904,
        "cacheWriteTokens": 0
      }
    },
    "project": {
      "path": "当前项目（已匿名）",
      "total": 3,
      "running": 0,
      "blank": 1,
      "presetCounts": {
        "code": 2,
        "standard": 1
      },
      "permissionCounts": {
        "danger-full-access": 3
      },
      "stats": {
        "turns": 12,
        "steps": 73,
        "llmMs": 1302461,
        "toolMs": 131457,
        "uncachedInputTokens": 282393,
        "outputTokens": 77691,
        "cacheReadTokens": 3566080,
        "cacheWriteTokens": 0
      },
      "recent": [],
      "daily": [
        {
          "date": "2026-08-21",
          "count": 0
        },
        {
          "date": "2026-08-22",
          "count": 0
        },
        {
          "date": "2026-08-23",
          "count": 0
        },
        {
          "date": "2026-08-24",
          "count": 0
        },
        {
          "date": "2026-08-25",
          "count": 0
        },
        {
          "date": "2026-08-26",
          "count": 1
        },
        {
          "date": "2026-08-27",
          "count": 1
        }
      ]
    }
  }
};
