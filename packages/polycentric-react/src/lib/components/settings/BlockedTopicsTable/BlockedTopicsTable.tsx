import { Models, Util } from '@polycentric/polycentric-core';
import { useMemo } from 'react';
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks';
import { useQueryCRDTSet } from '../../../hooks/queryHooks';

export const BlockedTopicsTable = () => {
  const { processHandle } = useProcessHandleManager();
  const system = useMemo(() => processHandle.system(), [processHandle]);

  const [events, advance] = useQueryCRDTSet(
    system,
    Models.ContentType.ContentTypeBlockTopic,
    100,
  );

  // load on mount
  useMemo(() => {
    advance();
  }, [advance]);

  const blockedTopics = useMemo(() => {
    return events
      .filter((e) => e.lwwElementSet?.value)
      .map((e) => Util.decodeText(e.lwwElementSet!.value));
  }, [events]);

  return (
    <div className="rounded-[2rem] border overflow-hidden">
      {blockedTopics.length === 0 ? (
        <div className="p-4 text-gray-500 bg-white">No blocked topics.</div>
      ) : (
        <table className="min-w-full divide-y divide-gray-200">
          <tbody className="bg-white divide-y divide-gray-200">
            {blockedTopics.map((topic) => (
              <tr key={topic}>
                <td className="px-6 py-3 whitespace-nowrap break-all text-sm text-gray-900">
                  {topic}
                </td>
                <td className="px-6 py-3 whitespace-nowrap text-right">
                  <button
                    onClick={() => {
                      processHandle.unblockTopic(topic).then(() => {
                        advance();
                      });
                    }}
                    className="btn btn-primary rounded-full h-[2.25rem] px-3 border bg-white hover:bg-gray-50 text-gray-700"
                  >
                    Unblock
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
