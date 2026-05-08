import { MaxUint256, PermitTransferFrom, SignatureTransfer } from "@uniswap/permit2-sdk";
import { ethers, utils } from "ethers";
import { PERMIT2_ADDRESS, PermitReward, TokenType } from "../types";
import { Context, Logger } from "../types/context";
import { decrypt, parseDecryptedPrivateKey } from "../utils";
import { getRpcProvider } from "../utils/get-fastest-provider";

export interface Payload {
  evmNetworkId: number;
  evmPrivateEncrypted: string;
  walletAddress: string;
  issueNodeId: string;
  logger: Logger;
  userId: number;
}

export async function generateErc20PermitSignature(payload: Payload, username: string, amount: number, tokenAddress: string): Promise<PermitReward>;
export async function generateErc20PermitSignature(context: Context, username: string, amount: number, tokenAddress: string): Promise<PermitReward>;
/**
 * Generates an ERC20 permit signature for a payout.
 *
 * @param contextOrPayload - Either the full context or a simplified payload for legacy support.
 * @param username - The GitHub username of the recipient.
 * @param amount - The amount of tokens to permit.
 * @param tokenAddress - The contract address of the ERC20 token.
 * @returns A Promise that resolves to the PermitReward object containing the signature and permit data.
 * @throws Error if the user or wallet is not found, or if signing fails.
 */
export async function generateErc20PermitSignature(
  contextOrPayload: Context | Payload,
  username: string,
  amount: number,
  tokenAddress: string
): Promise<PermitReward> {
  let logger: Logger;
  const _username = username;
  let walletAddress: string | null | undefined;
  let issueNodeId: string;
  let evmNetworkId: number;
  let evmPrivateEncrypted: string;
  let userId: number;

  if ("issueNodeId" in contextOrPayload) {
    logger = contextOrPayload.logger as Logger;
    walletAddress = contextOrPayload.walletAddress;
    evmNetworkId = contextOrPayload.evmNetworkId;
    evmPrivateEncrypted = contextOrPayload.evmPrivateEncrypted;
    issueNodeId = contextOrPayload.issueNodeId;
    userId = contextOrPayload.userId;
  } else {
    const config = contextOrPayload.config;
    logger = contextOrPayload.logger;
    const { evmNetworkId: configEvmNetworkId, evmPrivateEncrypted: configEvmPrivateEncrypted } = config;
    const { data: userData } = await contextOrPayload.octokit.rest.users.getByUsername({ username: _username });
    if (!userData) {
      throw new Error(`GitHub user was not found for id ${_username}`);
    }
    userId = userData.id;
    const { wallet } = contextOrPayload.adapters.supabase;
    walletAddress = await wallet.getWalletByUserId(userId);
    evmNetworkId = configEvmNetworkId;
    evmPrivateEncrypted = configEvmPrivateEncrypted;
    if ("issue" in contextOrPayload.payload) {
      issueNodeId = contextOrPayload.payload.issue.node_id;
    } else if ("pull_request" in contextOrPayload.payload) {
      issueNodeId = contextOrPayload.payload.pull_request.node_id;
    } else {
      throw new Error("Issue Id is missing");
    }
  }

  if (!_username) {
    throw new Error("User was not found");
  }
  if (!walletAddress) {
    const errorMessage = "ERC20 Permit generation error: Wallet not found";
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }

  const provider = await getRpcProvider(evmNetworkId);
  if (!provider) {
    logger.error("Provider is not defined");
    throw new Error("Provider is not defined");
  }

  const privateKey = await getPrivateKey(evmPrivateEncrypted, logger);
  const adminWallet = await getAdminWallet(privateKey, provider, logger);
  const tokenDecimals = await getTokenDecimals(tokenAddress, provider, logger);

  const permitTransferFromData: PermitTransferFrom = {
    permitted: {
      token: tokenAddress,
      amount: utils.parseUnits(amount.toString(), tokenDecimals),
    },
    spender: walletAddress,
    nonce: BigInt(utils.keccak256(utils.toUtf8Bytes(`${userId}-${issueNodeId}`))),
    deadline: MaxUint256,
  };

  const { domain, types, values } = SignatureTransfer.getPermitData(permitTransferFromData, PERMIT2_ADDRESS, evmNetworkId);

  try {
    const signature = await adminWallet._signTypedData(domain, types, values);

    const erc20Permit: PermitReward = {
      tokenType: TokenType.ERC20,
      tokenAddress: permitTransferFromData.permitted.token,
      beneficiary: permitTransferFromData.spender,
      nonce: permitTransferFromData.nonce.toString(),
      deadline: permitTransferFromData.deadline.toString(),
      amount: permitTransferFromData.permitted.amount.toString(),
      owner: adminWallet.address,
      signature: signature,
      networkId: evmNetworkId,
    };

    logger.info("Generated ERC20 permit2 signature", erc20Permit);

    return erc20Permit;
  } catch (error) {
    logger.error(`Failed to sign typed data: ${error}`);
    throw error;
  }
}

/**
 * Decrypts and parses the private key for permit generation.
 *
 * @param evmPrivateEncrypted - The encrypted private key string.
 * @param logger - The logger instance.
 * @returns A Promise that resolves to the decrypted private key.
 * @throws Error if decryption fails or the key is not defined.
 */
async function getPrivateKey(evmPrivateEncrypted: string, logger: Logger) {
  try {
    const privateKeyDecrypted = await decrypt(evmPrivateEncrypted, String(process.env.X25519_PRIVATE_KEY));
    const privateKeyParsed = parseDecryptedPrivateKey(privateKeyDecrypted);
    const privateKey = privateKeyParsed.privateKey;
    if (!privateKey) throw new Error("Private key is not defined");
    return privateKey;
  } catch (error) {
    const errorMessage = `Failed to decrypt a private key: ${error}`;
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }
}

/**
 * Instantiates an admin wallet for signing.
 *
 * @param privateKey - The private key string.
 * @param provider - The ethers provider instance.
 * @param logger - The logger instance.
 * @returns A Promise that resolves to the Wallet instance.
 * @throws Error if the wallet cannot be instantiated.
 */
async function getAdminWallet(privateKey: string, provider: ethers.providers.Provider, logger: Logger) {
  try {
    return new ethers.Wallet(privateKey, provider);
  } catch (error) {
    const errorMessage = `Failed to instantiate wallet: ${error}`;
    logger.debug(errorMessage);
    throw new Error(errorMessage);
  }
}

/**
 * Retrieves the decimal count for an ERC20 token.
 *
 * @param tokenAddress - The token contract address.
 * @param provider - The ethers provider instance.
 * @param logger - The logger instance.
 * @returns A Promise that resolves to the decimal count.
 * @throws Error if the decimals cannot be fetched.
 */
async function getTokenDecimals(tokenAddress: string, provider: ethers.providers.Provider, logger: Logger) {
  try {
    const erc20Abi = ["function decimals() public view returns (uint8)"];
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);
    return await tokenContract.decimals();
  } catch (error) {
    const errorMessage = `Failed to get token decimals for token: ${tokenAddress}, ${error}`;
    logger.debug(errorMessage, { error });
    throw new Error(errorMessage);
  }
}
