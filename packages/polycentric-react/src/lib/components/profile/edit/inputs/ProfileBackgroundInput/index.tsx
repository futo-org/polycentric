/**
 * @fileoverview Profile background input with cropping functionality.
 */

import { useEffect, useRef, useState } from 'react';
import { useBlobDisplayURL } from '../../../../../hooks/imageHooks';
import { cropImageToBlob } from '../../../../../util/imageProcessing';
import { CropProfilePicModal } from '../../../CropProfilePic';

// Hook to track previous value for comparison
function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

// Background input with file upload and rectangular cropping
export const ProfileBackgroundInput = ({
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
    // This effect handles resetting the preview.
    // It clears the preview only when the originalImageURL (the source of truth)
    // has actually changed from one valid URL to another, indicating a successful
    // save and data refresh. It ignores flickers to/from undefined during loading.
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
        <label htmlFor="background-upload-button" className="cursor-pointer">
          <div
            className="relative w-full h-48 bg-gray-100 rounded-lg overflow-hidden"
            style={{
              backgroundImage: `url(${previewURL || originalImageURL || ''})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 text-white hover:bg-black/40 transition-colors">
              <span>Click to upload</span>
            </div>
          </div>
        </label>
        <input
          id="background-upload-button"
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
          aspect={3 / 1}
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
