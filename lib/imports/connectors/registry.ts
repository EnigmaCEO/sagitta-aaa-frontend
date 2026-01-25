import type { ImportConnector } from "./types";
import { csvConnector } from "./csv_v1";
import { jsonConnector } from "./json_v1";
import { walletConnector } from "./wallet_evm_v1";

const CONNECTORS: ImportConnector<unknown>[] = [csvConnector, jsonConnector, walletConnector];

export function listConnectors(): ImportConnector<unknown>[] {
  return [...CONNECTORS];
}

export function getConnector(id: string | null | undefined): ImportConnector<unknown> | null {
  const key = String(id || "").trim();
  return CONNECTORS.find((c) => c.id === key) ?? null;
}
