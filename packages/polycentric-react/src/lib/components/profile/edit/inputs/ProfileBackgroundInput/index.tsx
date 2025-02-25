import { useState } from 'react';
import { useBlobDisplayURL } from '../../../../../hooks/imageHooks';
import { cropImageToWebp } from '../../../../../util/imageProcessing';
import { CropProfilePicModal } from '../../../CropProfilePic';

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
                <label
                    htmlFor="background-upload-button"
                    className="cursor-pointer"
                >
                    <div
                        className="relative w-full h-48 bg-gray-100 rounded-lg overflow-hidden"
                        style={{
                            backgroundImage: previewURL
                                ? `url(${previewURL})`
                                : 'none',
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
