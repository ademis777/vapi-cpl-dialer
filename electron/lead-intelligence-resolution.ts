import {
  extractFinalTranscript,
  extractLeadIntelligence,
  findInvalidStructuredOutputPath,
  findStructuredOutput,
  type LeadIntelligence,
} from './lead-intelligence.js';

export type LeadIntelligenceSource = 'vapi_structured_output' | 'transcript_fallback_analysis' | 'empty_fallback';

type ContactIdentity = { company: string; phone: string; contactName?: string };

type ResolutionDependencies = {
  analyzeTranscript: (transcript: string, contact: ContactIdentity) => Promise<unknown>;
  log: (event: string, details: Record<string, unknown>) => void;
};

export function extractLegacyCallAnalysis(call: unknown) {
  const source = call && typeof call === 'object' ? call as Record<string, any> : {};
  const analysis = source.analysis && typeof source.analysis === 'object' ? source.analysis : {};
  return {
    summary: String(analysis.summary || source.summary || '').trim().replace(/^there is no transcript provided to summarize\.?$/i, ''),
    lead: analysis.structuredData?.lead ?? analysis.successEvaluation ?? source.lead ?? '',
  };
}

export async function resolveLeadIntelligence(
  call: unknown,
  contact: ContactIdentity,
  dependencies: ResolutionDependencies,
): Promise<{ intelligence: LeadIntelligence; source: LeadIntelligenceSource; structuredPath?: string }> {
  const structured = findStructuredOutput(call);
  if (structured) {
    try {
      const intelligence = extractLeadIntelligence(structured.value, contact);
      dependencies.log('lead_intelligence_source', { source: 'vapi_structured_output', path: structured.path });
      return { intelligence, source: 'vapi_structured_output', structuredPath: structured.path };
    } catch (error) {
      dependencies.log('lead_intelligence_structured_output_error', { path: structured.path, error: String(error) });
    }
  } else {
    const invalidPath = findInvalidStructuredOutputPath(call);
    if (invalidPath) dependencies.log('lead_intelligence_structured_output_error', { path: invalidPath, error: 'Structured output is not valid JSON object' });
  }

  const transcript = extractFinalTranscript(call);
  if (transcript.trim()) {
    try {
      const analyzed = await dependencies.analyzeTranscript(transcript, contact);
      const intelligence = extractLeadIntelligence(analyzed, contact);
      dependencies.log('lead_intelligence_source', { source: 'transcript_fallback_analysis' });
      return { intelligence, source: 'transcript_fallback_analysis' };
    } catch (error) {
      dependencies.log('transcript_fallback_analysis_error', { error: String(error) });
    }
  }

  const intelligence = extractLeadIntelligence({ lead: 'Unknown' }, contact);
  dependencies.log('lead_intelligence_source', { source: 'empty_fallback' });
  return { intelligence, source: 'empty_fallback' };
}

export function analysisSourceLabel(source: LeadIntelligenceSource) {
  if (source === 'vapi_structured_output') return 'Vapi';
  if (source === 'transcript_fallback_analysis') return 'Transcript fallback';
  return 'Empty fallback';
}
