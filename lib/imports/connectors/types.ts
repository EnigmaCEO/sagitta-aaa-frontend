import type { ImportPreviewResult } from "../types";

export type ConnectorId = "csv_v1" | "json_v1" | "wallet_evm_v1";

export interface ImportConnector<TReq> {
  id: ConnectorId;
  version: string;
  display_name: string;
  preview(req: TReq): Promise<ImportPreviewResult>;
}
