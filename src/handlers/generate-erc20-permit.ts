import { PERMIT2_ADDRESS, PermitTransferFrom, SignatureTransfer } from "@uniswap/permit2-sdk";
import { ethers, keccak256, MaxInt256, parseUnits, toUtf8Bytes } from "ethers";
import { Context, Logger } from "../types/context";
import { Permit, TokenType } from "../types";
import { decryptKeys } from "../utils/keys";
import { getPayoutConfigByNetworkId } from "../utils/payoutConfigByNetworkId";

export interface Payload {
  evmNetworkId: number;
  evmPrivateEncrypted: string;
  walletAddress: string;
  issueId: number;
  logger: Logger;
  userId: number;
}

export async function generateErc20PermitSignature(payload: Payload, username: string, amount: number): Promise<Permit>;
export async function generateErc20PermitSignature(context: Context, username: string, amount: number): Promise<Permit>;
export async function generateErc20PermitSignature(contextOrPayload: Context | Payload, username: string, amount: number): Promise<Permit> {
  let _logger: Logger;
  const _username = username;
  let _walletAddress: string | null | undefined;
  let _issueId: number;
  let _evmNetworkId: number;
  let _evmPrivateEncrypted: string;
  let _userId: number;

  if ("issueId" in contextOrPayload) {
    _logger = contextOrPayload.logger as Logger;
    _walletAddress = contextOrPayload.walletAddress;
    _evmNetworkId = contextOrPayload.evmNetworkId;
    _evmPrivateEncrypted = contextOrPayload.evmPrivateEncrypted;
    _issueId = contextOrPayload.issueId;
    _userId = contextOrPayload.userId;
  } else {
    const config = contextOrPayload.config;
    _logger = contextOrPayload.logger;
    const { evmNetworkId, evmPrivateEncrypted } = config;
    const { data: userData } = await contextOrPayload.octokit.users.getByUsername({ username: _username });
    if (!userData) {
      throw new Error(`GitHub user was not found for id ${_username}`);
    }
    _userId = userData.id;
    const { wallet } = contextOrPayload.adapters.supabase;
    _walletAddress = await wallet.getWalletByUserId(_userId);
    _evmNetworkId = evmNetworkId;
    _evmPrivateEncrypted = evmPrivateEncrypted;
    if ("issue" in contextOrPayload.payload) {
      _issueId = contextOrPayload.payload.issue.id;
    } else if ("pull_request" in contextOrPayload.payload) {
      _issueId = contextOrPayload.payload.pull_request.id;
    } else {
      throw new Error("Issue Id is missing");
    }
  }

  if (!_username) {
    throw new Error("User was not found");
  }
  if (!_walletAddress) {
    const errorMessage = "ERC20 Permit generation error: Wallet not found";
    _logger.error(errorMessage);
    throw new Error(errorMessage);
  }

  const { rpc, token, decimals } = getPayoutConfigByNetworkId(_evmNetworkId);
  const { privateKey } = await decryptKeys(_evmPrivateEncrypted);
  if (!privateKey) {
    const errorMessage = "Private key is not defined";
    _logger.fatal(errorMessage);
    throw new Error(errorMessage);
  }

  let provider;
  let adminWallet;
  try {
    provider = new ethers.JsonRpcProvider(rpc);
  } catch (error) {
    const errorMessage = `Failed to instantiate provider: ${error}`;
    _logger.debug(errorMessage);
    throw new Error(errorMessage);
  }

  try {
    adminWallet = new ethers.Wallet(privateKey, provider);
  } catch (error) {
    const errorMessage = `Failed to instantiate wallet: ${error}`;
    _logger.debug(errorMessage);
    throw new Error(errorMessage);
  }

  const permitTransferFromData: PermitTransferFrom = {
    permitted: {
      token: token,
      amount: parseUnits(amount.toString(), decimals),
    },
    spender: _walletAddress,
    nonce: BigInt(keccak256(toUtf8Bytes(`${_userId}-${_issueId}`))),
    deadline: MaxInt256,
  };

  const { domain, types, values } = SignatureTransfer.getPermitData(permitTransferFromData, PERMIT2_ADDRESS, _evmNetworkId);

  const signature = await adminWallet
    .signTypedData(
      {
        name: domain.name,
        version: domain.version,
        chainId: domain.chainId ? domain.chainId.toString() : undefined,
        verifyingContract: domain.verifyingContract,
        salt: domain.salt?.toString(),
      },
      types,
      values
    )
    .catch((error) => {
      const errorMessage = `Failed to sign typed data ${error}`;
      _logger.error(errorMessage);
      throw new Error(errorMessage);
    });

  const erc20Permit: Permit = {
    tokenType: TokenType.ERC20,
    tokenAddress: permitTransferFromData.permitted.token,
    beneficiary: permitTransferFromData.spender,
    nonce: permitTransferFromData.nonce.toString(),
    deadline: permitTransferFromData.deadline.toString(),
    amount: permitTransferFromData.permitted.amount.toString(),
    owner: adminWallet.address,
    signature: signature,
    networkId: _evmNetworkId,
  };

  _logger.info("Generated ERC20 permit2 signature", erc20Permit);

  return erc20Permit;
}
