import {
  compressIfNeeded,
  createExportBundleUrl,
  parseImportBundleUrl,
  tryDecompressUrlInfo,
} from './compression';

// Mock fflate for testing
jest.mock('fflate', () => ({
  gzipSync: jest.fn((data: Uint8Array) => {
    // Simple mock that just returns a compressed-like array (much smaller)
    return new Uint8Array([0x1f, 0x8b, 0x08, 0x00, ...data.slice(0, 10)]);
  }),
  gunzipSync: jest.fn((data: Uint8Array) => {
    // Simple mock that reverses the compression
    return data.slice(4); // Remove the mock gzip header
  }),
}));

describe('compression utilities', () => {
  describe('createExportBundleUrl', () => {
    it('should not compress small data', () => {
      const smallData = new Uint8Array([1, 2, 3, 4, 5]); // Small URLInfo bytes
      const result = createExportBundleUrl(smallData);

      expect(result.isCompressed).toBe(false);
      expect(result.url).toContain('polycentric://');
      expect(result.originalSize).toBeDefined();
    });

    it('should compress large data', () => {
      const largeData = new Uint8Array(3000).fill(42); // Large URLInfo bytes
      const result = createExportBundleUrl(largeData);

      expect(result.isCompressed).toBe(true);
      expect(result.url).toContain('polycentric://');
      expect(result.originalSize).toBeDefined();
      expect(result.compressedSize).toBeDefined();
      expect(result.compressionRatio).toBeDefined();
    });
  });

  describe('parseImportBundleUrl', () => {
    it('should parse valid polycentric URLs', () => {
      const testUrl = 'polycentric://dGVzdGRhdGE'; // base64 for 'testdata'
      const result = parseImportBundleUrl(testUrl);

      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('should reject invalid URLs', () => {
      expect(() => parseImportBundleUrl('invalid://url')).toThrow(
        'Invalid polycentric URL',
      );
    });
  });

  describe('tryDecompressUrlInfo', () => {
    it('should decompress gzipped data', () => {
      const originalData = new Uint8Array([1, 2, 3, 4, 5]);
      // Note: In real usage, this would be actual gzipped data
      const result = tryDecompressUrlInfo(originalData);

      expect(result).toBeInstanceOf(Uint8Array);
    });
  });

  describe('round-trip compatibility', () => {
    it('should maintain data integrity through export and import', () => {
      const testData = new Uint8Array(3000).fill(123); // Large test data

      const exportResult = createExportBundleUrl(testData);
      const importedBytes = parseImportBundleUrl(exportResult.url);

      if (exportResult.isCompressed) {
        // If compressed, we need to decompress to get original data
        const decompressed = tryDecompressUrlInfo(importedBytes);
        expect(decompressed).toEqual(testData);
      } else {
        // If not compressed, should match directly
        expect(importedBytes).toEqual(testData);
      }
    });
  });

  describe('legacy compatibility', () => {
    it('should maintain backward compatibility with compressIfNeeded', () => {
      const testUrl = 'polycentric://dGVzdGRhdGE';
      const result = compressIfNeeded(testUrl);

      expect(result.url).toBe(testUrl); // Small data should not be compressed
      expect(result.isCompressed).toBe(false);
    });
  });
});
