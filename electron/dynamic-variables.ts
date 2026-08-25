export type WiseDynamicVariableContact = { company: string; phone: string; contactName?: string; city?: string; state?: string; zipCode?: string; demoUrl?: string };

export function buildWiseDynamicVariables(contact: WiseDynamicVariableContact, agentName = 'Alex') {
  const required = { company: String(contact.company || '').trim(), phone: String(contact.phone || '').trim() };
  if (!required.company || !required.phone) throw new Error('Wise dynamic variables require company and phone');
  const optional = { contact_name: contact.contactName, city: contact.city, state: contact.state, zip: contact.zipCode, demo_url: contact.demoUrl };
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...required, ...optional, agent_name: agentName || 'Alex' })) {
    const normalized = String(value ?? '').trim();
    if (normalized) result[key] = normalized;
  }
  return result;
}
