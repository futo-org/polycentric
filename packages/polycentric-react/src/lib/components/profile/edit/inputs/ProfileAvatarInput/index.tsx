import { useEffect, useState } from 'react'
import { cropImageToWebp } from '../../../../../util/imageProcessing'
import { CropProfilePicModal } from '../../../CropProfilePic'
import { ProfilePicture } from '../../../ProfilePicture'

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
        <label htmlFor="upload-button" className="">
          <ProfilePicture className="w-16 h-16" src={croppedPreviewURL} />
        </label>
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
