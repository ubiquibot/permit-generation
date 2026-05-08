import { ethers, providers } from "ethers";

/**
 * Provides an ethers JsonRpcProvider for a given network ID via a proxy.
 *
 * @param networkId - The EVM network ID.
 * @returns A Promise that resolves to the JsonRpcProvider instance.
 * @throws Error if the provider is unresponsive or the request fails.
 */
export async function getRpcProvider(networkId: number | string): Promise<providers.JsonRpcProvider> {
  try {
    const provider = new ethers.providers.JsonRpcProvider(`https://permit2-rpc-proxy.deno.dev/${networkId}`);
    // We make one call to make sure our provider is responding
    await provider.getBlockNumber();
    return provider;
  } catch (e) {
    throw new Error(`Failed to get provider for networkId: ${networkId}`);
  }
}
