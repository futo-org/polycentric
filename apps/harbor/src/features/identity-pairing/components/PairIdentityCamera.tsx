import { LinkButton, Text } from '@/src/common/components/primitives';
import { Atoms, useTheme } from '@/src/common/theme';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';
import {
  type TargetBarcodeFormat,
  useBarcodeScannerOutput,
} from 'react-native-vision-camera-barcode-scanner';
import type { PairIdentityCameraComponent } from './PairIdentityCamera.types';
import { PairIdentityManualEntry } from './PairIdentityManualEntry';
import { decodePairingCode, EncodingMode } from '../pairingCode';

// Stable reference for the barcode formats array to prevent
// the scanner from being destroyed and recreated extra times.
const BARCODE_FORMATS: TargetBarcodeFormat[] = ['qr-code'];

export const PairIdentityCamera: PairIdentityCameraComponent = ({
  onCodeScanned,
}) => {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [input, setInput] = useState('');
  const { theme } = useTheme();
  const scannedRef = useRef(false);

  const barcodeOutput = useBarcodeScannerOutput({
    barcodeFormats: BARCODE_FORMATS,
    onBarcodeScanned: (barcodes) => {
      if (scannedRef.current) return;

      const value = barcodes.find((barcode) => barcode.rawValue)?.rawValue;
      if (!value) return;

      scannedRef.current = true;
      const info = decodePairingCode(value, EncodingMode.BASE64) ?? null;
      onCodeScanned(info);
    },
    onError: () => setCameraEnabled(false),
  });

  useEffect(() => {
    if (!hasPermission && cameraEnabled) {
      void requestPermission();
    }
  }, [hasPermission, requestPermission, cameraEnabled]);

  const handleContinue = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    const info = decodePairingCode(trimmed, EncodingMode.HEX) ?? null;
    onCodeScanned(info);
  };

  const canUseCamera = hasPermission && cameraEnabled && device !== undefined;

  return (
    <>
      {canUseCamera && device ? (
        <>
          <Text variant="body" color="neutral_500">
            On your other device, go to Settings {'->'} Pair Identity.
          </Text>
          <View
            style={[
              Atoms.flex_1,
              Atoms.rounded_md,
              {
                overflow: 'hidden',
                backgroundColor: theme.palette.neutral_900,
              },
            ]}
          >
            <Camera
              device={device}
              isActive={true}
              outputs={[barcodeOutput]}
              style={{ flex: 1 }}
            />
          </View>
          <LinkButton
            title="Can't scan? Enter code manually"
            onPress={() => setCameraEnabled(false)}
            variant="small"
            underlineOnHover
          />
        </>
      ) : (
        <>
          <PairIdentityManualEntry
            input={input}
            setInput={setInput}
            onContinue={handleContinue}
          />

          {device !== undefined && (
            <LinkButton
              title="Use camera instead"
              onPress={() => {
                setCameraEnabled(true);
                scannedRef.current = false;
              }}
              variant="small"
              underlineOnHover
            />
          )}
        </>
      )}
    </>
  );
};
