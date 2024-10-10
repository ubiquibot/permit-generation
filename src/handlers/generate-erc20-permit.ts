import { PERMIT2_ADDRESS, PermitTransferFrom, SignatureTransfer, MaxUint256 } from "@uniswap/permit2-sdk";
import { ethers, utils } from "ethers";
import { Context, Logger } from "../types/context";
import { PermitReward, TokenType } from "../types";
import { decrypt, parseDecryptedPrivateKey } from "../utils";
import { getFastestProvider } from "../utils/get-fastest-provider";

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
    const { data: userData } = await contextOrPayload.octokit.users.getByUsername({ username: _username });
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
    } else if (contextOrPayload.config.runId) {
      issueNodeId = contextOrPayload.config.runId.toString();
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

  const provider = await getFastestProvider(evmNetworkId);
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

  const domainData = {
    name: domain.name,
    version: domain.version || "1", //  default to 1 if it's undefined
    chainId: domain.chainId,
    verifyingContract: domain.verifyingContract,
  };

  try {
    const signature = await adminWallet._signTypedData(domainData, types, values);

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

async function getAdminWallet(privateKey: string, provider: ethers.providers.Provider, logger: Logger) {
  try {
    return new ethers.Wallet(privateKey, provider);
  } catch (error) {
    const errorMessage = `Failed to instantiate wallet: ${error}`;
    logger.debug(errorMessage);
    throw new Error(errorMessage);
  }
}

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
