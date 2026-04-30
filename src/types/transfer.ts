// Type definitions for transfer functionality
export interface TransferResult {
  success: boolean;
  beneficiary: string;
  amount: string;
  txHash?: string;
  error?: string;
}

export interface TransferSummary {
  totalTransfers: number;
  successfulTransfers: number;
  failedTransfers: number;
  results: TransferResult[];
}

// Re-export TransferSettings from plugin-input
export type { TransferSettings, PermitGenerationSettingsWithTransfer } from "./plugin-input";
