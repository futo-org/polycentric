import { encodeUrl } from '@borderless/base64';
import { Models, Protocol } from '@polycentric/polycentric-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks';
import { useUsernameCRDTQuery } from '../../../hooks/queryHooks';
import { useIsMobile } from '../../../hooks/styleHooks';

export const ExportKey = () => {
    const [bundleString, setBundleString] = useState<string | undefined>();
    const { processHandle } = useProcessHandleManager();
    const username = useUsernameCRDTQuery(processHandle.system());

    const bundleStringElementRef = useRef<HTMLPreElement>(null);
    const [copied, setCopied] = useState(false);
    const [downloaded, setDownloaded] = useState(false);

    useEffect(() => {
        processHandle.createExportBundle().then((bundle) => {
            const urlInfo: Protocol.URLInfo = {
                urlType: Models.URLInfo.URLInfoTypeExportBundle,
                body: Protocol.ExportBundle.encode(bundle).finish(),
            };

            const urlInfoString = encodeUrl(
                Protocol.URLInfo.encode(urlInfo).finish(),
            );

            setBundleString(`polycentric://${urlInfoString}`);
        });
    }, [processHandle]);

    const highlightText = useCallback(() => {
        if (bundleStringElementRef.current) {
            const range = document.createRange();
            range.selectNodeContents(bundleStringElementRef.current);

            bundleStringElementRef.current.style.userSelect = 'auto';

            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
        }
    }, []);

    const copyBundle = useCallback(() => {
        if (bundleString) {
            // highlight the text
            highlightText();

            // copy the text
            navigator.clipboard.writeText(bundleString);
            setCopied(true);
        }
    }, [bundleString, highlightText]);

    const downloadBundle = useCallback(() => {
        if (bundleString) {
            const element = document.createElement('a');
            const fileString = `${bundleString}


This is a backup of your Polycentric account. Keep it safe and secure. If you lose this backup, you will lose access to your account. Also, do not share this backup with anyone. If someone else gets access to this backup, they will be able to access your account.

<3 The Polycentric team`;
            const file = new Blob([fileString], {
                type: 'text/plain',
            });
            element.href = URL.createObjectURL(file);
            element.download = `polycentric-${username}-backup.txt`;
            document.body.appendChild(element);
            element.click();

            setDownloaded(true);
            element.remove();
        }
    }, [bundleString, username]);

    const isMobile = useIsMobile();
    const [showQRCode, setShowQRCode] = useState(false);

    return (
        <div
            className={`flex border ${
                showQRCode ? 'rounded-[45px]' : 'rounded-full'
            } overflow-hidden flex-col md:flex-row md:items-start md:bg-gray-50`}
        >
            <div className="flex-grow overflow-hidden md:flex md:flex-col">
                <pre
                    className={`p-3 pl-6 font-mono whitespace-nowrap bg-white`}
                    onMouseUp={() => {
                        // Only highlight text on desktop since on mobile we trade download for QR code
                        if (isMobile === false) highlightText();
                    }}
                    ref={bundleStringElementRef}
                >
                    {bundleString ? bundleString : 'Loading...'}
                </pre>
                {showQRCode && bundleString && (
                    <div className="border-t w-full p-3 md:pl-6 md:pb-6 bg-gray-50">
                        <QRCode
                            value={bundleString}
                            className="w-full h-auto"
                        />
                    </div>
                )}
            </div>

            <div className="grid grid-cols-2 flex-shrink-0 text-center border-t md:border-t-0">
                <button
                    className="md:border-l p-3 flex-shrink-0 bg-gray-50"
                    onClick={() => setShowQRCode(!showQRCode)}
                >
                    {showQRCode ? 'Hide QR Code' : 'Show QR Code'}
                </button>
                <button
                    className={`border-l p-3 px-5 flex-shrink-0 bg-gray-100 ${
                        !isMobile && showQRCode ? 'border-b' : ''
                    }`}
                    onClick={isMobile ? copyBundle : downloadBundle}
                >
                    {isMobile
                        ? copied
                            ? 'Copied'
                            : 'Copy'
                        : downloaded
                          ? 'Downloaded'
                          : 'Download'}
                </button>
            </div>
        </div>
    );
};
