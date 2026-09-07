import { LinkButton, Text } from '@/src/common/components/primitives';
import { Atoms, useTheme } from '@/src/common/theme';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { PairIdentityCameraComponent } from './PairIdentityCamera.types';
import { PairIdentityManualEntry } from './PairIdentityManualEntry';
import { decodePairingCode, EncodingMode } from '../pairingCode';

function supportsGetUserMedia() {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

export const PairIdentityCamera: PairIdentityCameraComponent = ({
  onCodeScanned,
}) => {
  const [input, setInput] = useState('');
  const [useCamera, setUseCamera] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannedRef = useRef(false);
  const { theme } = useTheme();

  const canProbeCamera = supportsGetUserMedia();
  const canUseCamera = useCamera && canProbeCamera;

  useEffect(() => {
    if (!canUseCamera || !videoRef.current) {
      return;
    }

    let stream: MediaStream | null = null;
    let cancelled = false;
    let rafId: number | null = null;
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (nextStream) => {
        if (cancelled || !videoRef.current) {
          nextStream.getTracks().forEach((track) => {
            track.stop();
          });
          return;
        }

        stream = nextStream;
        videoRef.current.srcObject = nextStream;
        await videoRef.current.play();

        // @ts-expect-error BarcodeDetector is not in lib.dom
        if (!window.BarcodeDetector) {
          setUseCamera(false);
          return;
        }

        // @ts-expect-error BarcodeDetector is not in lib.dom
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });

        const detectFrame = async () => {
          if (cancelled || scannedRef.current || !videoRef.current) {
            return;
          }

          try {
            const barcodes = await detector.detect(videoRef.current);
            const raw = barcodes[0]?.rawValue;
            if (raw) {
              scannedRef.current = true;
              const info = decodePairingCode(raw, EncodingMode.BASE64) ?? null;
              onCodeScanned(info);
              return;
            }
          } catch {}

          rafId = window.requestAnimationFrame(() => {
            void detectFrame();
          });
        };

        rafId = window.requestAnimationFrame(() => {
          void detectFrame();
        });
      })
      .catch(() => {
        if (!cancelled) {
          setUseCamera(false);
        }
      });

    return () => {
      cancelled = true;
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      stream?.getTracks().forEach((track) => {
        track.stop();
      });
    };
  }, [canUseCamera, onCodeScanned]);

  const handleContinue = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    const info = decodePairingCode(trimmed, EncodingMode.HEX) ?? null;
    onCodeScanned(info);
  };

  return (
    <>
      {canUseCamera ? (
        <>
          <Text variant="body" color="neutral_500">
            On your other device, go to Settings {'->'} Pair Identity.
          </Text>
          <View
            style={[
              Atoms.rounded_md,
              {
                overflow: 'hidden',
                backgroundColor: theme.palette.neutral_900,
              },
            ]}
          >
            <video
              ref={videoRef}
              muted
              autoPlay
              playsInline
              style={{
                width: '100%',
                height: 'auto',
              }}
            />
          </View>

          <LinkButton
            title="Can't scan? Enter code manually"
            onPress={() => setUseCamera(false)}
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

          {canProbeCamera ? (
            <LinkButton
              title="Use camera instead"
              onPress={() => {
                scannedRef.current = false;
                setUseCamera(true);
              }}
              variant="small"
              underlineOnHover
            />
          ) : null}
        </>
      )}
    </>
  );
};
