import { ProcessHandle, Protocol } from '@polycentric/polycentric-core';
import Long from 'long';

export const avatarResolutions = { lg: 256, md: 128, sm: 32 };

export async function cropImageToWebp(
  image: Blob,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(image);

    img.onload = () => {
      canvas.width = width;
      canvas.height = height;

      if (ctx == null) {
        URL.revokeObjectURL(img.src);
        reject(new Error('Error loading context for canvas'));
        return;
      }

      ctx.drawImage(img, x, y, width, height, 0, 0, width, height);

      canvas.toBlob((blob) => {
        URL.revokeObjectURL(img.src);
        if (blob === null) {
          reject(new Error('Error converting canvas to blob'));
          return;
        }
        resolve(blob);
      }, 'image/webp');
    };

    img.onerror = function () {
      URL.revokeObjectURL(img.src);
      reject(new Error('Error loading image.'));
    };
  });
}

export async function resizeImageToWebp(
  image: Blob,
  quality = 0.7,
  maxResX = 1000,
  maxResY = 1000,
  upscale = false,
): Promise<[Blob, number, number]> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const img = new Image();

    img.onload = () => {
      // For a 3000x4000 image, this will return a 750x1000 image
      // For a 30x40 image without upscale, this will return a 30x40 image
      // For a 30x40 image with upscale, this will return a 750x1000 image
      let ratio;

      if (upscale) {
        ratio = Math.min(maxResX / img.width, maxResY / img.height);
      } else {
        ratio = Math.min(maxResX / img.width, maxResY / img.height, 1);
      }

      // 4998 * Math.min(1000 / 3999, 1000 / 4998) = 999.9999999999999
      // 5003 * Math.min(1000 / 3999, 1000 / 5003) = 1000.0000000000001
      // Due to floating point precision, we need to round the width and height to back to integers
      const newWidth = Math.round(img.width * ratio);
      const newHeight = Math.round(img.height * ratio);

      canvas.width = newWidth;
      canvas.height = newHeight;

      if (ctx == null) {
        URL.revokeObjectURL(img.src);
        reject(new Error('Error loading context for canvas'));
        return;
      }

      // Draw the image onto the canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Convert the canvas content to WebP format
      canvas.toBlob(
        async (blob) => {
          URL.revokeObjectURL(img.src);
          if (blob === null) {
            reject(new Error('Error converting canvas to blob'));
            return;
          }
          resolve([blob, canvas.width, canvas.height]);
        },
        'image/webp',
        quality,
      );
    };

    img.onerror = function () {
      // Important: Revoke the object URL in case of error as well
      URL.revokeObjectURL(img.src);
      reject(new Error('Error loading image.'));
    };

    // Convert the Blob into an object URL and set as the img src
    img.src = URL.createObjectURL(image);
  });
}

export const convertBlobToUint8Array = async (
  blob: Blob,
): Promise<Uint8Array> => {
  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  return uint8Array;
};

export const publishImageBlob = async (
  image: Blob,
  handle: ProcessHandle.ProcessHandle,
  quality = 0.7,
  maxResX = 1000,
  maxResY = 1000,
  upscale = false,
): Promise<Protocol.ImageManifest> => {
  const [newBlob, width, height] = await resizeImageToWebp(
    image,
    quality,
    maxResX,
    maxResY,
    upscale,
  );
  const newUint8Array = await convertBlobToUint8Array(newBlob);

  const imageRanges = await handle.publishBlob(newUint8Array);

  const imageManifest: Protocol.ImageManifest = {
    mime: 'image/webp',
    width: Long.fromNumber(width),
    height: Long.fromNumber(height),
    byteCount: Long.fromNumber(newUint8Array.length),
    process: handle.process(),
    sections: imageRanges,
  };

  return imageManifest;
};

export const publishBlobToAvatar = async (
  blob: Blob,
  handle: ProcessHandle.ProcessHandle,
) => {
  const resolutions: Array<number> = [256, 128, 32];
  const quality = 0.7;
  const imageBundle: Protocol.ImageBundle = {
    imageManifests: [],
  };

  const imageManifests = [];
  for (const resolution of resolutions) {
    const manifest = await publishImageBlob(
      blob,
      handle,
      quality,
      resolution,
      resolution,
      true,
    );
    imageManifests.push(manifest);
  }

  imageBundle.imageManifests = imageManifests;

  return await handle.setAvatar(imageBundle);
};
