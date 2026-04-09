import { PermitReward, TokenType } from "../types";
import { RewardPermit } from "./permit-type";

/**
 * Returns a base64 encoded string containing all the permit data
 */
export function encodePermits(permits: PermitReward[]) {
  const permitsDto = permits
    .map((permit) => {
      if (permit.tokenType === TokenType.ERC20) {
        return {
          type: "erc20-permit",
          permit: {
            permitted: {
              token: permit.tokenAddress,
              amount: permit.amount,
            },
            nonce: permit.nonce,
            deadline: permit.deadline,
          },
          transferDetails: {
            to: permit.beneficiary,
            requestedAmount: permit.amount,
          },
          owner: permit.owner,
          signature: permit.signature,
          networkId: permit.networkId,
        };
      } else {
        if (permit.erc721Request) {
          return {
            type: "erc721-permit",
            permit: {
              permitted: {
                token: permit.tokenAddress,
                amount: permit.amount,
              },
              nonce: permit.nonce,
              deadline: permit.deadline,
            },
            transferDetails: {
              to: permit.beneficiary,
              requestedAmount: permit.amount,
            },
            owner: permit.owner,
            signature: permit.signature,
            networkId: permit.networkId,
            nftMetadata: permit.erc721Request.metadata,
            request: {
              beneficiary: permit.beneficiary,
              deadline: permit.deadline,
              keys: permit.erc721Request?.keys,
              nonce: permit.nonce,
              values: permit.erc721Request?.values,
            },
          };
        } else {
          return null;
        }
      }
    })
    .filter((o) => o) as RewardPermit[];
  return btoa(JSON.stringify(permitsDto));
}

export function decodePermits(base64: string) {
  const decoded = atob(base64);
  const objs: Array<RewardPermit> = JSON.parse(decoded);
  const result: PermitReward[] = [];
  for (const obj of objs) {
    const tokenType = obj.type === "erc20-permit" ? TokenType.ERC20 : TokenType.ERC721;
    if (tokenType === TokenType.ERC721) {
      result.push({
        amount: obj.permit.permitted.amount as "0" | "1",
        beneficiary: obj.transferDetails.to,
        deadline: obj.permit.deadline,
        networkId: obj.networkId,
        nonce: obj.permit.nonce,
        owner: obj.owner,
        signature: obj.signature,
        tokenAddress: obj.permit.permitted.token,
        tokenType,
        ...(obj.type === "erc721-permit" &&
          obj.nftMetadata && {
            erc721Request: {
              metadata: obj.nftMetadata,
              keys: obj.request?.keys ?? [],
              values: obj.request?.values ?? [],
            },
          }),
      });
    } else {
      result.push({
        amount: obj.permit.permitted.amount,
        beneficiary: obj.transferDetails.to,
        deadline: obj.permit.deadline,
        networkId: obj.networkId,
        nonce: obj.permit.nonce,
        owner: obj.owner,
        signature: obj.signature,
        tokenAddress: obj.permit.permitted.token,
        tokenType,
      });
    }
  }
  return result;
}
