export type WiseStructuredOutputs = {
  callClassification?: Record<string, unknown>;
  leadDetails?: Record<string, unknown>;
  agentQa?: Record<string, unknown>;
  raw: Record<string, unknown>;
  paths: string[];
};

function object(value: unknown): Record<string, any> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== 'string') return undefined;
  try { const parsed = JSON.parse(value); return object(parsed); } catch { return undefined; }
}

function canonicalName(value: string) { return value.toLowerCase().replace(/[\s-]+/g, '_'); }

function collect(payload: unknown) {
  const root = object(payload) || {};
  const containers: Array<[string, unknown]> = [
    ['analysis.structuredOutputs', root.analysis?.structuredOutputs],
    ['analysis.structuredData', root.analysis?.structuredData],
    ['structuredOutputs', root.structuredOutputs],
    ['structuredData', root.structuredData],
    ['artifact.structuredOutputs', root.artifact?.structuredOutputs],
    ['artifact.analysis.structuredOutputs', root.artifact?.analysis?.structuredOutputs],
    ['artifact.analysis.structuredData', root.artifact?.analysis?.structuredData],
    ['message.analysis.structuredOutputs', root.message?.analysis?.structuredOutputs],
    ['message.analysis.structuredData', root.message?.analysis?.structuredData],
    ['message.artifact.structuredOutputs', root.message?.artifact?.structuredOutputs],
    ['message.artifact.analysis.structuredData', root.message?.artifact?.analysis?.structuredData],
  ];
  const found: Array<{ name: string; value: Record<string, unknown>; path: string }> = [];
  for (const [path, candidate] of containers) {
    const container = object(candidate);
    if (!container) continue;
    for (const [key, entry] of Object.entries(container)) {
      const wrapper = object(entry);
      const value = object(wrapper?.result ?? wrapper?.value ?? entry);
      if (!value) continue;
      const name = canonicalName(String(wrapper?.name || wrapper?.slug || key));
      found.push({ name, value, path: `${path}.${key}` });
    }
    found.push({ name: '', value: container, path });
  }
  return found;
}

function looksLike(value: Record<string, unknown>, keys: string[]) {
  return keys.some(key => value[key] !== undefined);
}

export function findWiseStructuredOutputs(payload: unknown): WiseStructuredOutputs | null {
  const candidates = collect(payload);
  const pick = (name: string, keys: string[]) => candidates.find(item => item.name === name)?.value
    || candidates.find(item => object(item.value[name]))?.value[name] as Record<string, unknown> | undefined
    || candidates.find(item => looksLike(item.value, keys))?.value;
  const callClassification = pick('call_classification', ['call_outcome', 'human_answered', 'do_not_contact', 'wrong_number']);
  const leadDetails = pick('lead_details', ['decision_maker_name', 'demo_interest', 'callback_requested', 'next_action']);
  const agentQa = pick('agent_qa', ['goal_achieved', 'conversation_quality', 'agent_mistakes', 'customer_sentiment']);
  if (!callClassification && !leadDetails && !agentQa) return null;
  const raw: Record<string, unknown> = {};
  if (callClassification) raw.call_classification = callClassification;
  if (leadDetails) raw.lead_details = leadDetails;
  if (agentQa) raw.agent_qa = agentQa;
  return { callClassification, leadDetails, agentQa, raw, paths: candidates.map(item => item.path) };
}
