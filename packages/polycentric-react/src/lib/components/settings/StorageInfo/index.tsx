import { useState } from 'react';
import { ProcessHandleManagerHookReturn } from '../../../hooks/processHandleManagerHooks';

interface StorageInfoProps {
    processHandle: ProcessHandleManagerHookReturn;
}

export const StorageInfo = ({ processHandle }: StorageInfoProps) => {
    const [storageSize, setStorageSize] = useState<number | null>(null);

    const checkStorageSize = async () => {
        const store = processHandle.processHandle.store();
        const estimate = await store.estimateStorage();
        setStorageSize(estimate.bytesUsed || 0);
    };

    return (
        <div className="flex flex-col space-y-2">
            <button
                onClick={checkStorageSize}
                className="bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg w-fit"
            >
                Check Storage Size
            </button>
            {storageSize !== null && (
                <div>
                    Current storage size:{' '}
                    {(storageSize / 1024 / 1024).toFixed(2)} MB
                </div>
            )}
        </div>
    );
};
