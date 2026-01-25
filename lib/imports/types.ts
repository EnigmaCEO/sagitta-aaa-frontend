export type ImportedRawPosition = {
  symbol: string;
  name?: string;
  quantity?: number;
  price_usd?: number;
  value_usd?: number;
  currency?: string;
  role?: string;
  meta?: Record<string, unknown>;
};

export type ImportPreviewResult = {
  ok: boolean;
  summary: string;
  warnings: Array<{ code: string; detail?: string }>;
  errors: string[];
  raw_positions?: ImportedRawPosition[];
  proposed_assets?: Array<{
    id: string;
    name: string;
    risk_class: string;
    role?: string;
    current_weight: number;
    expected_return: number;
    volatility: number;
    source_value_usd: number | null;
  }>;
};

export type ImportRunResult = {
  ok: boolean;
  warnings: Array<{ code: string; detail?: string }>;
  errors: string[];
  applied_count?: number;
};
