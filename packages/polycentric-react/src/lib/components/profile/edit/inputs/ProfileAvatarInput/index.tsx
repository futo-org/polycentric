import { useEffect, useRef, useState } from 'react';
import { useBlobDisplayURL } from '../../../../../hooks/imageHooks';
import { cropImageToBlob } from '../../../../../util/imageProcessing';
import { CropProfilePicModal } from '../../../CropProfilePic';
import { ProfilePicture } from '../../../ProfilePicture';

function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

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
  const [previewURL, setPreviewURL] = useState<string | undefined>();
  const [rawImage, setRawImage] = useState<File | undefined>(undefined);
  // react-easy-crop requires an image URL to crop
  const rawImageURL = useBlobDisplayURL(rawImage);
  const [cropping, setCropping] = useState(false);
  const prevOriginalImageURL = usePrevious(originalImageURL);

  useEffect(() => {
    if (
      prevOriginalImageURL &&
      originalImageURL &&
      prevOriginalImageURL !== originalImageURL
    ) {
      if (previewURL) {
        URL.revokeObjectURL(previewURL);
        setPreviewURL(undefined);
      }
    }
  }, [originalImageURL, prevOriginalImageURL, previewURL]);

  useEffect(() => {
    // Clean up the preview URL when the component unmounts
    return () => {
      if (previewURL) {
        URL.revokeObjectURL(previewURL);
      }
    };
  }, [previewURL]);

  return (
    <div className="flex flex-col gap-y-1">
      <h3 className="font-medium">{title}</h3>
      <div className="">
        <label htmlFor="upload-button" className="">
          <ProfilePicture
            className="w-16 h-16"
            src={previewURL || originalImageURL}
          />
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
              const croppedImage = await cropImageToBlob(
                rawImage,
                x,
                y,
                width,
                height,
              );
              setCroppedImage(croppedImage);

              if (previewURL) {
                URL.revokeObjectURL(previewURL);
              }
              setPreviewURL(URL.createObjectURL(croppedImage));
            }
            setCropping(false);
          }}
        />
      )}
    </div>
  );
};
