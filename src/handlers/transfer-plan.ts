import { BigNumber, BigNumberish } from "ethers";
import { PermitReward, TokenType } from "../types";

export type TransferTransactionKind = "beneficiary" | "operator-fee";

export interface TransferGasEstimateRequest {
  permit: PermitReward;
  kind: TransferTransactionKind;
  from: string;
  to: string;
  tokenAddress: string;
  amount: string;
  networkId: number;
}

export interface TransferPlanTransaction extends TransferGasEstimateRequest {
  estimatedGas: string;
}

export interface BuildTransferPlanOptions {
  transferEnabled?: boolean;
  feeBps?: number;
  feeRecipient?: string;
  estimateGas: (request: TransferGasEstimateRequest) => Promise<BigNumberish>;
}

export interface TransferPlan {
  enabled: boolean;
  transactions: TransferPlanTransaction[];
}

const BASIS_POINTS_DENOMINATOR = 10_000;

export async function buildTransferPlan(permits: PermitReward[], options: BuildTransferPlanOptions): Promise<TransferPlan> {
  if (!options.transferEnabled) {
    return { enabled: false, transactions: [] };
  }

  const transactions: TransferPlanTransaction[] = [];

  for (const permit of permits) {
    if (permit.tokenType !== TokenType.ERC20) {
      continue;
    }

    const feeBps = Math.max(0, options.feeBps ?? 0);
    const totalAmount = BigNumber.from(permit.amount);
    const feeAmount = options.feeRecipient ? totalAmount.mul(feeBps).div(BASIS_POINTS_DENOMINATOR) : BigNumber.from(0);
    const beneficiaryAmount = totalAmount.sub(feeAmount);

    if (beneficiaryAmount.gt(0)) {
      transactions.push(await estimateTransferGas(buildGasEstimateRequest(permit, "beneficiary", permit.beneficiary, beneficiaryAmount), options));
    }

    if (feeAmount.gt(0) && options.feeRecipient) {
      transactions.push(await estimateTransferGas(buildGasEstimateRequest(permit, "operator-fee", options.feeRecipient, feeAmount), options));
    }
  }

  return { enabled: true, transactions };
}

function buildGasEstimateRequest(permit: PermitReward, kind: TransferTransactionKind, to: string, amount: BigNumber): TransferGasEstimateRequest {
  return {
    permit,
    kind,
    from: permit.owner,
    to,
    tokenAddress: permit.tokenAddress,
    amount: amount.toString(),
    networkId: permit.networkId,
  };
}

async function estimateTransferGas(request: TransferGasEstimateRequest, options: BuildTransferPlanOptions): Promise<TransferPlanTransaction> {
  const estimatedGas = await options.estimateGas(request);
  return {
    ...request,
    estimatedGas: BigNumber.from(estimatedGas).toString(),
  };
}
