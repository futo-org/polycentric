import { Models, ProcessHandle, Protocol } from '@polycentric/polycentric-core';
import Long from 'long';
import { useMemo, useState } from 'react';
import Zoom from 'react-medium-image-zoom';
import { VouchedBy } from '..';
import { useImageManifestDisplayURLs } from '../../../../hooks/imageHooks';
import { getAccountUrl } from '../../../util/linkify/utils';

export interface ClaimInfoProps {
  processHandle: ProcessHandle.ProcessHandle;
  claim: Protocol.Claim;
  pointer: Protocol.Reference;
  process: Models.Process.Process;
  logicalClock: Long;
  system: Models.PublicKey.PublicKey;
  vouches: Models.Event.Event[];
  isMyProfile: boolean | undefined;
}

export const ClaimInfo: React.FC<ClaimInfoProps> = ({
  processHandle,
  claim,
  pointer,
  process,
  logicalClock,
  system,
  vouches,
  isMyProfile,
}: ClaimInfoProps) => {
  const url = useMemo(
    () => getAccountUrl(claim.claimType, claim.claimFields[0].value),
    [claim.claimType, claim.claimFields],
  );
  const images = useImageManifestDisplayURLs(system, claim.images);

  const [vouchStatus, setVouchStatus] = useState<'none' | 'success' | 'error'>(
    'none',
  );
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Check if the current user has already vouched for this claim
  const hasUserVouched = useMemo(() => {
    if (!processHandle || !vouches) return false;

    const currentUserSystem = processHandle.system();
    return vouches.some(
      (vouch) =>
        vouch && Models.PublicKey.equal(vouch.system, currentUserSystem),
    );
  }, [processHandle, vouches]);

  const handleVouch = async () => {
    if (!processHandle || hasUserVouched) return;
    try {
      await processHandle.vouchByReference(pointer);
      setVouchStatus('success');
    } catch (error) {
      setVouchStatus('error');
      console.error('Failed to vouch:', error);
      setTimeout(() => setVouchStatus('none'), 2000);
    }
  };

  const handleDelete = async () => {
    if (!processHandle || isDeleting) return;

    try {
      setIsDeleting(true);
      await processHandle.delete(process, logicalClock);
      setShowDeleteConfirm(false);
    } catch (error) {
      console.error('Failed to delete claim:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="w-fit h-fit">
      {claim.claimFields.map((field) => (
        <div key={field.key + field.value}>
          {url ? <a href={url}>{field.value}</a> : field.value}
        </div>
      ))}
      <div className="w-fit h-fit grid grid-cols-2 gap-1">
        {images.map((image) => (
          <Zoom key={image} classDialog="custom-post-img-zoom">
            <img
              src={image}
              className="rounded-2xl max-h-[10rem] max-w-[10rem] p-0 m-0 w-auto hover:opacity-80 border"
            />
          </Zoom>
        ))}
      </div>
      {/* Vouches */}
      <div className="w-full flex justify-center gap-2">
        {vouches?.map(
          (vouch, index) =>
            vouch && (
              <div key={index} className="flex flex-col items-center">
                <VouchedBy system={vouch.system} />
              </div>
            ),
        )}
      </div>
      <>
        {/* Vouch/Remove Button */}
        <div className="w-full flex justify-center">
          {isMyProfile ? (
            <>
              {
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDeleteConfirm(true);
                  }}
                  className="px-4  py-1 text-sm text-red-600 hover:text-red-700 border border-red-600 rounded-md hover:bg-red-50 transition-colors bg-gray-100"
                >
                  Remove
                </button>
              }

              {showDeleteConfirm && (
                <div
                  className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDeleteConfirm(false);
                  }}
                >
                  <div
                    className="bg-white p-6 rounded-lg shadow-lg max-w-sm mx-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3 className="text-lg font-semibold mb-4">
                      Delete Claim?
                    </h3>
                    <p className="text-gray-600 mb-6">
                      This action cannot be undone.
                    </p>
                    <div className="flex justify-end gap-4">
                      <button
                        onClick={() => {
                          setShowDeleteConfirm(false);
                        }}
                        className="px-4 py-2 text-gray-600 hover:text-gray-700"
                        disabled={isDeleting}
                      >
                        Cancel
                      </button>
                      {
                        <button
                          onClick={handleDelete}
                          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-red-300 disabled:cursor-not-allowed"
                          disabled={isDeleting}
                        >
                          {isDeleting ? (
                            <span className="flex items-center justify-center">
                              <svg
                                className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                              >
                                <circle
                                  className="opacity-25"
                                  cx="12"
                                  cy="12"
                                  r="10"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                ></circle>
                                <path
                                  className="opacity-75"
                                  fill="currentColor"
                                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                ></path>
                              </svg>
                              Deleting...
                            </span>
                          ) : (
                            'Delete'
                          )}
                        </button>
                      }
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : hasUserVouched ? (
            <div className="px-4 py-1 text-sm border border-green-600 text-green-600 bg-green-50 rounded-md">
              Verified
            </div>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleVouch();
              }}
              className={`px-4 py-1 text-sm border rounded-md transition-all duration-300 ${
                vouchStatus === 'success'
                  ? 'bg-green-100 text-green-600 border-green-600 opacity-0'
                  : vouchStatus === 'error'
                    ? 'bg-red-100 text-red-600 border-red-600'
                    : 'bg-gray-100 text-blue-600 border-blue-600 hover:bg-blue-50'
              }`}
              disabled={hasUserVouched}
            >
              Verify
            </button>
          )}
        </div>
      </>
    </div>
  );
};
