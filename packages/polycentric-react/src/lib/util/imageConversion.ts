import { ProcessHandle, Protocol } from '@polycentric/polycentric-core'
import Long from 'long'

const canvas = document.createElement('canvas')
const ctx = canvas.getContext('2d')

export async function convertImageToWebp(
  image: Blob,
  quality = 0.7,
  maxResX = 1000,
  maxResY = 1000,
  squareCrop = false,
): Promise<[Blob, number, number]> {
  return new Promise((resolve, reject) => {
    const img = new Image()

    if (squareCrop && maxResX !== maxResY) {
      throw new Error('squareCrop can only be used when maxResX === maxResY')
    }

    img.onload = () => {
      // For a 3000x4000 image, this will return a 750x1000 image
      // For a 30x40 image, this will return a 30x40 image
      const ratio = Math.min(maxResX / img.width, maxResY / img.height, 1)
      const newWidth = img.width * ratio
      const newHeight = img.height * ratio

      if (squareCrop === true) {
        canvas.width = maxResX
        canvas.height = maxResX
      } else {
        canvas.width = newWidth
        canvas.height = newHeight
      }

      if (ctx == null) {
        URL.revokeObjectURL(img.src)
        reject(new Error('Error loading context for canvas'))
        return
      }

      // Draw the image onto the canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      if (squareCrop === true) {
        const x = (canvas.width - newWidth) / 2
        const y = (canvas.height - newHeight) / 2
        ctx.drawImage(img, x, y, newWidth, newHeight)
      } else {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      }

      // Convert the canvas content to WebP format
      canvas.toBlob(
        async (blob) => {
          URL.revokeObjectURL(img.src)
          if (blob === null) {
            reject(new Error('Error converting canvas to blob'))
            return
          }
          resolve([blob, canvas.width, canvas.height])
        },
        'image/webp',
        quality,
      )
    }

    img.onerror = function () {
      // Important: Revoke the object URL in case of error as well
      URL.revokeObjectURL(img.src)
      reject(new Error('Error loading image.'))
    }

    // Convert the Blob into an object URL and set as the img src
    img.src = URL.createObjectURL(image)
  })
}

export const convertBlobToUint8Array = async (blob: Blob): Promise<Uint8Array> => {
  const arrayBuffer = await blob.arrayBuffer()
  const uint8Array = new Uint8Array(arrayBuffer)
  return uint8Array
}

export const publishBlobToAvatar = async (blob: Blob, handle: ProcessHandle.ProcessHandle) => {
  const resolutions: Array<number> = [256, 128, 32]
  const quality = 0.7
  const imageBundle: Protocol.ImageBundle = {
    imageManifests: [],
  }
  for (const resolution of resolutions) {
    const [newBlob, width, height] = await convertImageToWebp(blob, quality, resolution, resolution, true)
    const newUint8Array = await convertBlobToUint8Array(newBlob)

    const imageRanges = await handle.publishBlob(newUint8Array)

    imageBundle.imageManifests.push({
      mime: 'image/webp',
      width: Long.fromNumber(width),
      height: Long.fromNumber(height),
      byteCount: Long.fromNumber(newUint8Array.length),
      process: handle.process(),
      sections: imageRanges,
    })
  }

  return await handle.setAvatar(imageBundle)
}