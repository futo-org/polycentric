import { Models, Protocol } from "@polycentric/polycentric-core";
import Zoom from 'react-medium-image-zoom';
import { useImageManifestDisplayURLs } from "../../../../hooks/imageHooks";

export const ClaimInfo: React.FC<{
    url: string | undefined,
    claim: Protocol.Claim,
    system: Models.PublicKey.PublicKey
}> = ({url, claim, system}) => {
    const images = useImageManifestDisplayURLs(system, claim.images);

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
    </div>);
}