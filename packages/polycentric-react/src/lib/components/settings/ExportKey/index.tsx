import { encodeUrl } from '@borderless/base64';
import { Models, Protocol } from '@polycentric/polycentric-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks';
import { useUsernameCRDTQuery } from '../../../hooks/queryHooks';

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

    const copyBundle = useCallback(() => {
        if (bundleString) {
            // highlight the text
            const bundleStringElement = bundleStringElementRef.current;
            if (bundleStringElement) {
                const range = document.createRange();
                range.selectNodeContents(bundleStringElement);

                bundleStringElement.style.userSelect = 'auto';

                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
            }

            // copy the text
            navigator.clipboard.writeText(bundleString);
            setCopied(true);
        }
    }, [bundleString]);

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

    return (
        <div className="flex border rounded-full overflow-hidden flex-col md:flex-row">
            <pre
                className={`flex-grow overflow-hidden p-3 pl-6 font-mono whitespace-nowrap`}
                onMouseDown={() => {
                    // prevent default browser highlighting
                    if (bundleStringElementRef.current) {
                        bundleStringElementRef.current.style.userSelect =
                            'none';
                    }
                }}
                ref={bundleStringElementRef}
            >
                {bundleString ? bundleString : 'Loading...'}
            </pre>
            <div className="grid grid-cols-2 flex-shrink-0 text-center border-t md:border-t-0">
                <button
                    className="md:border-l p-3 flex-shrink-0 bg-gray-50"
                    onClick={copyBundle}
                >
                    {copied ? 'Copied!' : 'Copy'}
                </button>
                <button
                    className="border-l p-3 px-5 flex-shrink-0 bg-gray-100"
                    onClick={downloadBundle}
                >
                    {downloaded ? 'Downloaded' : 'Download'}
                </button>
            </div>
        </div>
    );
};
