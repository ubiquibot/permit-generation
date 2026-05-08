import { expect, describe, it, beforeEach, jest } from "@jest/globals";
import { ethers } from "ethers";
import { executeErc20Transfer } from "../src/handlers/execute-erc20-transfer";
import { Context } from "../src/types/context";
import { TokenType } from "../src/types";

jest.mock("../src/utils/get-fastest-provider");
jest.mock("../src/utils/keys");

describe("executeErc20Transfer", () => {
  let context: Context;

  beforeEach(() => {
    context = {
      logger: {
        info: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        fatal: jest.fn(),
      },
      config: {
        evmNetworkId: 1,
        evmPrivateEncrypted: "encrypted",
        permitRequests: [],
        feePercentage: 10,
        feeAddress: "0xFeeAddress",
      },
      adapters: {
        supabase: {
          wallet: {
            getAddressByUsername: jest.fn(),
          },
        },
      },
    } as unknown as Context;
  });

  it("should execute transfer and take fee", async () => {
    const mockProvider = {
      getGasPrice: jest.fn<any>().mockResolvedValue(ethers.BigNumber.from("1000")),
      waitForTransaction: jest.fn<any>().mockResolvedValue({ blockNumber: 123 }),
    };

    const mockTx = {
      hash: "0xTxHash",
      nonce: 1,
      wait: jest.fn<any>().mockResolvedValue({ blockNumber: 123 }),
    };

    const mockContract = {
      estimateGas: {
        transfer: jest.fn<any>().mockResolvedValue(ethers.BigNumber.from("21000")),
      },
      transfer: jest.fn<any>().mockResolvedValue(mockTx),
      decimals: jest.fn<any>().mockResolvedValue(18),
    };

    (require("../src/utils/get-fastest-provider").getRpcProvider as jest.Mock<any>).mockResolvedValue(mockProvider);
    (require("../src/utils/keys").decrypt as jest.Mock<any>).mockResolvedValue("decrypted");
    (require("../src/utils/keys").parseDecryptedPrivateKey as jest.Mock<any>).mockReturnValue({ privateKey: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" });

    (context.adapters.supabase.wallet.getAddressByUsername as jest.Mock<any>).mockResolvedValue("0xBeneficiary");

    jest.spyOn(ethers, "Contract").mockImplementation(() => mockContract as any);
    jest.spyOn(ethers, "Wallet").mockImplementation(() => ({
        address: "0xAdmin",
        connect: jest.fn(),
    } as any));

    const result = await executeErc20Transfer(context, "user1", 100, "0xToken");

    expect(result.tokenType).toBe(TokenType.ERC20);
    expect(result.transactionHash).toBe("0xTxHash");
    expect(mockContract.transfer).toHaveBeenCalledTimes(2); // One for fee, one for main transfer
    expect(context.logger.info).toHaveBeenCalledWith(expect.stringContaining("Taking 10% fee"));
  });
});
