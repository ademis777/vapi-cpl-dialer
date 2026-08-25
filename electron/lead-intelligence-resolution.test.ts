import assert from 'node:assert/strict';
import test from 'node:test';
import { extractLegacyCallAnalysis, resolveLeadIntelligence } from './lead-intelligence-resolution.js';

const contact = { company: 'Example Roofing', contactName: 'Test Contact', phone: '+12125550126' };

test('legacy no-transcript boilerplate is removed from Summary', () => {
  assert.equal(extractLegacyCallAnalysis({ analysis: { summary: 'There is no transcript provided to summarize.' } }).summary, '');
});

test('legacy analysis reads Vapi summary and Warm lead from the baseline fields', () => {
  assert.deepEqual(extractLegacyCallAnalysis({ analysis: { summary: 'Useful summary', structuredData: { lead: 'Warm' }, successEvaluation: 'true' }, summary: 'duplicate' }), { summary: 'Useful summary', lead: 'Warm' });
});
const intelligence = {
  lead: 'Warm', customerName: 'Test Contact', company: 'Example Roofing', phone: '+12125550126', interestLevel: 'Medium',
  currentSituation: ['No website'], painPoints: ['No online presence'], questionsAsked: ['Price'], objections: [],
  decisionMaker: 'Yes', budgetSignals: 'Medium', urgency: 'Medium', nextStep: 'Send demo',
  followUpRecommendation: 'Call after demo delivery.', customerSummary: ['Does not have a website.'],
};

function dependencies(analyzed: unknown = intelligence) {
  const events: Array<{ event: string; details: Record<string, unknown> }> = [];
  let analysisCalls = 0;
  return {
    value: {
      analyzeTranscript: async () => { analysisCalls += 1; return analyzed; },
      log: (event: string, details: Record<string, unknown>) => events.push({ event, details }),
    },
    events,
    analysisCalls: () => analysisCalls,
  };
}

test('Vapi structured output is used without transcript fallback', async () => {
  const deps = dependencies();
  const result = await resolveLeadIntelligence({ analysis: { structuredData: intelligence }, artifact: { transcript: 'Customer transcript' } }, contact, deps.value);
  assert.equal(result.source, 'vapi_structured_output');
  assert.equal(result.structuredPath, 'call.analysis.structuredData');
  assert.equal(deps.analysisCalls(), 0);
});

test('missing structured output with a full transcript uses model fallback', async () => {
  const deps = dependencies({ ...intelligence, lead: 'Hot', interestLevel: 'High' });
  const result = await resolveLeadIntelligence({ analysis: { successEvaluation: 'true' }, artifact: { transcript: 'Customer asked about price and agreed to a demo.' } }, contact, deps.value);
  assert.equal(result.source, 'transcript_fallback_analysis');
  assert.equal(result.intelligence.lead, 'Hot');
  assert.equal(deps.analysisCalls(), 1);
});

test('missing structured output and transcript uses Unknown only', async () => {
  const deps = dependencies();
  const result = await resolveLeadIntelligence({ analysis: { successEvaluation: 'false' }, artifact: {} }, contact, deps.value);
  assert.equal(result.source, 'empty_fallback');
  assert.equal(result.intelligence.lead, 'Unknown');
  assert.equal(deps.analysisCalls(), 0);
});

test('nested artifact analysis structured output is extracted', async () => {
  const deps = dependencies();
  const result = await resolveLeadIntelligence({ artifact: { analysis: { structuredData: intelligence } } }, contact, deps.value);
  assert.equal(result.source, 'vapi_structured_output');
  assert.equal(result.structuredPath, 'call.artifact.analysis.structuredData');
});

test('JSON string in markdown fence and snake_case fields is normalized', async () => {
  const deps = dependencies();
  const snake = { lead: 'warm', customer_name: 'Michael', interest_level: 'medium', current_situation: 'No website; Uses Google Business', pain_points: ['No online presence'], questions_asked: 'Price', customer_summary: ['Interested in a demo.'] };
  const result = await resolveLeadIntelligence({ analysis: { structuredData: `\`\`\`json\n${JSON.stringify(snake)}\n\`\`\`` } }, contact, deps.value);
  assert.equal(result.source, 'vapi_structured_output');
  assert.equal(result.intelligence.lead, 'Warm');
  assert.equal(result.intelligence.interestLevel, 'Medium');
  assert.deepEqual(result.intelligence.currentSituation, ['No website', 'Uses Google Business']);
});

test('invalid structured output is logged and transcript fallback is used', async () => {
  const deps = dependencies();
  const result = await resolveLeadIntelligence({ analysis: { structuredData: '{not valid json' }, artifact: { transcript: 'Useful customer transcript.' } }, contact, deps.value);
  assert.equal(result.source, 'transcript_fallback_analysis');
  assert.ok(deps.events.some(item => item.event === 'lead_intelligence_structured_output_error'));
  assert.equal(deps.analysisCalls(), 1);
});

test('testMode cannot affect Lead Intelligence resolution', async () => {
  const call = { analysis: { structuredData: intelligence }, artifact: { transcript: 'Customer transcript' } };
  const first = await resolveLeadIntelligence(call, contact, dependencies().value);
  const second = await resolveLeadIntelligence(call, contact, dependencies().value);
  assert.deepEqual(first, second);
  assert.equal(first.source, 'vapi_structured_output');
});

test('empty Hot Lead Rules cannot suppress transcript intelligence fields', async () => {
  const deps = dependencies(intelligence);
  const result = await resolveLeadIntelligence({ artifact: { transcript: 'Customer has no website, asks about price, and agrees to receive a demo.' } }, contact, deps.value);
  assert.equal(result.source, 'transcript_fallback_analysis');
  assert.deepEqual(result.intelligence.currentSituation, ['No website']);
  assert.deepEqual(result.intelligence.questionsAsked, ['Price']);
  assert.deepEqual(result.intelligence.customerSummary, ['Does not have a website.']);
});
