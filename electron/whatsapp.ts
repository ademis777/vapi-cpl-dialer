import { isValidNormalizedPhone, normalizePhone } from './phone-normalization.js';

export type WhatsAppTemplateValues = { company?: string; contact_name?: string; agent_name?: string; demo_url?: string; phone?: string; next_action?: string };
export const DEFAULT_WHATSAPP_TEMPLATE = 'Hi {{contact_name}}, this is {{agent_name}} from DMNT regarding {{company}}. {{next_action}} {{demo_url}}';

export function renderWhatsAppTemplate(template: string, values: WhatsAppTemplateValues) {
  return template.replace(/{{\s*(company|contact_name|agent_name|demo_url|phone|next_action)\s*}}/g, (_match, key: keyof WhatsAppTemplateValues) => String(values[key] || ''))
    .replace(/\s+/g, ' ').trim();
}

export function buildWhatsAppUrl(phone: unknown, template: string, values: WhatsAppTemplateValues) {
  const normalized = normalizePhone(phone);
  if (!isValidNormalizedPhone(normalized)) return '';
  const message = renderWhatsAppTemplate(template || DEFAULT_WHATSAPP_TEMPLATE, values);
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}
