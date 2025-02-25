import { useState } from 'react';
import { useBlobDisplayURL } from '../../../../../hooks/imageHooks';
import { cropImageToWebp } from '../../../../../util/imageProcessing';
import { CropProfilePicModal } from '../../../CropProfilePic';
import { ProfilePicture } from '../../../ProfilePicture';

export const ProfileAvatarInput = ({
  title,
  hint,
  setCroppedImage,
  originalImageURL,
}: {
  title: string;
  hint?: string;
  setCroppedImage: (image?: Blob) => void;
  originalImageURL?: string;
}) => {
  const [rawImage, setRawImage] = useState<File | undefined>(undefined);
  // react-easy-crop requires an image URL to crop
  const rawImageURL = useBlobDisplayURL(rawImage);
  const [cropping, setCropping] = useState(false);
  const [internalCroppedImage, setInternalCroppedImage] = useState<
    Blob | undefined
  >();
  const croppedPreviewURL = useBlobDisplayURL(internalCroppedImage);

  const previewURL = croppedPreviewURL ?? originalImageURL;

  return (
    <div className="flex flex-col gap-y-1">
      <h3 className="font-medium">{title}</h3>
      <div className="">
        <label htmlFor="upload-button" className="">
          <ProfilePicture className="w-16 h-16" src={previewURL} />
        </label>
        <input
          id="upload-button"
          type="file"
          className="hidden"
          accept="image/png, image/jpeg, image/webp"
          onChange={(e) => {
            setCropping(true);
            const image = e.target.files?.[0];
            if (image) {
              setRawImage(image);
            } else {
              setRawImage(undefined);
            }
          }}
        />
      </div>
      <p className="text-sm text-gray-700">{hint}</p>
      {cropping && rawImageURL && (
        <CropProfilePicModal
          src={rawImageURL}
          aspect={1}
          open={rawImageURL !== undefined}
          setOpen={(open) => {
            if (!open) {
              setCropping(false);
              setRawImage(undefined);
            }
          }}
          onCrop={async ({ x, y, width, height }) => {
            if (rawImage) {
              const croppedImage = await cropImageToWebp(
                rawImage,
                x,
                y,
                width,
                height,
              );
              setInternalCroppedImage(croppedImage);
              setCroppedImage(croppedImage);
            }
            setCropping(false);
          }}
        />
      )}
    </div>
  );
};
