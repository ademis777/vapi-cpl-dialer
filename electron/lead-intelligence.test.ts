import assert from 'node:assert/strict';
import test from 'node:test';
import { extractLeadIntelligence, extractLeadIntelligenceFromPayload } from './lead-intelligence.js';

const contact = { company: 'Example Roofing', phone: '+12125550126' };

function payload(lead: 'Hot' | 'Warm' | 'Cold', overrides: Record<string, unknown> = {}) {
  return { analysis: { structuredData: {
    lead,
    customerName: 'Michael Carter',
    company: 'Example Roofing',
    phone: '+12125550126',
    interestLevel: lead === 'Hot' ? 'High' : lead === 'Warm' ? 'Medium' : 'Low',
    currentSituation: ['No website', 'Gets customers from referrals'],
    painPoints: ['No online presence'],
    questionsAsked: ['Price', 'Timeline'],
    objections: ['Need to think'],
    decisionMaker: 'Yes',
    budgetSignals: 'Medium',
    urgency: lead === 'Hot' ? 'Hot' : lead === 'Warm' ? 'Medium' : 'Low',
    nextStep: 'Send demo',
    followUpRecommendation: 'Call again in 2 days after demo delivery.',
    customerSummary: ['Gets customers from referrals.', 'Does not have a website.', 'Asked about pricing and timeline.'],
    ...overrides,
  } } };
}

test('extracts Warm lead intelligence with customer-only summary', () => {
  const result = extractLeadIntelligenceFromPayload(payload('Warm', {
    customerSummary: ['Gets customers from referrals.', 'Alex explained the website offer.', 'Agreed to receive a demo.'],
  }), contact);
  assert.equal(result.lead, 'Warm');
  assert.equal(result.interestLevel, 'Medium');
  assert.deepEqual(result.customerSummary, ['Gets customers from referrals.', 'Agreed to receive a demo.']);
});

test('extracts Hot lead intelligence', () => {
  const result = extractLeadIntelligenceFromPayload(payload('Hot', { objections: [], nextStep: 'Schedule callback' }), contact);
  assert.equal(result.lead, 'Hot');
  assert.equal(result.urgency, 'Hot');
  assert.equal(result.nextStep, 'Schedule callback');
  assert.deepEqual(result.objections, []);
});

test('extracts Cold lead intelligence', () => {
  const result = extractLeadIntelligenceFromPayload(payload('Cold', { questionsAsked: [], budgetSignals: 'Low' }), contact);
  assert.equal(result.lead, 'Cold');
  assert.equal(result.interestLevel, 'Low');
  assert.equal(result.budgetSignals, 'Low');
  assert.deepEqual(result.questionsAsked, []);
});

test('extracts structured analysis when transcript is absent', () => {
  const noTranscriptPayload = payload('Warm', { currentSituation: ['Uses Google Business'] });
  const result = extractLeadIntelligenceFromPayload(noTranscriptPayload, contact);
  assert.deepEqual(result.currentSituation, ['Uses Google Business']);
  assert.equal(result.company, 'Example Roofing');
});

test('consumes Vapi artifact structuredOutputs used by real calls', () => {
  const result = extractLeadIntelligenceFromPayload({
    artifact: { structuredOutputs: {
      'output-id': { name: 'lead_intelligence', result: {
        interest_level: 'Cold',
        customer_summary: 'Receptionist said the decision maker was unavailable;Asked the caller to call back later',
      } },
    } },
  }, { company: 'Sample Roof Co', phone: '+12125550124' });
  assert.equal(result.lead, 'Cold');
  assert.deepEqual(result.customerSummary, [
    'Receptionist said the decision maker was unavailable',
    'Asked the caller to call back later',
  ]);
});

test('empty analysis produces a complete Unknown structure without narrative summary', () => {
  const result = extractLeadIntelligenceFromPayload({ analysis: {} }, contact);
  assert.deepEqual(result, {
    lead: 'Unknown',
    customerName: 'Unknown',
    company: 'Example Roofing',
    phone: '+12125550126',
    interestLevel: 'Unknown',
    currentSituation: [],
    painPoints: [],
    questionsAsked: [],
    objections: [],
    decisionMaker: 'Unknown',
    budgetSignals: 'Unknown',
    urgency: 'Unknown',
    nextStep: 'Unknown',
    followUpRecommendation: 'Unknown',
    customerSummary: [],
  });
});

test('customer summary is limited to five bullets', () => {
  const result = extractLeadIntelligenceFromPayload(payload('Warm', { customerSummary: ['1', '2', '3', '4', '5', '6'] }), contact);
  assert.deepEqual(result.customerSummary, ['1', '2', '3', '4', '5']);
});

test('Alex is removed when the model assigns the assistant identity to customer Hannah', () => {
  const result = extractLeadIntelligence({
    lead: 'Cold',
    customerName: 'Alex',
    customerSummary: ['The customer, Alex, ended the call.'],
  }, { company: 'Hannah Roofing', phone: '+1', contactName: 'Hannah' });
  assert.equal(result.customerName, 'Hannah');
  assert.deepEqual(result.customerSummary, ['Hannah ended the call.']);
});

test('Cold lead supplies Low interest fallback when Vapi interest is Unknown', () => {
  const result = extractLeadIntelligence({ lead: 'Cold', interest_level: 'Unknown', customer_summary: ['Customer declined the offer.'] }, { company: 'Fixture Roofing', phone: '+12125550125' });
  assert.equal(result.lead, 'Cold');
  assert.equal(result.interestLevel, 'Low');
});
