import { BigNumber, utils } from "ethers";
import { describe, expect, it } from "@jest/globals";
import { buildTransferPlan } from "../src/handlers/transfer-plan";
import { PermitReward, TokenType } from "../src/types";

const basePermit: PermitReward = {
  tokenType: TokenType.ERC20,
  tokenAddress: "0x0000000000000000000000000000000000000001",
  beneficiary: "0x0000000000000000000000000000000000000002",
  nonce: "1",
  deadline: "9999999999",
  amount: utils.parseUnits("100", 18).toString(),
  owner: "0x0000000000000000000000000000000000000003",
  signature: "0xsignature",
  networkId: 100,
};

describe("buildTransferPlan", () => {
  it("returns no transactions when automatic transfer is disabled", async () => {
    const plan = await buildTransferPlan([basePermit], {
      transferEnabled: false,
      feeBps: 100,
      feeRecipient: "ubq.eth",
      estimateGas: async () => BigNumber.from(21_000),
    });

    expect(plan).toEqual({ enabled: false, transactions: [] });
  });

  it("plans beneficiary and operator fee transfers with gas estimates", async () => {
    const plan = await buildTransferPlan([basePermit], {
      transferEnabled: true,
      feeBps: 250,
      feeRecipient: "ubq.eth",
      estimateGas: async ({ to, amount }: { to: string; amount: string }) =>
        to === "ubq.eth" ? BigNumber.from(30_000) : BigNumber.from(amount).div(10).add(21_000),
    });

    expect(plan).toMatchObject({ enabled: true });
    expect(plan.transactions).toHaveLength(2);
    expect(plan.transactions[0]).toMatchObject({
      kind: "beneficiary",
      to: basePermit.beneficiary,
      amount: utils.parseUnits("97.5", 18).toString(),
      estimatedGas: BigNumber.from(utils.parseUnits("97.5", 18)).div(10).add(21_000).toString(),
    });
    expect(plan.transactions[1]).toMatchObject({
      kind: "operator-fee",
      to: "ubq.eth",
      amount: utils.parseUnits("2.5", 18).toString(),
      estimatedGas: "30000",
    });
  });
});
