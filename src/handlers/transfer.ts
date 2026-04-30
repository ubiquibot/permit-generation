import { ethers, BigNumber } from "ethers";
import { getRpcProvider } from "../utils/get-fastest-provider";
import { decrypt, parseDecryptedPrivateKey } from "../utils/keys";
import { Context, Logger } from "../types/context";
import { PermitReward } from "../types";
import { TransferResult, TransferSummary } from "../types/transfer";

/**
 * Gets and decrypts private key from encrypted config
 */
async function getPrivateKey(
  evmPrivateEncrypted: string,
  logger: Logger
): Promise<string> {
  try {
    // Decrypt if encrypted
    let decrypted = evmPrivateEncrypted;
    if (evmPrivateEncrypted.includes(":")) {
      decrypted = await decrypt(evmPrivateEncrypted, process.env.X25519_PRIVATE_KEY || "");
    }
    
    const parsed = parseDecryptedPrivateKey(decrypted);
    if (!parsed.privateKey) {
      throw new Error("Failed to parse private key");
    }
    return parsed.privateKey;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to get private key: ${message}`);
    throw error;
  }
}

const DEFAULT_OPERATOR_FEE_PERCENT = 5;
const DEFAULT_UBQ_ADDRESS = "0xef977127399639b6c5a2b3c1a3c07d7d67b17e3e"; // ubq.eth placeholder

/**
 * Estimates gas for a transfer transaction
 */
async function estimateGas(
  tokenAddress: string,
  from: string,
  to: string,
  amount: BigNumber,
  provider: ethers.providers.Provider
): Promise<BigNumber> {
  try {
    const erc20Abi = [
      "function transfer(address to, uint256 amount) public returns (bool)",
      "function decimals() public view returns (uint8)",
    ];

    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);
    const gasEstimate = await tokenContract.estimateGas.transfer(to, amount, { from });
    return gasEstimate.mul(120).div(100); // 20% buffer
  } catch {
    return BigNumber.from(100000); // fallback
  }
}

/**
 * Gets current gas price from the network
 */
async function getGasPrice(provider: ethers.providers.Provider): Promise<BigNumber> {
  try {
    const feeData = await provider.getFeeData();
    return feeData.gasPrice || BigNumber.from(20000000000); // 20 gwei fallback
  } catch {
    return BigNumber.from(20000000000);
  }
}

/**
 * Calculates the operator fee from the transfer amount
 */
function calculateOperatorFee(
  amount: BigNumber,
  feePercent: number
): { beneficiaryAmount: BigNumber; operatorFee: BigNumber } {
  if (feePercent <= 0 || feePercent >= 100) {
    return { beneficiaryAmount: amount, operatorFee: BigNumber.from(0) };
  }

  const operatorFee = amount.mul(feePercent).div(100);
  const beneficiaryAmount = amount.sub(operatorFee);

  return { beneficiaryAmount, operatorFee };
}

/**
 * Executes a single token transfer
 */
async function executeTransfer(
  tokenAddress: string,
  signer: ethers.Signer,
  signerAddress: string,
  to: string,
  amount: BigNumber,
  logger: Logger
): Promise<TransferResult> {
  try {
    const erc20Abi = [
      "function transfer(address to, uint256 amount) public returns (bool)",
      "function decimals() public view returns (uint8)",
      "function balanceOf(address account) public view returns (uint256)",
    ];

    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, signer);

    // Check balance
    const balance = await tokenContract.balanceOf(signerAddress);
    if (balance.lt(amount)) {
      return {
        success: false,
        beneficiary: to,
        amount: amount.toString(),
        error: `Insufficient balance. Have: ${balance.toString()}, Need: ${amount.toString()}`,
      };
    }

    // Execute transfer
    const tx = await tokenContract.transfer(to, amount);
    const receipt = await tx.wait();

    logger.info("Transfer successful", {
      from: signerAddress,
      to,
      amount: amount.toString(),
      blockNumber: receipt.blockNumber,
    });

    return {
      success: true,
      txHash: tx.hash,
      beneficiary: to,
      amount: amount.toString(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Transfer failed", { to, error: errorMessage });
    return {
      success: false,
      beneficiary: to,
      amount: amount.toString(),
      error: errorMessage,
    };
  }
}

/**
 * Processes automatic transfers for all permit beneficiaries
 * This is the main entry point for the automatic transfer feature
 */
export async function processAutomaticTransfers(
  context: Context,
  permits: PermitReward[]
): Promise<TransferSummary> {
  const logger = context.logger;
  const config = context.config as any;
  const transferEnabled = config.transfer ?? false;

  // Check if transfer is enabled
  if (!transferEnabled) {
    logger.info("Automatic transfer is disabled in settings");
    return {
      totalTransfers: 0,
      successfulTransfers: 0,
      failedTransfers: 0,
      results: [],
    };
  }

  logger.info(`Starting automatic transfer process for ${permits.length} permits`);

  const results: TransferResult[] = [];
  let successfulTransfers = 0;
  let failedTransfers = 0;

  const feePercent = config.operatorFeePercent ?? DEFAULT_OPERATOR_FEE_PERCENT;
  const ubqAddress = config.ubqAddress ?? DEFAULT_UBQ_ADDRESS;

  // Get RPC provider
  const provider = await getRpcProvider(config.evmNetworkId);
  if (!provider) {
    logger.error("Failed to get RPC provider for transfers");
    return {
      totalTransfers: permits.length,
      successfulTransfers: 0,
      failedTransfers: permits.length,
      results: permits.map((p) => ({
        success: false,
        beneficiary: p.beneficiary,
        amount: String(p.amount),
        error: "Failed to get RPC provider",
      })),
    };
  }

  // Get admin wallet for signing
  let wallet: ethers.Wallet;
  try {
    const privateKey = await getPrivateKey(config.evmPrivateEncrypted, logger);
    wallet = new ethers.Wallet(privateKey, provider);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to get admin wallet: ${errorMessage}`);
    return {
      totalTransfers: permits.length,
      successfulTransfers: 0,
      failedTransfers: permits.length,
      results: permits.map((p) => ({
        success: false,
        beneficiary: p.beneficiary,
        amount: String(p.amount),
        error: `Failed to get admin wallet: ${errorMessage}`,
      })),
    };
  }

  // Process each permit
  for (const permit of permits) {
    if (permit.tokenType !== "ERC20") {
      logger.info(`Skipping ERC721 permit for ${permit.beneficiary} - manual claim required`);
      continue;
    }

    const amount = BigNumber.from(permit.amount);

    // Calculate fees
    const { beneficiaryAmount, operatorFee } = calculateOperatorFee(amount, feePercent);

    // Transfer to beneficiary
    const beneficiaryResult = await executeTransfer(
      permit.tokenAddress,
      wallet,
      wallet.address,
      permit.beneficiary,
      beneficiaryAmount,
      logger
    );

    results.push(beneficiaryResult);

    if (beneficiaryResult.success) {
      successfulTransfers++;
    } else {
      failedTransfers++;
    }

    // Transfer operator fee if applicable
    if (operatorFee.gt(0) && ubqAddress) {
      const feeResult = await executeTransfer(
        permit.tokenAddress,
        wallet,
        wallet.address,
        ubqAddress,
        operatorFee,
        logger
      );

      if (!feeResult.success) {
        logger.error(
          "Operator fee transfer failed",
          { amount: operatorFee.toString(), to: ubqAddress }
        );
      }
    }
  }

  logger.info(
    `Transfer process complete: ${successfulTransfers} successful, ${failedTransfers} failed`
  );

  return {
    totalTransfers: permits.length,
    successfulTransfers,
    failedTransfers,
    results,
  };
}

/**
 * Estimates total gas cost for all transfers
 * Useful for previewing costs before executing
 */
export async function estimateTransferGas(
  context: Context,
  permits: PermitReward[]
): Promise<{ totalGasEstimate: string; maxCost: string }> {
  const config = context.config as any;
  const transferEnabled = config.transfer ?? false;

  if (!transferEnabled) {
    return { totalGasEstimate: "0", maxCost: "0" };
  }

  const provider = await getRpcProvider(config.evmNetworkId);
  if (!provider) {
    return { totalGasEstimate: "0", maxCost: "0" };
  }

  let totalGas = BigNumber.from(0);
  const gasPrice = await getGasPrice(provider);

  for (const permit of permits) {
    if (permit.tokenType !== "ERC20") continue;

    const amount = BigNumber.from(permit.amount);

    const gas = await estimateGas(
      permit.tokenAddress,
      "0x0000000000000000000000000000000000000000",
      permit.beneficiary,
      amount,
      provider
    );

    totalGas = totalGas.add(gas);
  }

  const totalGasEstimate = totalGas.toString();
  const maxCost = totalGas.mul(gasPrice).toString();

  return { totalGasEstimate, maxCost };
}