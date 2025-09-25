/**
 * @fileoverview Image processing utilities for avatar and background image handling with resolution management.
 *
 * Key Design Decisions:
 * - Multi-resolution avatar generation for responsive display across different screen sizes
 * - WebP/PNG conversion with canvas-based resizing for optimal file sizes
 * - Blob-to-Uint8Array conversion for Polycentric protocol compatibility
 * - Image manifest creation with metadata for distributed storage
 * - Canvas-based cropping with browser-native createImageBitmap for performance
 */

import { ProcessHandle, Protocol } from '@polycentric/polycentric-core';
import Long from 'long';

// Avatar resolution configuration for responsive display
export const avatarResolutions = { lg: 256, md: 128, sm: 32 };

// Convert blob to Uint8Array for Polycentric protocol compatibility
export const convertBlobToUint8Array = async (
  blob: Blob,
): Promise<Uint8Array> => {
  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  return uint8Array;
};

// Canvas-based image resizing with aspect ratio preservation and upscale control
export async function resizeImageToWebp(
  image: Blob,
  maxResX = 1000,
  maxResY = 1000,
  upscale = false,
): Promise<[Blob, number, number]> {
  try {
    const imageBitmap = await createImageBitmap(image);

    let ratio;

    if (upscale) {
      ratio = Math.min(
        maxResX / imageBitmap.width,
        maxResY / imageBitmap.height,
      );
    } else {
      ratio = Math.min(
        maxResX / imageBitmap.width,
        maxResY / imageBitmap.height,
        1,
      );
    }

    const newWidth = Math.round(imageBitmap.width * ratio);
    const newHeight = Math.round(imageBitmap.height * ratio);

    const canvas = document.createElement('canvas');
    canvas.width = newWidth;
    canvas.height = newHeight;

    const ctx = canvas.getContext('2d');

    if (ctx == null) {
      imageBitmap.close();
      throw new Error('Error loading context for canvas');
    }

    ctx.drawImage(imageBitmap, 0, 0, newWidth, newHeight);
    imageBitmap.close();

    return new Promise((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        if (blob === null) {
          reject(new Error('Error converting canvas to blob'));
          return;
        }
        resolve([blob, canvas.width, canvas.height]);
      }, 'image/png');
    });
  } catch (error) {
    console.error('[imageProcessing] Error in resizeImageToWebp:', error);
    throw error;
  }
}

// Publish image blob with resizing and manifest creation for distributed storage
export const publishImageBlob = async (
  image: Blob,
  handle: ProcessHandle.ProcessHandle,
  maxResX = 1000,
  maxResY = 1000,
  upscale = false,
): Promise<Protocol.ImageManifest> => {
  const [resizedBlob, width, height] = await resizeImageToWebp(
    image,
    maxResX,
    maxResY,
    upscale,
  );
  const newUint8Array = await convertBlobToUint8Array(resizedBlob);

  const imageRanges = await handle.publishBlob(newUint8Array);

  const imageManifest: Protocol.ImageManifest = {
    mime: 'image/png',
    width: Long.fromNumber(width),
    height: Long.fromNumber(height),
    byteCount: Long.fromNumber(newUint8Array.length),
    process: handle.process(),
    sections: imageRanges,
  };

  return imageManifest;
};

// Multi-resolution avatar publishing with responsive image bundle creation
export const publishBlobToAvatar = async (
  blob: Blob,
  handle: ProcessHandle.ProcessHandle,
) => {
  const resolutions: Array<number> = [256, 128, 32];
  const imageBundle: Protocol.ImageBundle = {
    imageManifests: [],
  };

  const imageManifests = [];
  for (const resolution of resolutions) {
    const manifest = await publishImageBlob(
      blob,
      handle,
      resolution,
      resolution,
      true,
    );
    imageManifests.push(manifest);
  }

  imageBundle.imageManifests = imageManifests;

  return await handle.setAvatar(imageBundle);
};

// Background image publishing with single resolution for banner display
export const publishBlobToBackground = async (
  blob: Blob,
  handle: ProcessHandle.ProcessHandle,
) => {
  const imageBundle: Protocol.ImageBundle = {
    imageManifests: [],
  };

  const imageManifest = await publishImageBlob(blob, handle);

  imageBundle.imageManifests.push(imageManifest);

  return await handle.setBanner(imageBundle);
};

// Data URL to blob conversion with MIME type detection and base64/URL decoding
export async function dataURLToBlob(dataURL: string): Promise<Blob> {
  const [header, data] = dataURL.split(',');
  const isBase64 = header.includes(';base64');
  let byteString: string;
  if (isBase64) {
    byteString = atob(data);
  } else {
    byteString = decodeURIComponent(data);
  }
  const mimeMatch = header.match(/data:(.*?)(;|$)/);
  const mimeString = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const ia = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ia], { type: mimeString });
}

// Browser-native image cropping with createImageBitmap for optimal performance
export async function cropImageToBlob(
  image: Blob,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<Blob> {
  // let the browser crop when decoding – works in Chrome, Safari, Firefox, Edge
  const croppedBitmap = await createImageBitmap(image, x, y, width, height);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(croppedBitmap, 0, 0, width, height);
  croppedBitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject('toBlob returned null')),
      'image/png',
    );
  });
}
