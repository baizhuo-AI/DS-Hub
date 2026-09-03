#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const baseUrl = new URL(process.env.DSH_URL || 'http://127.0.0.1:3080');
const presetId = process.env.DS_HUB_PRESET || 'ds-hub-assistant';
const timeoutMs = 30_000;
const expectedPresetContent = await readFile(new URL('../dsh-client-plugin/preset/ds-hub-assistant/agent.cordis.yml', import.meta.url), 'utf8');
const expectedPresetDigest = `sha256:${createHash('sha256').update(expectedPresetContent).digest('hex')}`;

async function rpc(method, payload = {}, rpcId = `ds-hub-smoke-${randomUUID()}`) {
  const response = await fetch(new URL(`/api/${method}`, baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(response.ok, true, `${method} returned HTTP ${response.status}`);
  const envelope = await response.json();
  assert.equal(envelope?.type, 'server-response', `${method} returned the wrong envelope`);
  assert.equal(envelope?.rpcId, rpcId, `${method} returned the wrong rpcId`);
  assert.equal(envelope?.result?.ok, true, envelope?.result?.error?.message || `${method} failed`);
  return envelope.result.value;
}

function selectionOf(value) {
  if (!value || typeof value !== 'object') return null;
  const provider = String(value.provider || '').trim();
  const model = String(value.model || '').trim();
  const reasoningEffort = String(value.reasoningEffort || '').trim();
  return provider && model ? { provider, model, reasoningEffort } : null;
}

function sameSelection(left, right) {
  return Boolean(left && right
    && left.provider === right.provider
    && left.model === right.model
    && left.reasoningEffort === right.reasoningEffort);
}

async function history(sessionId) {
  const value = await rpc('session.history', { sessionId, maxMessages: 50 });
  return (value.events || []).map((row) => row?.event).filter(Boolean).sort((a, b) => a.seq - b.seq);
}

async function waitForCompletedTurn(sessionId, afterSeq) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await history(sessionId);
    const turnStart = events.find((event) => event.seq > afterSeq && event.type === 'turn/start');
    const turn = turnStart?.data?.turn;
    const turnEnd = turn == null ? null : events.find((event) => event.seq > turnStart.seq && event.type === 'turn/end' && event.data?.turn === turn);
    if (turnEnd) {
      const assistantMessage = events.findLast((event) => event.seq > turnStart.seq && event.seq < turnEnd.seq
        && event.type === 'assistant/message' && event.data?.turn === turn);
      const requestHeader = events.findLast((event) => event.seq < (assistantMessage?.seq ?? turnEnd.seq) && event.type === 'request/header');
      if (assistantMessage && requestHeader) return { turn, requestHeader, assistantMessage, turnEnd };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for the DSH model turn');
}

let sessionId = '';
try {
  const settings = await rpc('settings.describe');
  const modelNamespace = settings.namespaces?.find((row) => row.ns === 'agent-default-model');
  const configured = selectionOf(modelNamespace?.value);
  assert.ok(configured, 'DSH default model settings are incomplete');

  const providers = await rpc('llm.providers');
  assert.equal(providers.providers?.some((row) => row.provider === configured.provider && row.active === true), true, 'configured provider is not active');

  const presets = await rpc('agentPreset.list');
  const preset = presets.presets?.find((row) => row.id === presetId);
  assert.ok(preset && !preset.broken && preset.trust === 'user', `${presetId} is missing, broken, or not user-owned`);
  const presetRead = await rpc('agentPreset.read', { agentPreset: presetId });
  const presetDigest = typeof presetRead?.content === 'string'
    ? `sha256:${createHash('sha256').update(presetRead.content).digest('hex')}`
    : '';
  assert.equal(presetRead?.agentPreset, presetId, 'agentPreset.read returned the wrong preset');
  assert.equal(presetRead?.trust, 'user', 'DS Hub assistant preset is not user-owned');
  assert.equal(presetDigest, expectedPresetDigest, 'DS Hub assistant preset is not the exact tool-free composition');

  const created = await rpc('session.create', { agentPreset: presetId });
  sessionId = String(created.sessionId || '');
  assert.ok(sessionId, 'session.create did not return a session id');

  const models = await rpc('session.models', { sessionId });
  const selected = selectionOf(models.current);
  assert.equal(models.routable, true, 'DS Hub assistant session is not routable');
  assert.equal(sameSelection(selected, configured), true, 'session model does not match DSH default model');

  const before = await history(sessionId);
  const afterSeq = before.at(-1)?.seq ?? -1;
  const promptId = `ds-hub-live-smoke-${randomUUID()}`;
  const accepted = await rpc('session.prompt', {
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: '只回复：DS Hub 连接正常' }],
    clientTimeZone: 'UTC',
  }, promptId);
  assert.equal(accepted.accepted, true, 'DSH did not accept the smoke prompt');

  const turn = await waitForCompletedTurn(sessionId, afterSeq);
  assert.equal(turn.turnEnd?.data?.reason?.kind, 'completed', 'DSH turn did not complete');
  const header = selectionOf(turn.requestHeader?.data?.header?.config);
  const source = turn.assistantMessage?.data?.message?.source;
  assert.equal(sameSelection(header, configured), true, 'request header does not match DSH default model');
  assert.equal(source?.kind, 'model', 'assistant response did not come from a model');
  assert.equal(source?.provider, configured.provider, 'response provider does not match DSH settings');
  assert.equal(source?.model, configured.model, 'response model does not match DSH settings');
  const text = (turn.assistantMessage?.data?.message?.content || [])
    .filter((part) => part?.type === 'text')
    .map((part) => part.text)
    .join('')
    .trim();
  assert.ok(text, 'assistant response was empty');

  console.log(JSON.stringify({
    ok: true,
    preset: { id: preset.id, trust: preset.trust, digest: presetDigest },
    settingsRevision: modelNamespace.revision,
    selection: configured,
    evidence: {
      requestHeaderSeq: turn.requestHeader.seq,
      assistantMessageSeq: turn.assistantMessage.seq,
      turnEndSeq: turn.turnEnd.seq,
      endReason: turn.turnEnd.data.reason.kind,
    },
    response: text.slice(0, 120),
  }, null, 2));
} finally {
  if (sessionId) await rpc('workspace.archiveSession', { sessionId }).catch(() => undefined);
}
