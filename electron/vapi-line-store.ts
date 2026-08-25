export type VapiLine = {
  id: string;
  name: string;
  enabled: boolean;
  vapiApiKey: string;
  assistantId: string;
  phoneNumberId: string;
};

export const DEFAULT_VAPI_LINES: VapiLine[] = [1, 2, 3, 4].map((number) => ({
  id: `line-${number}`,
  name: `Line ${number}`,
  enabled: false,
  vapiApiKey: '',
  assistantId: '',
  phoneNumberId: '',
}));

export class VapiLineStore {
  private lines: VapiLine[];

  constructor(lines: VapiLine[] = DEFAULT_VAPI_LINES) {
    this.lines = lines.map((line) => ({ ...line }));
  }

  list(): VapiLine[] {
    return this.lines.map((line) => ({ ...line }));
  }

  get(id?: string): VapiLine | undefined {
    const line = this.lines.find((item) => item.id === id && item.enabled);
    return line ? { ...line } : undefined;
  }

  set(lines: VapiLine[]) {
    this.lines = lines.map((line) => ({ ...line }));
  }
}
