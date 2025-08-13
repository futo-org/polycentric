# Profile Compression Support - Grayjay Compatible

This document describes the compression feature added to support large profile exports from Grayjay and other applications, implementing full compatibility with Grayjay's compression approach.

## Problem

Some users have very large profile exports which exceed QR code capacity limits (typically 2KB-4KB for practical scanning). This caused "Data too big" errors when generating QR codes for profile imports.

## Solution

We've implemented automatic compression support that is **fully compatible with Grayjay's approach**:

1. **Automatically compresses large export data** when it exceeds 2000 characters (matching Grayjay's threshold)
2. **Uses GZIP compression** at the URLInfo byte level (matching Grayjay's implementation)
3. **Uses try/parse fallback detection** instead of prefixes (matching Grayjay's approach)
4. **Maintains backward compatibility** with existing uncompressed exports
5. **Provides fallback mechanisms** when QR codes are still too large

## Implementation Details

### Files Modified

- `packages/polycentric-react/package.json` - Added `fflate` compression library
- `packages/polycentric-react/src/lib/util/compression.ts` - Core compression utilities (Grayjay-compatible)
- `packages/polycentric-react/src/lib/components/settings/ExportKey/index.tsx` - Updated export UI
- `packages/polycentric-react/src/lib/hooks/processHandleManagerHooks.ts` - Updated import logic (Grayjay-compatible)
- `packages/polycentric-react/src/lib/components/onboarding/onboarding/index.tsx` - Updated sign-in validation

### Compression Logic (Grayjay Compatible)

1. **Export Process (matches Grayjay exactly):**

   - Create URLInfo protocol buffer bytes
   - Check if resulting `polycentric://` URL exceeds 2000 characters
   - If yes, compress the raw URLInfo bytes using GZIP
   - Create new URL with compressed bytes (still uses `polycentric://` prefix)
   - Display compression stats in UI

2. **Import Process (matches Grayjay exactly):**
   - Parse `polycentric://` URL to get raw bytes
   - Try to parse bytes as URLInfo protocol buffer
   - If parsing fails, try decompressing bytes with GZIP then parse again
   - Process normally after successful parsing
   - Provide helpful error messages for corrupted data

### QR Code Handling

- QR code generation now includes error handling for oversized data
- Shows user-friendly messages when QR codes can't be generated
- Provides fallback to text export when QR codes fail

## Usage

### For Users

1. **Exporting:** The compression happens automatically when needed. Users will see compression statistics if their data was compressed.

2. **Importing:** Works transparently with both compressed and uncompressed exports. Users can paste either format into the import field.

### For Developers

```typescript
import {
  createExportBundleUrl,
  parseImportBundleUrl,
  tryDecompressUrlInfo,
} from '@polycentric/polycentric-react';

// Create export URL with automatic compression (Grayjay-compatible)
const urlInfoBytes = Protocol.URLInfo.encode(urlInfo).finish();
const result = createExportBundleUrl(urlInfoBytes);
console.log(
  `URL: ${result.url}, Compressed: ${result.isCompressed}, Ratio: ${result.compressionRatio}`,
);

// Parse import URL with automatic decompression (Grayjay-compatible)
try {
  const urlInfoBytes = parseImportBundleUrl(url);
  const urlInfo = Protocol.URLInfo.decode(urlInfoBytes);
} catch (error) {
  // Try decompression fallback
  const decompressedBytes = tryDecompressUrlInfo(urlInfoBytes);
  const urlInfo = Protocol.URLInfo.decode(decompressedBytes);
}
```

## Testing

Run the compression tests:

```bash
cd packages/polycentric-react
npm test compression.test.ts
```

## Installation

After pulling these changes, run:

```bash
cd packages/polycentric-react
npm install
```

This will install the required `fflate` compression library.

## Backward Compatibility

- All existing uncompressed exports continue to work
- No breaking changes to the API
- Graceful degradation when compression fails

## Performance

- Compression only applied when data exceeds threshold (2000 chars)
- Uses efficient GZIP compression (level 9 for maximum compression)
- Minimal performance impact on small exports
- Significant size reduction for large exports (typically 3-5x smaller)

## Error Handling

- Compression failures fall back to uncompressed data
- Decompression failures provide clear error messages
- Robust error handling prevents data loss
- Helpful user feedback for troubleshooting
