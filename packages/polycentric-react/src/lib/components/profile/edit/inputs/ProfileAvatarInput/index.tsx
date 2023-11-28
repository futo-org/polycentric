import { useEffect, useState } from 'react'
import { cropImageToWebp } from '../../../../../util/imageProcessing'
import { CropProfilePicModal } from '../../../CropProfilePic'

// copy this but for a profile image upload, with a small circle with an upload symbol (just put "u" fo for now) that switches to the uploaded image and an x that appears next to it to remove it
const XIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
    <path
      fillRule="evenodd"
      d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z"
      clipRule="evenodd"
    />
  </svg>
)

const useCleanupObjectURL = (url?: string) => {
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [url])
}

export const ProfileAvatarInput = ({
  title,
  hint,
  setImage,
  originalImageURL,
}: {
  title: string
  hint?: string
  setImage: (image?: Blob) => void
  originalImageURL?: string
}) => {
  const [rawImage, setRawImage] = useState<File | undefined>(undefined)
  // react-easy-crop requires an image URL to crop
  const [cropperURL, setCropperURL] = useState<string | undefined>(undefined)
  const [cropping, setCropping] = useState(false)
  const [croppedPreviewURL, setCroppedPreviewURL] = useState<string | undefined>(originalImageURL)

  useCleanupObjectURL(cropperURL)
  useCleanupObjectURL(croppedPreviewURL)

  return (
    <div className="flex flex-col gap-y-1">
      <h3 className="font-medium">{title}</h3>
      <div className="">
        <div className="w-16 h-16 rounded-full border overflow-clip">
          <label htmlFor="upload-button" className="">
            <img src={croppedPreviewURL} className="" />
          </label>
        </div>
        <input
          id="upload-button"
          type="file"
          className="hidden"
          accept="image/png, image/jpeg, image/webp"
          onChange={(e) => {
            setCropping(true)
            const image = e.target.files?.[0]
            if (image) {
              setRawImage(image)
              setCropperURL(URL.createObjectURL(image))
            } else {
              setRawImage(undefined)
              setCropperURL(undefined)
            }
          }}
        />
      </div>
      <p className="text-sm text-gray-700">{hint}</p>
      {cropping && cropperURL && (
        <CropProfilePicModal
          src={cropperURL}
          aspect={1}
          open={cropperURL !== undefined}
          setOpen={(open) => {
            if (!open) {
              setCropping(false)
              setCropperURL(undefined)
            }
          }}
          onCrop={async ({ x, y, width, height }) => {
            if (rawImage) {
              const croppedImage = await cropImageToWebp(rawImage, x, y, width, height)
              setCropperURL(undefined)
              setImage(croppedImage)

              const previewUrl = URL.createObjectURL(croppedImage)
              setCroppedPreviewURL(previewUrl)
            }
            setCropping(false)
          }}
        />
      )}
    </div>
  )
}
