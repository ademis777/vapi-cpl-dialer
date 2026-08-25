export type RuntimeCallEvent = { at?: string; event?: string; details?: Record<string, unknown> };

const USER_EVENT_LABELS: Record<string, string> = {
  call_started: 'Call started',
  call_ringing: 'Ringing',
  call_connected: 'Connected',
  ivr_detected: 'IVR detected',
  ivr_option_selected: 'IVR option selected',
  ivr_dtmf_requested: 'IVR navigation requested',
  ivr_dtmf_sent: 'DTMF sent',
  ivr_dtmf_error: 'IVR navigation failed',
  voicemail_detected: 'Voicemail detected',
  call_ended: 'Call ended',
  call_completed: 'Call completed',
  call_failed: 'Failed',
  call_stopped: 'Stopped',
};

export function userVisibleCallEvents(entries: RuntimeCallEvent[], callId: string, limit = 20) {
  const seen = new Set<string>();
  const visible: RuntimeCallEvent[] = [];
  for (const entry of entries) {
    const event = String(entry.event || '');
    if (entry.details?.callId !== callId || !USER_EVENT_LABELS[event]) continue;
    const digits = String(entry.details?.digits || '');
    const key = `${event}|${digits}`;
    if (seen.has(key)) continue;
    seen.add(key);
    visible.push({ ...entry, event: USER_EVENT_LABELS[event] });
  }
  return visible.slice(-limit);
}
