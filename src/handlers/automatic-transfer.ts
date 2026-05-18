import { ethers } from "ethers";
import { Logger } from "../types/context";

const UBQ_ETH = "0xobq.eth"; // ENS resolution for ubq.eth
const DEFAULT_FEE_PERCENT = 10; // 10% fee to operator

export interface TransferConfig {
  enabled: boolean;
  operatorFeePercent: number;
}

export async function estimateGasForTransfer(
  provider: ethers.providers.Provider,
  tokenAddress: string,
  from: string,
  to: string,
  amount: bigint
): Promise<bigint> {
  const tokenContract = new ethers.Contract(
    tokenAddress,
    [
      "function transfer(address to, uint256 amount) returns (bool)",
      "function balanceOf(address owner) view returns (uint256)",
    ],
    provider
  );

  try {
    // Estimate gas for transfer
    const gasEstimate = await tokenContract.estimateGas.transfer(to, amount, { from });
    return gasEstimate.toBigInt();
  } catch {
    // Fallback to rough estimate if estimation fails
    return BigInt(65000); // standard gas for ERC20 transfer
  }
}

export async function executeAutomaticTransfer(
  provider: ethers.providers.Provider,
  wallet: ethers.Wallet,
  tokenAddress: string,
  beneficiary: string,
  amount: bigint,
  config: TransferConfig,
  logger: Logger
): Promise<{ success: boolean; txHash?: string; feeCollected?: bigint; error?: string }> {
  if (!config.enabled) {
    return { success: false, error: "Transfer not enabled" };
  }

  const feePercent = config.operatorFeePercent ?? DEFAULT_FEE_PERCENT;
  const fee = (amount * BigInt(feePercent)) / BigInt(100);
  const amountAfterFee = amount - fee;

  try {
    // Estimate gas
    const gasEstimate = await estimateGasForTransfer(
      provider,
      tokenAddress,
      wallet.address,
      beneficiary,
      amountAfterFee
    );

    // Get gas price
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? ethers.BigNumber.from(0);
    const gasCost = ethers.BigNumber.from(gasEstimate).mul(gasPrice);

    // Check balance
    const balance = await provider.getBalance(wallet.address);
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ["function balanceOf(address owner) view returns (uint256)"],
      provider
    );
    const tokenBalance = await tokenContract.balanceOf(wallet.address);

    if (tokenBalance.lt(ethers.BigNumber.from(amountAfterFee))) {
      return { success: false, error: `Insufficient token balance: ${tokenBalance.toString()} < ${amountAfterFee.toString()}` };
    }

    if (balance.lt(gasCost)) {
      return { success: false, error: `Insufficient ETH for gas: ${balance.toString()} < ${gasCost.toString()}` };
    }

    // Execute transfer to beneficiary
    const tokenWithSigner = new ethers.Contract(
      tokenAddress,
      ["function transfer(address to, uint256 amount) returns (bool)"],
      wallet
    );
    const tx = await tokenWithSigner.transfer(beneficiary, ethers.BigNumber.from(amountAfterFee));
    const receipt = await tx.wait();

    logger.info(`Transfer successful: ${receipt.transactionHash}, amount: ${amountAfterFee.toString()}, fee: ${fee.toString()}`);

    // Transfer operator fee to ubq.eth if fee > 0
    let feeTxHash: string | undefined;
    if (fee > BigInt(0)) {
      try {
        const feeTokenWithSigner = new ethers.Contract(
          tokenAddress,
          ["function transfer(address to, uint256 amount) returns (bool)"],
          wallet
        );
        const feeTx = await feeTokenWithSigner.transfer(UBQ_ETH, ethers.BigNumber.from(fee));
        const feeReceipt = await feeTx.wait();
        feeTxHash = feeReceipt.transactionHash;
        logger.info(`Operator fee transferred: ${feeReceipt.transactionHash}, amount: ${fee.toString()}`);
      } catch (feeError) {
        logger.warn(`Failed to transfer operator fee: ${feeError}`);
        // Don't fail the whole transfer if fee transfer fails
      }
    }

    return { success: true, txHash: receipt.transactionHash, feeCollected: fee };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Automatic transfer failed: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
}

export async function getDynamicGasEstimate(
  provider: ethers.providers.Provider,
  _networkId: number
): Promise<{ gasPrice: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }> {
  const feeData = await provider.getFeeData();

  return {
    gasPrice: (feeData.gasPrice ?? ethers.BigNumber.from(0)).toBigInt(),
    maxFeePerGas: feeData.maxFeePerGas?.toBigInt(),
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toBigInt(),
  };
}
