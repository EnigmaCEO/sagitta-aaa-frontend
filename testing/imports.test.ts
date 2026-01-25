import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCsvToRawPositions, csvConnector } from "../lib/imports/connectors/csv_v1";
import { walletConnector, isValidEvmAddress, mockBalances } from "../lib/imports/connectors/wallet_evm_v1";
import { jsonConnector, parseJsonToRawPositions } from "../lib/imports/connectors/json_v1";
import { inferRiskClass } from "../lib/imports/riskClassPriors";

test("csv header aliasing and value computation", () => {
  const csv = "Ticker,Name,Quantity,Price\nETH,Ethereum,2,2000\nUSDC,USD Coin,1000,1";
  const raw = parseCsvToRawPositions(csv);
  assert.equal(raw.length, 2);
  assert.equal(raw[0].symbol, "ETH");
  assert.equal(raw[0].value_usd, 4000);
  assert.equal(raw[1].symbol, "USDC");
  assert.equal(raw[1].value_usd, 1000);
});

test("csv preview weights from values", async () => {
  const csv = "symbol,value_usd\nAAA,100\nBBB,300";
  const preview = await csvConnector.preview({ csv_text: csv });
  assert.equal(preview.ok, true);
  const assets = preview.proposed_assets || [];
  assert.equal(assets.length, 2);
  assert.ok(Math.abs(assets[0].current_weight - 0.25) < 1e-6);
  assert.ok(Math.abs(assets[1].current_weight - 0.75) < 1e-6);
});

test("csv equal-weight fallback", async () => {
  const csv = "symbol,name\nAAA,Alpha\nBBB,Beta";
  const preview = await csvConnector.preview({ csv_text: csv });
  const assets = preview.proposed_assets || [];
  assert.equal(assets.length, 2);
  assert.ok(preview.warnings.some((w) => w.code === "EQUAL_WEIGHT_FALLBACK"));
  assert.ok(Math.abs(assets[0].current_weight - 0.5) < 1e-6);
});

test("risk class inference", () => {
  assert.equal(inferRiskClass("USDC", "USD Coin"), "stablecoin");
  assert.equal(inferRiskClass("UNI", "Uniswap DEX"), "defi_bluechip");
});

test("wallet address validation", () => {
  assert.equal(isValidEvmAddress("0x0000000000000000000000000000000000000000"), true);
  assert.equal(isValidEvmAddress("0x123"), false);
});

test("wallet mock output deterministic", () => {
  const a = mockBalances("ethereum", "0x0000000000000000000000000000000000000000");
  const b = mockBalances("ethereum", "0x0000000000000000000000000000000000000000");
  assert.deepEqual(a, b);
});

test("wallet preview returns assets", async () => {
  const preview = await walletConnector.preview({
    chain: "ethereum",
    address: "0x0000000000000000000000000000000000000000",
  });
  assert.equal(preview.ok, true);
  assert.ok((preview.proposed_assets || []).length > 0);
});

test("json parsing and preview", async () => {
  const json = JSON.stringify([
    { symbol: "AAA", value_usd: 100, role: "core" },
    { symbol: "BBB", quantity: 2, price_usd: 50 },
  ]);
  const raw = parseJsonToRawPositions(json);
  assert.equal(raw.length, 2);
  assert.equal(raw[1].value_usd, 100);

  const preview = await jsonConnector.preview({ json_text: json });
  assert.equal(preview.ok, true);
  const assets = preview.proposed_assets || [];
  assert.equal(assets.length, 2);
  assert.ok(Math.abs(assets[0].current_weight - 0.5) < 1e-6);
});

test("csv role column maps to roles", async () => {
  const csv = "symbol,role,value_usd\nBTC,core exposure,100\nUSDC,liquidity,100";
  const preview = await csvConnector.preview({ csv_text: csv });
  const assets = preview.proposed_assets || [];
  assert.equal(assets.length, 2);
  assert.equal(assets[0].role, "core");
  assert.equal(assets[1].role, "liquidity");
});

test("wallet preview assigns default roles", async () => {
  const preview = await walletConnector.preview({
    chain: "ethereum",
    address: "0x0000000000000000000000000000000000000000",
  });
  const assets = preview.proposed_assets || [];
  const eth = assets.find((a) => a.id === "ETH");
  const usdc = assets.find((a) => a.id === "USDC");
  assert.equal(eth?.role, "core");
  assert.equal(usdc?.role, "liquidity");
});
