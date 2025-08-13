// @ts-ignore - fflate package will be installed via npm install
import { decode, encodeUrl } from '@borderless/base64';
import { gunzipSync, gzipSync } from 'fflate';

// Threshold for when to compress data (in characters) - matching Grayjay's 2000 char limit
const COMPRESSION_THRESHOLD = 2000;

export interface CompressionResult {
  url: string;
  isCompressed: boolean;
  originalSize: number;
  compressedSize?: number;
  compressionRatio?: number;
}

/**
 * Creates export bundle URL with compression if needed - compatible with Grayjay approach
 * This matches Grayjay's compression strategy: compress the URLInfo bytes, not the URL string
 */
export function createExportBundleUrl(urlInfoBytes: Uint8Array): CompressionResult {
  // Create the original URL first to check size
  const originalUrl = `polycentric://${encodeUrl(urlInfoBytes)}`;
  const originalSize = originalUrl.length;
  
  if (originalSize <= COMPRESSION_THRESHOLD) {
    return {
      url: originalUrl,
      isCompressed: false,
      originalSize,
    };
  }

  try {
    // Compress the raw URLInfo bytes (matching Grayjay's approach)
    const compressed = gzipSync(urlInfoBytes, { level: 9 });
    
    // Create URL with compressed data
    const compressedUrl = `polycentric://${encodeUrl(compressed)}`;
    const compressedSize = compressedUrl.length;
    const compressionRatio = originalSize / compressedSize;
    
    // Log compression info for debugging in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`Export bundle compressed: ${originalSize} → ${compressedSize} chars (${compressionRatio.toFixed(2)}x smaller)`);
    }
    
    // Only use compression if it actually saves space
    if (compressedSize < originalSize) {
      return {
        url: compressedUrl,
        isCompressed: true,
        originalSize,
        compressedSize,
        compressionRatio,
      };
    } else {
      return {
        url: originalUrl,
        isCompressed: false,
        originalSize,
      };
    }
  } catch (error) {
    console.warn('Compression failed, using original data:', error);
    return {
      url: originalUrl,
      isCompressed: false,
      originalSize,
    };
  }
}

/**
 * Parses import bundle URL with decompression support - compatible with Grayjay approach
 * This matches Grayjay's decompression strategy: try normal parsing first, then try decompression
 */
export function parseImportBundleUrl(url: string): Uint8Array {
  if (!url.startsWith('polycentric://')) {
    throw new Error('Invalid polycentric URL');
  }

  const bundleWithoutPrefix = url.replace('polycentric://', '');
  const data = decode(bundleWithoutPrefix);
  
  // Return the data as-is first - if the caller fails to parse it as URLInfo,
  // they should try decompression. This matches Grayjay's two-step approach.
  return data;
}

/**
 * Attempts to decompress URLInfo bytes if regular parsing failed
 * This is the fallback method that matches Grayjay's approach
 */
export function tryDecompressUrlInfo(data: Uint8Array): Uint8Array {
  try {
    return gunzipSync(data);
  } catch (error) {
    throw new Error('Failed to decompress URLInfo data - may be corrupted or invalid format');
  }
}

/**
 * Legacy compatibility functions for existing code
 */
export function compressIfNeeded(data: string): CompressionResult {
  // For backward compatibility, but recommend using createExportBundleUrl instead
  console.warn('compressIfNeeded is deprecated, use createExportBundleUrl for new code');
  
  const originalSize = data.length;
  
  if (originalSize <= COMPRESSION_THRESHOLD || !data.startsWith('polycentric://')) {
    return {
      url: data,
      isCompressed: false,
      originalSize,
    };
  }

  // Extract and recompress using the new method
  try {
    const bundleWithoutPrefix = data.replace('polycentric://', '');
    const urlInfoBytes = decode(bundleWithoutPrefix);
    return createExportBundleUrl(urlInfoBytes);
  } catch (error) {
    console.warn('Legacy compression failed:', error);
    return {
      url: data,
      isCompressed: false,
      originalSize,
    };
  }
}

export function decompressIfNeeded(data: string): string {
  // For backward compatibility, but recommend using parseImportBundleUrl instead
  console.warn('decompressIfNeeded is deprecated, use parseImportBundleUrl for new code');
  
  if (!data.startsWith('polycentric://')) {
    return data;
  }

  try {
    // Try the new parsing approach
    parseImportBundleUrl(data);
    return data; // If no exception, data is valid as-is
  } catch (error) {
    throw new Error('Failed to decompress profile data. The data may be corrupted.');
  }
}
