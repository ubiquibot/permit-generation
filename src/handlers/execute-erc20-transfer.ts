import { ethers, utils } from "ethers";
import { PermitReward, TokenType } from "../types";
import { Context, Logger } from "../types/context";
import { decrypt, parseDecryptedPrivateKey } from "../utils";
import { getRpcProvider } from "../utils/get-fastest-provider";

export async function executeErc20Transfer(context: Context, username: string, amount: number, tokenAddress: string): Promise<PermitReward> {
  const { logger, config } = context;
  const { evmNetworkId, evmPrivateEncrypted } = config;

  const walletAddress = await context.adapters.supabase.wallet.getAddressByUsername(username);
  if (!walletAddress) {
    throw new Error(`ERC20 Transfer error: Wallet not found for user ${username}`);
  }

  const provider = await getRpcProvider(evmNetworkId);
  if (!provider) {
    throw new Error("Provider is not defined");
  }

  const privateKey = await getPrivateKey(evmPrivateEncrypted, logger);
  const adminWallet = new ethers.Wallet(privateKey, provider);
  const tokenDecimals = await getTokenDecimals(tokenAddress, provider, logger);

  const amountWei = utils.parseUnits(amount.toString(), tokenDecimals);
  let finalAmountWei = amountWei;

  const erc20Abi = [
    "function transfer(address to, uint256 value) public returns (bool)",
    "function decimals() public view returns (uint8)",
    "function symbol() public view returns (string)"
  ];
  const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, adminWallet);

  // Fee logic
  const feePercentage = config.feePercentage || 0;
  const feeAddress = config.feeAddress || "ubq.eth"; // ubq.eth as default

  if (feePercentage > 0) {
    const feeAmountWei = amountWei.mul(feePercentage).div(100);
    finalAmountWei = amountWei.sub(feeAmountWei);

    logger.info(`Taking ${feePercentage}% fee: ${utils.formatUnits(feeAmountWei, tokenDecimals)} tokens to ${feeAddress}`);
    try {
      const feeTx = await tokenContract.transfer(feeAddress, feeAmountWei);
      await feeTx.wait();
      logger.info(`Fee transaction confirmed: ${feeTx.hash}`);
    } catch (error) {
      logger.error(`Failed to transfer fee: ${error}`);
      // Continue with the main transfer even if fee fails?
      // Or throw? Requirement says "Implement fee-taking logic", usually better to fail if fee fails.
      throw new Error(`Fee transfer failed: ${error}`);
    }
  }

  logger.info(`Executing transfer of ${utils.formatUnits(finalAmountWei, tokenDecimals)} tokens to ${walletAddress}`);

  // Gas estimation
  const gasLimit = await tokenContract.estimateGas.transfer(walletAddress, finalAmountWei);
  const gasPrice = await provider.getGasPrice();

  const tx = await tokenContract.transfer(walletAddress, finalAmountWei, {
    gasLimit: gasLimit.mul(120).div(100), // 20% buffer
    gasPrice: gasPrice
  });

  logger.info(`Transaction sent: ${tx.hash}`);
  const receipt = await tx.wait();
  logger.info(`Transaction confirmed in block ${receipt.blockNumber}`);

  return {
    tokenType: TokenType.ERC20,
    tokenAddress: tokenAddress,
    beneficiary: walletAddress,
    nonce: tx.nonce.toString(),
    deadline: "0", // Not applicable for direct transfer
    amount: finalAmountWei.toString(),
    owner: adminWallet.address,
    signature: "0x", // No permit signature
    networkId: evmNetworkId,
    transactionHash: tx.hash,
  };
}

async function getPrivateKey(evmPrivateEncrypted: string, logger: Logger) {
  const privateKeyDecrypted = await decrypt(evmPrivateEncrypted, String(process.env.X25519_PRIVATE_KEY));
  const privateKeyParsed = parseDecryptedPrivateKey(privateKeyDecrypted);
  const privateKey = privateKeyParsed.privateKey;
  if (!privateKey) throw new Error("Private key is not defined");
  return privateKey;
}

async function getTokenDecimals(tokenAddress: string, provider: ethers.providers.Provider, logger: Logger) {
  try {
    const erc20Abi = ["function decimals() public view returns (uint8)"];
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);
    return await tokenContract.decimals();
  } catch (error) {
    logger.debug(`Failed to get token decimals for token: ${tokenAddress}, ${error}`);
    return 18; // Fallback
  }
}
