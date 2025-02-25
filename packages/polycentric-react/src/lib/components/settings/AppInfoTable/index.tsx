import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import { PersistenceDriver, Version } from '@polycentric/polycentric-core';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { usePersistenceDriver } from '../../../hooks/persistenceDriverHooks';

const AppInfoTableRow = ({
  field,
  value,
}: {
  field: string;
  value?: ReactNode;
}) => {
  return (
    <tr>
      <th
        scope="row"
        className="px-6 py-3 text-left text-sm font-normal text-gray-800 whitespace-nowrap"
      >
        {field}
      </th>
      <td className="px-6 py-3 text-sm text-gray-500 whitespace-nowrap">
        {value ?? 'loading...'}
      </td>
    </tr>
  );
};

function byteAmountToString(bytes: number) {
  // b, kb, mb, gb
  const units = ['B', 'KB', 'MB', 'GB'];
  for (const unit of units) {
    if (bytes < 1024) {
      return `${bytes.toFixed(2)} ${unit}`;
    }
    bytes /= 1024;
  }
  return `${bytes.toFixed(2)} TB`;
}

export const AppInfoTable = () => {
  const persistenceDriver = usePersistenceDriver();

  const [storageEstimate, setStorageEstimate] =
    useState<PersistenceDriver.StorageEstimate>();

  const [persisted, setPersisted] = useState<boolean | undefined>();

  useEffect(() => {
    persistenceDriver.estimateStorage().then((storageEstimate) => {
      setStorageEstimate(storageEstimate);
    });

    persistenceDriver.persisted().then((persisted) => {
      setPersisted(persisted);
    });
  }, [persistenceDriver]);

  const { implementationName } = useMemo(() => {
    return {
      implementationName: persistenceDriver.getImplementationName(),
    };
  }, [persistenceDriver]);

  const { bytesAvailable, bytesUsed } = useMemo(() => {
    return {
      bytesAvailable: storageEstimate?.bytesAvailable,
      bytesUsed: storageEstimate?.bytesUsed,
    };
  }, [storageEstimate]);

  const version = Version.SHA;

  const table = useMemo(
    () => [
      {
        key: 'Version',
        value: (
          <a
            href={`https://gitlab.futo.org/polycentric/polycentric/-/tree/${version}`}
            target="_blank"
            rel="noreferrer"
          >
            {version}
          </a>
        ),
      },
      {
        key: 'Storage Persistent',
        value: persisted ? 'Yes' : 'No',
      },
      {
        key: 'Storage Driver',
        value: implementationName,
      },
      {
        key: 'Estimated Storage Available',
        value: bytesAvailable ? byteAmountToString(bytesAvailable) : undefined,
      },
      {
        key: 'Estimated Storage Used',
        value: bytesUsed ? byteAmountToString(bytesUsed) : undefined,
      },
    ],
    [version, persisted, implementationName, bytesAvailable, bytesUsed],
  );

  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-[2rem] border overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="text-left text-sm font-medium items-center">
          <tr>
            <th className="pt-4 px-6 pb-4">
              <h3>Client Information</h3>
            </th>
            <th className="text-right pr-6 pt-2">
              <button
                onClick={() => setExpanded(!expanded)}
                className="w-6 h-6"
              >
                {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
              </button>
            </th>
          </tr>
        </thead>
        {expanded && (
          <tbody className="bg-white divide-y divide-gray-200">
            {table.map(({ key, value }) => (
              <AppInfoTableRow key={key} field={key} value={value} />
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
};
