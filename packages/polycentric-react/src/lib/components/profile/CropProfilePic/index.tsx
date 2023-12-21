import { useCallback, useRef, useState } from 'react'
import Cropper, { Area } from 'react-easy-crop'
import { Modal } from '../../util/modal'

export const CropProfilePic = ({
  src,
  aspect = 1,
  onCrop,
}: {
  src: string
  aspect?: number
  onCrop: (cropParams: { x: number; y: number; height: number; width: number }) => void
}) => {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const cropParams = useRef<undefined | Area>(undefined)

  const onCropComplete = useCallback((croppedArea: Area, croppedAreaPixels: Area) => {
    cropParams.current = croppedAreaPixels
  }, [])

  return (
    <div className=" flex flex-col space-y-5">
      <div className="w-full relative" style={{ aspectRatio: aspect }}>
        <Cropper
          image={src}
          crop={crop}
          zoom={zoom}
          aspect={aspect}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
          objectFit="horizontal-cover"
          classes={{
            containerClassName: 'rounded-lg',
            cropAreaClassName: 'rounded-full',
          }}
        />
      </div>
      <div>
        <label
          htmlFor="default-range"
          className=" mb-2 text-sm font-medium text-gray-900 dark:text-white hidden lg:block"
        >
          Zoom
        </label>
        <div className="flex items-center space-x-4 justify-center">
          <input
            id="default-range"
            type="range"
            value={zoom}
            min={1}
            max={4}
            step={0.1}
            onInput={(e) => {
              setZoom(parseFloat(e.currentTarget.value))
            }}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 hidden lg:block"
          ></input>
          <button
            className="lg:ml-2 px-6 py-2 border bg-blue-500 rounded-full text-xl text-white"
            onClick={() => {
              if (cropParams.current) {
                onCrop(cropParams.current)
              }
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

export const CropProfilePicModal = ({
  src,
  aspect = 1,
  onCrop,
  open,
  setOpen,
}: {
  src: string
  aspect?: number
  onCrop: (cropParams: { x: number; y: number; height: number; width: number }) => void
  open: boolean
  setOpen: (open: boolean) => void
}) => (
  <Modal title="Crop" open={open} setOpen={setOpen} shrink={false}>
    <div className="w-[30rem] max-w-full">
      <CropProfilePic src={src} aspect={aspect} onCrop={onCrop} />
    </div>
  </Modal>
)
