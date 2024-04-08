import { MaxUint256 } from "@uniswap/permit2-sdk";
import { ethers, keccak256, toUtf8Bytes } from "ethers";
import { Context, Logger } from "../types/context";
import { Permit, TokenType } from "../types";
import { isIssueEvent } from "../types/typeguards";
import { getPayoutConfigByNetworkId } from "../utils/payoutConfigByNetworkId";

interface Erc721PermitSignatureData {
  beneficiary: string;
  deadline: bigint;
  keys: string[];
  nonce: bigint;
  values: string[];
}

const SIGNING_DOMAIN_NAME = "NftReward-Domain";
const SIGNING_DOMAIN_VERSION = "1";

const types = {
  MintRequest: [
    { name: "beneficiary", type: "address" },
    { name: "deadline", type: "uint256" },
    { name: "keys", type: "bytes32[]" },
    { name: "nonce", type: "uint256" },
    { name: "values", type: "string[]" },
  ],
};

export interface PermitPayload {
  evmNetworkId: number;
  nftMinterPrivateKey: string;
  nftContractAddress: string;
  walletAddress: string;
  logger: Logger;
  issueId: string;
  organizationName: string;
  repositoryName: string;
  userName: string;
}

export async function generateErc721PermitSignature(userId: number, contributionType: string, permitPayload: PermitPayload): Promise<Permit>;
export async function generateErc721PermitSignature(userId: number, contributionType: string, context: Context): Promise<Permit>;
export async function generateErc721PermitSignature(
  userId: number,
  contributionType: string,
  contextOrPermitPayload: Context | PermitPayload
): Promise<Permit> {
  let _logger: Logger;
  let _nftContractAddress: string;
  let _evmNetworkId: number;
  let _nftMinterPrivateKey: string;
  let _userId: number;
  let _walletAddress: string;
  let _issueId: string;
  let _organizationName: string;
  let _repositoryName: string;
  let _username: string;

  if ("evmNetworkId" in contextOrPermitPayload) {
    _logger = contextOrPermitPayload.logger;
    _nftContractAddress = contextOrPermitPayload.nftContractAddress;
    _nftMinterPrivateKey = contextOrPermitPayload.nftMinterPrivateKey;
    _evmNetworkId = contextOrPermitPayload.evmNetworkId;
    _walletAddress = contextOrPermitPayload.walletAddress;
    _userId = userId;
    _issueId = contextOrPermitPayload.issueId;
    _organizationName = contextOrPermitPayload.organizationName;
    _repositoryName = contextOrPermitPayload.repositoryName;
    _username = contextOrPermitPayload.userName;
  } else {
    const { NFT_MINTER_PRIVATE_KEY, NFT_CONTRACT_ADDRESS } = contextOrPermitPayload.env;
    const { evmNetworkId } = contextOrPermitPayload.config;
    const adapters = contextOrPermitPayload.adapters;
    _logger = contextOrPermitPayload.logger;
    _nftContractAddress = NFT_CONTRACT_ADDRESS;
    _evmNetworkId = evmNetworkId;
    _nftMinterPrivateKey = NFT_MINTER_PRIVATE_KEY;
    _userId = userId;
    const walletAddress = await adapters.supabase.wallet.getWalletByUserId(_userId);
    if (!walletAddress) {
      _logger.error("No wallet found for user");
      throw new Error("No wallet found for user");
    }
    _walletAddress = walletAddress;
    if (isIssueEvent(contextOrPermitPayload)) {
      _issueId = contextOrPermitPayload.payload.issue.id.toString();
    } else {
      throw new Error("Issue Id is missing.");
    }
    _organizationName = contextOrPermitPayload.payload.repository.owner.login;
    _repositoryName = contextOrPermitPayload.payload.repository.name;
    const { data: userData } = await contextOrPermitPayload.octokit.request("GET /user/:id", { id: _userId });
    if (!userData) {
      throw new Error(`GitHub user was not found for id ${_userId}`);
    }
    _username = userData.login;
  }

  const { rpc } = getPayoutConfigByNetworkId(_evmNetworkId);

  if (!rpc) {
    _logger.error("RPC is not defined");
    throw new Error("RPC is not defined");
  }

  if (!_nftContractAddress) {
    const errorMessage = "NFT contract address is not defined";
    _logger.error(errorMessage);
    throw new Error(errorMessage);
  }

  let provider;
  let adminWallet;
  try {
    provider = new ethers.JsonRpcProvider(rpc);
  } catch (error) {
    _logger.error("Failed to instantiate provider", error);
    throw new Error("Failed to instantiate provider");
  }

  try {
    adminWallet = new ethers.Wallet(_nftMinterPrivateKey, provider);
  } catch (error) {
    _logger.error("Failed to instantiate wallet", error);
    throw new Error("Failed to instantiate wallet");
  }

  const erc721Metadata = {
    GITHUB_ORGANIZATION_NAME: _organizationName,
    GITHUB_REPOSITORY_NAME: _repositoryName,
    GITHUB_ISSUE_ID: _issueId,
    GITHUB_USERNAME: _username,
    GITHUB_CONTRIBUTION_TYPE: contributionType,
  };

  const metadata = Object.entries(erc721Metadata);
  const erc721SignatureData: Erc721PermitSignatureData = {
    beneficiary: _walletAddress,
    deadline: MaxUint256.toBigInt(),
    keys: metadata.map(([key]) => keccak256(toUtf8Bytes(key))),
    nonce: BigInt(keccak256(toUtf8Bytes(`${_userId}-${_issueId}`))),
    values: metadata.map(([, value]) => value),
  };

  const domain = {
    name: SIGNING_DOMAIN_NAME,
    version: SIGNING_DOMAIN_VERSION,
    verifyingContract: _nftContractAddress,
    chainId: _evmNetworkId,
  };

  const signature = await adminWallet.signTypedData(domain, types, erc721SignatureData).catch((error: unknown) => {
    _logger.error("Failed to sign typed data", error);
    throw new Error("Failed to sign typed data");
  });

  const erc721Permit: Permit = {
    tokenType: TokenType.ERC721,
    tokenAddress: _nftContractAddress,
    beneficiary: _walletAddress,
    amount: "1",
    nonce: erc721SignatureData.nonce.toString(),
    deadline: erc721SignatureData.deadline.toString(),
    signature: signature,
    owner: adminWallet.address,
    networkId: _evmNetworkId,
    erc721Request: {
      keys: erc721SignatureData.keys.map((key) => key.toString()),
      values: erc721SignatureData.values,
      metadata: erc721Metadata,
    },
  };

  console.info("Generated ERC721 permit signature", { erc721Permit });

  return erc721Permit;
}
