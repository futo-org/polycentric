import { encode } from '@borderless/base64';
import { useCallback, useRef, useState } from 'react';
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks';

export const PublicKeyDisplay = () => {
  const { processHandle } = useProcessHandleManager();
  const [copied, setCopied] = useState(false);
  const publicKeyRef = useRef<HTMLPreElement>(null);

  const publicKeyString = encode(processHandle.system().key);

  const highlightText = useCallback(() => {
    if (publicKeyRef.current) {
      const range = document.createRange();
      range.selectNodeContents(publicKeyRef.current);

      publicKeyRef.current.style.userSelect = 'auto';

      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, []);

  const copyPublicKey = useCallback(() => {
    if (publicKeyString) {
      // highlight the text
      highlightText();

      // copy the text
      navigator.clipboard.writeText(publicKeyString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [publicKeyString, highlightText]);

  return (
    <div className="flex border rounded-full overflow-hidden flex-col md:flex-row md:items-start md:bg-gray-50">
      <div className="flex-grow overflow-hidden md:flex md:flex-col">
        <pre
          className="p-3 pl-6 font-mono whitespace-nowrap bg-white"
          onMouseUp={() => {
            highlightText();
          }}
          ref={publicKeyRef}
        >
          {publicKeyString}
        </pre>
      </div>

      <div className="flex-shrink-0 text-center border-t md:border-t-0">
        <button
          className="border-l p-3 px-5 flex-shrink-0 bg-gray-100"
          onClick={copyPublicKey}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
};
