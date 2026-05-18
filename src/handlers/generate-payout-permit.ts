import { PermitReward } from "../types";
import { Context } from "../types/context";
import { generateErc20PermitSignature } from "./generate-erc20-permit";
import { generateErc721PermitSignature } from "./generate-erc721-permit";
import { PermitRequest } from "../types/plugin-input";
import { executeAutomaticTransfer } from "./automatic-transfer";

/**
 * Generates a payout permit based on the provided context.
 * @param context - The context object containing the configuration and payload.
 * @param permitRequests
 * @returns A Promise that resolves to the generated permit transaction data or an error message.
 */
export async function generatePayoutPermit(context: Context, permitRequests: PermitRequest[]): Promise<PermitReward[]> {
  const permits: PermitReward[] = [];
  const transferEnabled = context.config.transfer ?? false;
  const operatorFeePercent = context.config.operatorFeePercent ?? 10;

  for (const permitRequest of permitRequests) {
    const { type, amount, username, contributionType, tokenAddress } = permitRequest;

    let permit: PermitReward;
    switch (type) {
      case "ERC20":
        permit = await generateErc20PermitSignature(context, username, amount, tokenAddress);
        break;
      case "ERC721":
        permit = await generateErc721PermitSignature(context, username, contributionType);
        break;
      default:
        context.logger.error(`Invalid permit type: ${type}`);
        continue;
    }

    // Automatic transfer after permit generation
    if (transferEnabled && type === "ERC20") {
      const { getRpcProvider } = await import("../utils/get-fastest-provider");
      const { decrypt, parseDecryptedPrivateKey } = await import("../utils");
      const { ethers } = await import("ethers");

      const provider = await getRpcProvider(context.config.evmNetworkId);
      const privateKeyDecrypted = await decrypt(context.config.evmPrivateEncrypted, String(process.env.X25519_PRIVATE_KEY));
      const privateKeyParsed = parseDecryptedPrivateKey(privateKeyDecrypted);
      const privateKey = privateKeyParsed.privateKey;
      if (!privateKey) {
        context.logger.error("Private key is not defined");
        continue;
      }
      const wallet = new ethers.Wallet(privateKey, provider);

      const amountBigInt = BigInt(ethers.BigNumber.from(permit.amount).toString());
      const transferResult = await executeAutomaticTransfer(
        provider,
        wallet,
        tokenAddress,
        permit.beneficiary,
        amountBigInt,
        { enabled: true, operatorFeePercent },
        context.logger
      );

      if (transferResult.success) {
        context.logger.info(`Automatic transfer completed for ${username}: ${transferResult.txHash}`);
      } else {
        context.logger.warn(`Automatic transfer failed for ${username}: ${transferResult.error}`);
      }
    }

    permits.push(permit);
  }

  return permits;
}
