import { Models, ProcessHandle, Protocol } from "@polycentric/polycentric-core";
import Long from 'long';
import { useMemo, useState } from "react";
import Zoom from 'react-medium-image-zoom';
import { VouchedBy } from "..";
import { useImageManifestDisplayURLs } from "../../../../hooks/imageHooks";
import { getAccountUrl } from "../../../util/linkify/utils";

export const ClaimInfo: React.FC<{
    processHandle: ProcessHandle.ProcessHandle,
    claim: Protocol.Claim,
    pointer: Protocol.Reference,
    process: Models.Process.Process,
    logicalClock: Long,
    system: Models.PublicKey.PublicKey,
    vouches: Models.Event.Event[]
}> = ({processHandle, claim, pointer, process, logicalClock, system, vouches}) => {
    const url = useMemo(
        () => getAccountUrl(claim.claimType, claim.claimFields[0].value),
        [claim.claimType, claim.claimFields[0].value],
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

    return (<div className="w-fit h-fit">
        {claim.claimFields.map((field) => (<div key={field.key + field.value}>{url ? <a href={url}>{field.value}</a> : field.value}</div>))}
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

    </div>);
}