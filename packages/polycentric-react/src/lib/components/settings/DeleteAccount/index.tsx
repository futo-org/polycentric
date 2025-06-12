import React from 'react';
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks';

export const DeleteAccount: React.FC = () => {
  const { processHandle, metaStore, clearProcessHandle, activeStore } =
    useProcessHandleManager();

  const handleDeleteAccount = async () => {
    if (!processHandle || !metaStore || !clearProcessHandle || !activeStore) {
      console.error(
        'Account data is not fully loaded. Please try again shortly.',
      );
      return;
    }

    const isConfirmed = window.confirm(
      'Are you absolutely sure? This action cannot be undone. This will permanently delete your account and remove your data from all connected servers and your local device.',
    );

    if (!isConfirmed) {
      return;
    }

    const system = processHandle.system();
    const storeVersion = activeStore.version;

    try {
      await processHandle.deleteAccount();
      await processHandle.store().wipeAllData();
      await metaStore.deleteStore(system, storeVersion);
      clearProcessHandle();
    } catch (error) {
      console.error(
        `Failed to delete account: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-col space-y-2">
        <h2 className="text-lg font-semibold">Delete Account</h2>
        <p className="text-sm text-muted-foreground">
          Permanently delete your account and all associated data. This action
          is irreversible. All your posts and interactions will be deleted from
          the servers you are connected to. Your local data will also be wiped.
        </p>
        {/* The AlertDialog component is replaced by a simple button and window.confirm */}
        <button
          onClick={handleDeleteAccount}
          className="mt-2 bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
          disabled={!processHandle}
        >
          Delete Account
        </button>
      </div>
    </div>
  );
};
